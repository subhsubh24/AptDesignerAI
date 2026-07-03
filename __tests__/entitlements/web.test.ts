import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getWebBillingStatus, hasProEntitlementWeb } from "@/lib/entitlements/web";

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

  it("returns hasPaid:false for past_due pro subscription", async () => {
    const chain = makeSupabaseChain({ tier: "pro", status: "past_due", current_period_end: null });
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
