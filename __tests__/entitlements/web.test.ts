import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getWebBillingStatus,
  hasProEntitlementWeb,
  hasProSubscriptionWeb,
} from "@/lib/entitlements/web";

vi.mock("@/lib/supabase/admin", () => ({
  getAdminClient: vi.fn(),
}));

import { getAdminClient } from "@/lib/supabase/admin";

const mockGetAdminClient = vi.mocked(getAdminClient);

function makeSupabaseChain(data: unknown, error: { message: string } | null = null) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  };
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ── getWebBillingStatus ───────────────────────────────────────────────────────

describe("getWebBillingStatus — admin client absent", () => {
  it("returns null and logs error when admin client is not configured", async () => {
    mockGetAdminClient.mockReturnValue(null as never);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await getWebBillingStatus("user-1");
    expect(result).toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Supabase credentials"));
    consoleSpy.mockRestore();
  });
});

describe("getWebBillingStatus — Supabase query errors", () => {
  it("returns null when the query returns an error", async () => {
    const chain = makeSupabaseChain(null, { message: "DB connection failed" });
    mockGetAdminClient.mockReturnValue(chain as never);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await getWebBillingStatus("user-1");
    expect(result).toBeNull();
    consoleSpy.mockRestore();
  });
});

describe("getWebBillingStatus — no record", () => {
  it("returns hasPaid:false with null tier and status when no record found", async () => {
    const chain = makeSupabaseChain(null);
    mockGetAdminClient.mockReturnValue(chain as never);
    const result = await getWebBillingStatus("user-1");
    expect(result).toEqual({ hasPaid: false, tier: null, status: null });
  });
});

describe("getWebBillingStatus — apartment tier (one-time)", () => {
  it("returns hasPaid:true for active apartment purchase", async () => {
    const chain = makeSupabaseChain({ tier: "apartment", status: "active", current_period_end: null });
    mockGetAdminClient.mockReturnValue(chain as never);
    const result = await getWebBillingStatus("user-1");
    expect(result).toEqual({ hasPaid: true, tier: "apartment", status: "active" });
  });

  it("returns hasPaid:false for cancelled apartment purchase", async () => {
    const chain = makeSupabaseChain({ tier: "apartment", status: "cancelled", current_period_end: null });
    mockGetAdminClient.mockReturnValue(chain as never);
    const result = await getWebBillingStatus("user-1");
    expect(result!.hasPaid).toBe(false);
  });

  it("returns hasPaid:false for past_due apartment status", async () => {
    const chain = makeSupabaseChain({ tier: "apartment", status: "past_due", current_period_end: null });
    mockGetAdminClient.mockReturnValue(chain as never);
    const result = await getWebBillingStatus("user-1");
    expect(result!.hasPaid).toBe(false);
  });
});

describe("getWebBillingStatus — pro tier (subscription)", () => {
  it("returns hasPaid:true for active pro with no period end", async () => {
    const chain = makeSupabaseChain({ tier: "pro", status: "active", current_period_end: null });
    mockGetAdminClient.mockReturnValue(chain as never);
    const result = await getWebBillingStatus("user-1");
    expect(result!.hasPaid).toBe(true);
    expect(result!.tier).toBe("pro");
  });

  it("returns hasPaid:true for active pro with period end in the future", async () => {
    const future = new Date(Date.now() + 86400_000).toISOString();
    const chain = makeSupabaseChain({ tier: "pro", status: "active", current_period_end: future });
    mockGetAdminClient.mockReturnValue(chain as never);
    const result = await getWebBillingStatus("user-1");
    expect(result!.hasPaid).toBe(true);
  });

  it("returns hasPaid:false for active pro with period end in the past (Stripe hasn't fired yet)", async () => {
    const past = new Date(Date.now() - 86400_000).toISOString();
    const chain = makeSupabaseChain({ tier: "pro", status: "active", current_period_end: past });
    mockGetAdminClient.mockReturnValue(chain as never);
    const result = await getWebBillingStatus("user-1");
    expect(result!.hasPaid).toBe(false);
  });

  it("returns hasPaid:false for cancelled pro subscription", async () => {
    const chain = makeSupabaseChain({ tier: "pro", status: "cancelled", current_period_end: null });
    mockGetAdminClient.mockReturnValue(chain as never);
    const result = await getWebBillingStatus("user-1");
    expect(result!.hasPaid).toBe(false);
  });

  it("grants grace for past_due pro anchored on updated_at when period end is unknown", async () => {
    // current_period_end is always null for Pro (the webhook leaves it null), so
    // the grace anchors on updated_at — here the row entered past_due 2 days ago,
    // well inside the 14-day window. Revoking instantly would violate the stores'
    // uninterrupted-access expectation.
    const recentUpdate = new Date(Date.now() - 2 * 86400_000).toISOString();
    const chain = makeSupabaseChain({
      tier: "pro",
      status: "past_due",
      current_period_end: null,
      updated_at: recentUpdate,
    });
    mockGetAdminClient.mockReturnValue(chain as never);
    const result = await getWebBillingStatus("user-1");
    expect(result!.hasPaid).toBe(true);
  });

  it("revokes past_due pro once the updated_at-anchored grace window has elapsed", async () => {
    // The row entered past_due 20 days ago and Stripe never sent a follow-up
    // canceled/unpaid event (dropped webhook / stale row). The bound is REAL and
    // self-contained: access lapses at updated_at + 14d rather than staying free
    // forever waiting on an event that never came.
    const staleUpdate = new Date(Date.now() - 20 * 86400_000).toISOString();
    const chain = makeSupabaseChain({
      tier: "pro",
      status: "past_due",
      current_period_end: null,
      updated_at: staleUpdate,
    });
    mockGetAdminClient.mockReturnValue(chain as never);
    const result = await getWebBillingStatus("user-1");
    expect(result!.hasPaid).toBe(false);
  });

  it("prefers current_period_end over updated_at as the grace anchor when present", async () => {
    // If a period end IS known, cap the grace at period_end + 14d even when
    // updated_at is more recent — period_end 20 days ago lapses despite a fresh
    // updated_at, so a re-stamped row can't extend a genuinely-expired period.
    const oldPeriodEnd = new Date(Date.now() - 20 * 86400_000).toISOString();
    const freshUpdate = new Date(Date.now() - 1 * 86400_000).toISOString();
    const chain = makeSupabaseChain({
      tier: "pro",
      status: "past_due",
      current_period_end: oldPeriodEnd,
      updated_at: freshUpdate,
    });
    mockGetAdminClient.mockReturnValue(chain as never);
    const result = await getWebBillingStatus("user-1");
    expect(result!.hasPaid).toBe(false);
  });

  it("returns hasPaid:false for unpaid pro subscription", async () => {
    const chain = makeSupabaseChain({ tier: "pro", status: "unpaid", current_period_end: null });
    mockGetAdminClient.mockReturnValue(chain as never);
    const result = await getWebBillingStatus("user-1");
    expect(result!.hasPaid).toBe(false);
  });
});

