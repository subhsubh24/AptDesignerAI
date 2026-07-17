import { describe, it, expect, vi, beforeEach } from "vitest";
import type Stripe from "stripe";
import {
  extractBillingInfoFromEvent,
  constructWebhookEvent,
  createCheckoutSession,
  isAnnualBillingEnabled,
} from "@/lib/billing/stripe";

// constructWebhookEvent and createCheckoutSession need STRIPE_SECRET_KEY set.
// We mock the stripe module for those tests.
vi.mock("stripe", () => {
  const mockStripe = {
    checkout: {
      sessions: {
        create: vi.fn(),
      },
    },
    webhooks: {
      constructEvent: vi.fn(),
    },
  };
  // Use a normal function (not an arrow) so `new Stripe(...)` in getStripe()
  // works — an arrow function throws "not a constructor". Called with or without
  // `new`, it returns the shared mockStripe (an explicit object return wins).
  return { default: vi.fn(function () { return mockStripe; }) };
});

function makeEvent(type: string, object: unknown): Stripe.Event {
  return { type, data: { object } } as unknown as Stripe.Event;
}

// ── extractBillingInfoFromEvent (pure function — no mocking needed) ──────────

describe("extractBillingInfoFromEvent — checkout.session.completed", () => {
  it("extracts billing info from a one-time apartment purchase", () => {
    const session = {
      metadata: { user_id: "user-1", tier: "apartment" },
      customer: "cus_abc",
      subscription: null,
    };
    const result = extractBillingInfoFromEvent(makeEvent("checkout.session.completed", session));
    expect(result).not.toBeNull();
    expect(result!.userId).toBe("user-1");
    expect(result!.tier).toBe("apartment");
    expect(result!.status).toBe("active");
    expect(result!.stripeCustomerId).toBe("cus_abc");
    expect(result!.stripeSubscriptionId).toBeNull();
    expect(result!.currentPeriodEnd).toBeNull();
  });

  it("extracts billing info from a pro subscription checkout", () => {
    const session = {
      metadata: { user_id: "user-2", tier: "pro" },
      customer: "cus_xyz",
      subscription: "sub_123",
    };
    const result = extractBillingInfoFromEvent(makeEvent("checkout.session.completed", session));
    expect(result).not.toBeNull();
    expect(result!.userId).toBe("user-2");
    expect(result!.tier).toBe("pro");
    expect(result!.stripeSubscriptionId).toBe("sub_123");
  });

  it("handles customer and subscription as objects with .id", () => {
    const session = {
      metadata: { user_id: "user-3", tier: "pro" },
      customer: { id: "cus_obj" },
      subscription: { id: "sub_obj" },
    };
    const result = extractBillingInfoFromEvent(makeEvent("checkout.session.completed", session));
    expect(result!.stripeCustomerId).toBe("cus_obj");
    expect(result!.stripeSubscriptionId).toBe("sub_obj");
  });

  it("returns null when user_id metadata is missing", () => {
    const session = {
      metadata: { tier: "pro" },
      customer: "cus_abc",
      subscription: null,
    };
    expect(extractBillingInfoFromEvent(makeEvent("checkout.session.completed", session))).toBeNull();
  });

  it("returns null when tier metadata is missing", () => {
    const session = {
      metadata: { user_id: "user-1" },
      customer: "cus_abc",
      subscription: null,
    };
    expect(extractBillingInfoFromEvent(makeEvent("checkout.session.completed", session))).toBeNull();
  });

  it("returns null when customer is missing", () => {
    const session = {
      metadata: { user_id: "user-1", tier: "pro" },
      customer: null,
      subscription: null,
    };
    expect(extractBillingInfoFromEvent(makeEvent("checkout.session.completed", session))).toBeNull();
  });

  it("returns null (safe no-op, no DB CHECK 500) and LOGS LOUD when tier is present but unrecognized", () => {
    // A replayed/typo'd tier must NOT be cast straight through to the upsert — that
    // would 500 on the stripe_customers CHECK constraint and stick the webhook in a
    // Stripe retry loop. An invalid tier fails the guard → null → unhandled no-op.
    // Because that no-op is silent (no entitlement, no retry) on a possibly-CHARGED
    // customer, a present-but-invalid tier must be logged loud for discoverability.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const session = {
      metadata: { user_id: "user-1", tier: "enterprise" },
      customer: "cus_abc",
      subscription: "sub_1",
    };
    expect(extractBillingInfoFromEvent(makeEvent("checkout.session.completed", session))).toBeNull();
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(errSpy.mock.calls[0][0]).toMatch(/unrecognized tier "enterprise"/);
    errSpy.mockRestore();
  });

  it("does NOT log for an absent tier (a routine unhandled no-op, not an error)", () => {
    // Distinguish present-but-invalid (loud) from absent (quiet) — an absent tier is
    // an ordinary event we don't grant on, not a charged-customer divergence.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const session = { metadata: { user_id: "user-1" }, customer: "cus_abc", subscription: null };
    expect(extractBillingInfoFromEvent(makeEvent("checkout.session.completed", session))).toBeNull();
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

describe("extractBillingInfoFromEvent — customer.subscription.updated", () => {
  function makeSub(status: string, overrides: Record<string, unknown> = {}) {
    return {
      id: "sub_abc",
      metadata: { user_id: "user-1", tier: "pro" },
      customer: "cus_abc",
      status,
      ...overrides,
    };
  }

  const statusMappings: [string, string][] = [
    ["active", "active"],
    ["trialing", "active"],
    ["past_due", "past_due"],
    ["unpaid", "unpaid"],
    ["canceled", "cancelled"],
    ["incomplete", "past_due"],
    ["incomplete_expired", "cancelled"],
    ["paused", "cancelled"],
  ];

  for (const [stripeStatus, expectedStatus] of statusMappings) {
    it(`maps Stripe status "${stripeStatus}" to "${expectedStatus}"`, () => {
      const result = extractBillingInfoFromEvent(
        makeEvent("customer.subscription.updated", makeSub(stripeStatus))
      );
      expect(result).not.toBeNull();
      expect(result!.status).toBe(expectedStatus);
    });
  }

  it("extracts userId and tier from subscription metadata", () => {
    const result = extractBillingInfoFromEvent(
      makeEvent("customer.subscription.updated", makeSub("active"))
    );
    expect(result!.userId).toBe("user-1");
    expect(result!.tier).toBe("pro");
    expect(result!.stripeSubscriptionId).toBe("sub_abc");
  });

  it("defaults tier to pro when metadata.tier is absent", () => {
    const sub = makeSub("active", { metadata: { user_id: "user-1" } });
    const result = extractBillingInfoFromEvent(makeEvent("customer.subscription.updated", sub));
    expect(result!.tier).toBe("pro");
  });

  it("defaults tier to pro (and warns) when metadata.tier is an unrecognized string", () => {
    // Same DB-CHECK / stuck-webhook hazard as the checkout case, but here the
    // subscription event has a sane fallback: an unknown tier degrades to "pro"
    // (a valid paid tier) instead of a 500. It still WRITES a row, so it warns
    // (not errors) for discoverability. Valid tiers still pass through unchanged.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const sub = makeSub("active", { metadata: { user_id: "user-1", tier: "gold-tier-typo" } });
    const result = extractBillingInfoFromEvent(makeEvent("customer.subscription.updated", sub));
    expect(result!.tier).toBe("pro");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toMatch(/unrecognized tier "gold-tier-typo"/);
    warnSpy.mockRestore();

    const annual = makeSub("active", { metadata: { user_id: "user-1", tier: "pro_annual" } });
    expect(
      extractBillingInfoFromEvent(makeEvent("customer.subscription.updated", annual))!.tier,
    ).toBe("pro_annual");
  });

  it("returns null when user_id is missing", () => {
    const sub = makeSub("active", { metadata: {} });
    expect(extractBillingInfoFromEvent(makeEvent("customer.subscription.updated", sub))).toBeNull();
  });

  it("returns null when customer is missing", () => {
    const sub = makeSub("active", { customer: null });
    expect(extractBillingInfoFromEvent(makeEvent("customer.subscription.updated", sub))).toBeNull();
  });

  it("currentPeriodEnd is always null (dahlia API removed it)", () => {
    const result = extractBillingInfoFromEvent(
      makeEvent("customer.subscription.updated", makeSub("active"))
    );
    expect(result!.currentPeriodEnd).toBeNull();
  });

  it("handles customer as object with .id", () => {
    const sub = makeSub("active", { customer: { id: "cus_obj" } });
    const result = extractBillingInfoFromEvent(makeEvent("customer.subscription.updated", sub));
    expect(result!.stripeCustomerId).toBe("cus_obj");
  });
});

describe("extractBillingInfoFromEvent — customer.subscription.deleted", () => {
  it("processes deletion with the same logic as updated", () => {
    const sub = {
      id: "sub_del",
      metadata: { user_id: "user-1", tier: "pro" },
      customer: "cus_abc",
      status: "canceled",
    };
    const result = extractBillingInfoFromEvent(makeEvent("customer.subscription.deleted", sub));
    expect(result).not.toBeNull();
    expect(result!.status).toBe("cancelled");
  });
});

describe("extractBillingInfoFromEvent — unknown event types", () => {
  it("returns null for unhandled event types", () => {
    expect(extractBillingInfoFromEvent(makeEvent("invoice.payment_succeeded", {}))).toBeNull();
    expect(extractBillingInfoFromEvent(makeEvent("payment_intent.created", {}))).toBeNull();
  });
});

// ── constructWebhookEvent (throws on missing config) ─────────────────────────

describe("constructWebhookEvent", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("throws when STRIPE_WEBHOOK_SECRET is not set", () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_key");
    expect(() => constructWebhookEvent("body", "sig")).toThrow(/STRIPE_WEBHOOK_SECRET/);
  });
});

// ── createCheckoutSession (throws on missing config) ─────────────────────────

describe("createCheckoutSession", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("throws when STRIPE_SECRET_KEY is not set", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    await expect(
      createCheckoutSession({
        userId: "u1",
        userEmail: "u@example.com",
        tier: "pro",
        successUrl: "https://example.com/success",
        cancelUrl: "https://example.com/cancel",
      })
    ).rejects.toThrow(/STRIPE_SECRET_KEY/);
  });
});

