import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getWebBillingStatus, hasProEntitlementWeb, getProEntitlementMapWeb } from "@/lib/entitlements/web";

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

/** Batched `.in()` variant of makeSupabaseChain, for getProEntitlementMapWeb. */
function makeSupabaseBatchChain(data: unknown, error: { message: string } | null = null) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    in: vi.fn().mockResolvedValue({ data, error }),
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

  /**
   * The two null-returning paths out of getWebBillingStatus are NOT the same
   * failure and must not be treated the same:
   *
   *   credentials absent  → misconfiguration → deny in production (covered above)
   *   query errored       → outage           → GRANT, always
   *
   * The suite above proves getWebBillingStatus returns null on a query error,
   * but nothing proved what hasProEntitlementWeb then does with that null — the
   * `if (result === null) return true` at web.ts:80 was the one branch in this
   * module with no coverage. Turning it fail-closed logs out every paying
   * subscriber for the duration of a Supabase blip, on a path where the app
   * stores expect uninterrupted access, and it would do so SILENTLY: every
   * assertion above still passes, because they all run with a healthy client.
   */
  it("fails OPEN (returns true) when the query errors, even in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const chain = makeSupabaseChain(null, { message: "DB connection failed" });
    mockGetAdminClient.mockReturnValue(chain as never);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // The client IS configured here — this is an outage, not a misconfiguration,
    // so the production fail-CLOSED rule above must not reach it.
    expect(await hasProEntitlementWeb("user-1")).toBe(true);
    consoleSpy.mockRestore();
  });

  it("fails OPEN on a query error in development too", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const chain = makeSupabaseChain(null, { message: "DB connection failed" });
    mockGetAdminClient.mockReturnValue(chain as never);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await hasProEntitlementWeb("user-1")).toBe(true);
    consoleSpy.mockRestore();
  });

  /**
   * Distinguishes the outage grant from the misconfiguration grant. Without
   * this, replacing the outage branch with `return !isProduction` would still
   * pass the development case above — the two branches only diverge in
   * production, which is exactly where getting it wrong costs subscribers.
   */
  it("grants on an outage but denies on a misconfiguration — same env, opposite answers", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    mockGetAdminClient.mockReturnValue(null as never);
    const misconfigured = await hasProEntitlementWeb("user-1");

    mockGetAdminClient.mockReturnValue(
      makeSupabaseChain(null, { message: "DB connection failed" }) as never,
    );
    const outage = await hasProEntitlementWeb("user-1");

    expect({ misconfigured, outage }).toEqual({ misconfigured: false, outage: true });
    consoleSpy.mockRestore();
  });
});

// ── getProEntitlementMapWeb ───────────────────────────────────────────────────

describe("getProEntitlementMapWeb", () => {
  it("returns an empty map for an empty cohort without querying", async () => {
    const chain = makeSupabaseBatchChain([]);
    mockGetAdminClient.mockReturnValue(chain as never);
    const result = await getProEntitlementMapWeb([]);
    expect(result.size).toBe(0);
  });

  it("resolves a mixed cohort per-user: active pro, cancelled, and missing-row default to their own outcome, not each other's", async () => {
    // Same mis-keying risk as getMarketingOptOutMap — only a genuinely mixed
    // cohort (some paid, some not, one missing) can catch a batch result
    // getting attributed to the wrong user_id.
    const chain = makeSupabaseBatchChain([
      { user_id: "active-pro", tier: "pro", status: "active", current_period_end: null, updated_at: null },
      { user_id: "cancelled", tier: "pro", status: "cancelled", current_period_end: null, updated_at: null },
      // "no-record" has no row at all — must default to false, matching
      // hasProEntitlementWeb's "no record" behavior, not the batch's fail-open.
    ]);
    mockGetAdminClient.mockReturnValue(chain as never);
    const result = await getProEntitlementMapWeb(["active-pro", "cancelled", "no-record"]);
    expect(result.get("active-pro")).toBe(true);
    expect(result.get("cancelled")).toBe(false);
    expect(result.get("no-record")).toBe(false);
  });

  it("fails OPEN (grants every user in the cohort) on a batch query error, matching hasProEntitlementWeb's single-user outage behavior", async () => {
    const chain = makeSupabaseBatchChain(null, { message: "DB connection failed" });
    mockGetAdminClient.mockReturnValue(chain as never);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await getProEntitlementMapWeb(["user-1", "user-2"]);
    expect(result.get("user-1")).toBe(true);
    expect(result.get("user-2")).toBe(true);
    consoleSpy.mockRestore();
  });

  it("fails CLOSED (denies every user in the cohort) in production when no admin client is available", async () => {
    vi.stubEnv("NODE_ENV", "production");
    mockGetAdminClient.mockReturnValue(null as never);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await getProEntitlementMapWeb(["user-1", "user-2"]);
    expect(result.get("user-1")).toBe(false);
    expect(result.get("user-2")).toBe(false);
    consoleSpy.mockRestore();
  });

  it("fails OPEN (grants every user in the cohort) in development when no admin client is available", async () => {
    vi.stubEnv("NODE_ENV", "development");
    mockGetAdminClient.mockReturnValue(null as never);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await getProEntitlementMapWeb(["user-1", "user-2"]);
    expect(result.get("user-1")).toBe(true);
    expect(result.get("user-2")).toBe(true);
    consoleSpy.mockRestore();
  });
});