// ── hasProEntitlementWeb ──────────────────────────────────────────────────────

describe("hasProEntitlementWeb", () => {
  it("fails OPEN (returns true) in development when admin client is absent", async () => {
    vi.stubEnv("NODE_ENV", "development");
    mockGetAdminClient.mockReturnValue(null as never);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await hasProEntitlementWeb("user-1");
    expect(result).toBe(true);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("development"));
  });

  it("fails CLOSED (returns false) in production when admin client is absent", async () => {
    vi.stubEnv("NODE_ENV", "production");
    mockGetAdminClient.mockReturnValue(null as never);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await hasProEntitlementWeb("user-1");
    expect(result).toBe(false);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("production"));
  });

  it("returns true for active apartment subscriber", async () => {
    const chain = makeSupabaseChain({ tier: "apartment", status: "active", current_period_end: null });
    mockGetAdminClient.mockReturnValue(chain as never);
    expect(await hasProEntitlementWeb("user-1")).toBe(true);
  });

  it("returns false for cancelled user", async () => {
    const chain = makeSupabaseChain({ tier: "pro", status: "cancelled", current_period_end: null });
    mockGetAdminClient.mockReturnValue(chain as never);
    expect(await hasProEntitlementWeb("user-1")).toBe(false);
  });

  it("returns false for user with no stripe record", async () => {
    const chain = makeSupabaseChain(null);
    mockGetAdminClient.mockReturnValue(chain as never);
    expect(await hasProEntitlementWeb("user-1")).toBe(false);
  });
});

// ── hasProSubscriptionWeb ─────────────────────────────────────────────────────
//
// The predicate that decides who gets the advertised Pro "higher AI generation
// limits". It exists BECAUSE hasProEntitlementWeb is the wrong tool for the job:
// that one answers "has this user paid for anything" and returns true for the
// $29 one-time Apartment tier, which is NOT sold that benefit. The apartment
// case below is the whole reason this function exists — if it ever returns true,
// the two paid tiers have silently collapsed into one.

describe("hasProSubscriptionWeb", () => {
  it("returns FALSE for an active apartment buyer — the tier that must not get it", async () => {
    const chain = makeSupabaseChain({ tier: "apartment", status: "active", current_period_end: null });
    mockGetAdminClient.mockReturnValue(chain as never);
    expect(await hasProSubscriptionWeb("user-1")).toBe(false);
    // ...while the generic paid check still says true for the SAME row. That
    // divergence is the point of having two predicates.
    mockGetAdminClient.mockReturnValue(
      makeSupabaseChain({ tier: "apartment", status: "active", current_period_end: null }) as never,
    );
    expect(await hasProEntitlementWeb("user-1")).toBe(true);
  });

  it("returns true for an active pro subscriber", async () => {
    const chain = makeSupabaseChain({ tier: "pro", status: "active", current_period_end: null });
    mockGetAdminClient.mockReturnValue(chain as never);
    expect(await hasProSubscriptionWeb("user-1")).toBe(true);
  });

  it("returns true for an active pro_annual subscriber", async () => {
    const chain = makeSupabaseChain({ tier: "pro_annual", status: "active", current_period_end: null });
    mockGetAdminClient.mockReturnValue(chain as never);
    expect(await hasProSubscriptionWeb("user-1")).toBe(true);
  });

  it("returns false for a cancelled pro subscriber", async () => {
    const chain = makeSupabaseChain({ tier: "pro", status: "cancelled", current_period_end: null });
    mockGetAdminClient.mockReturnValue(chain as never);
    expect(await hasProSubscriptionWeb("user-1")).toBe(false);
  });

  it("returns false for a user with no stripe record", async () => {
    mockGetAdminClient.mockReturnValue(makeSupabaseChain(null) as never);
    expect(await hasProSubscriptionWeb("user-1")).toBe(false);
  });

  it("fails CLOSED in production when credentials are missing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    mockGetAdminClient.mockReturnValue(null as never);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await hasProSubscriptionWeb("user-1")).toBe(false);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("production"));
  });

  it("fails OPEN on a transient query error so an outage never blocks a subscriber", async () => {
    const chain = makeSupabaseChain(null, { message: "connection reset" });
    mockGetAdminClient.mockReturnValue(chain as never);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await hasProSubscriptionWeb("user-1")).toBe(true);
    consoleSpy.mockRestore();
  });
});