// ── createCheckoutSession — subscription metadata carries tier ───────────────
// Regression guard: the checkout session's top-level metadata carries `tier`,
// but Stripe's customer.subscription.updated/deleted webhooks only see the
// SUBSCRIPTION's own metadata. If `tier` is omitted from subscription_data,
// extractBillingInfoFromEvent falls back to "pro" (stripe.ts) — so a pro_annual
// subscriber gets silently re-attributed to "pro" on any renewal/cancel event,
// corrupting revenue tracking. This asserts tier is threaded into
// subscription_data.metadata so it survives to the subscription events.
describe("createCheckoutSession — subscription_data carries tier (revenue attribution)", () => {
  // STRIPE_SECRET_KEY / STRIPE_PRICE_IDS are read at module import, so re-import
  // the module after stubbing env to exercise the happy path.
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  async function loadWithStripe() {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_dummy");
    vi.stubEnv("STRIPE_PRICE_ID_PRO_ANNUAL", "price_pro_annual");
    vi.stubEnv("STRIPE_PRICE_ID_PRO_MONTHLY", "price_pro_monthly");
    vi.stubEnv("STRIPE_PRICE_ID_APARTMENT", "price_apartment");
    const stripeModule = await import("stripe");
    const instance = (
      stripeModule.default as unknown as () => {
        checkout: { sessions: { create: ReturnType<typeof vi.fn> } };
      }
    )();
    const create = instance.checkout.sessions.create;
    create.mockResolvedValue({ id: "cs_1", url: "https://checkout.example/cs_1" });
    const { createCheckoutSession: fn } = await import("@/lib/billing/stripe");
    return { fn, create };
  }

  it("threads tier into subscription_data.metadata for a pro_annual subscription", async () => {
    const { fn, create } = await loadWithStripe();
    await fn({
      userId: "u1",
      userEmail: "u@example.com",
      tier: "pro_annual",
      successUrl: "https://example.com/s",
      cancelUrl: "https://example.com/c",
    });
    const arg = create.mock.calls.at(-1)?.[0] as {
      mode: string;
      metadata: Record<string, string>;
      subscription_data?: { metadata: Record<string, string> };
    };
    expect(arg.mode).toBe("subscription");
    // Both the session metadata AND the subscription metadata must carry tier.
    expect(arg.metadata).toEqual({ user_id: "u1", tier: "pro_annual" });
    expect(arg.subscription_data?.metadata).toEqual({ user_id: "u1", tier: "pro_annual" });
  });

  it("omits subscription_data for a one-time apartment purchase (payment mode)", async () => {
    const { fn, create } = await loadWithStripe();
    await fn({
      userId: "u2",
      userEmail: "u2@example.com",
      tier: "apartment",
      successUrl: "https://example.com/s",
      cancelUrl: "https://example.com/c",
    });
    const arg = create.mock.calls.at(-1)?.[0] as {
      mode: string;
      subscription_data?: unknown;
    };
    expect(arg.mode).toBe("payment");
    expect(arg.subscription_data).toBeUndefined();
  });
});

