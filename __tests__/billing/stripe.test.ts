import { describe, it, expect, vi, beforeEach } from "vitest";
import type Stripe from "stripe";
import {
  extractBillingInfoFromEvent,
  constructWebhookEvent,
  createCheckoutSession,
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
  return { default: vi.fn(() => mockStripe) };
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