// ── isAnnualBillingEnabled — the pro_annual kill-switch ──────────────────────
// Annual billing is a built-but-gated tier: it ships DISABLED until the owner
// applies migration 021 AND sets ANNUAL_BILLING_ENABLED=true in the SAME deploy.
// This flag is the charge chokepoint (checkout route refuses pro_annual while
// off) — a regression that flips it default-on would let a customer be charged
// for a tier the DB CHECK constraint rejects, leaving them charged with NO
// entitlement. Pin the exact env contract so that can't silently regress.
describe("isAnnualBillingEnabled — pro_annual gate", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("is enabled ONLY when ANNUAL_BILLING_ENABLED is exactly 'true'", () => {
    vi.stubEnv("ANNUAL_BILLING_ENABLED", "true");
    expect(isAnnualBillingEnabled()).toBe(true);
  });

  it("stays disabled by default when the env var is unset", () => {
    vi.stubEnv("ANNUAL_BILLING_ENABLED", "");
    expect(isAnnualBillingEnabled()).toBe(false);
  });

  it("stays disabled for any non-'true' value (no truthy coercion)", () => {
    for (const v of ["false", "1", "TRUE", "yes", "on"]) {
      vi.stubEnv("ANNUAL_BILLING_ENABLED", v);
      expect(isAnnualBillingEnabled()).toBe(false);
    }
  });
});
