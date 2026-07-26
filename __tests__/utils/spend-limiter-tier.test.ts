import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mocked so the tier resolution is exercised WITHOUT a Supabase client — the
// point of these tests is the ceiling each billing shape earns, not the query.
const getWebBillingStatus = vi.hoisted(() => vi.fn());
vi.mock("@/lib/entitlements/web", () => ({ getWebBillingStatus }));

import {
  __resetDailySpend,
  checkDailySpend,
  checkDailySpendForUser,
} from "@/lib/utils/spend-limiter";

const T0 = Date.UTC(2026, 5, 27, 10, 0, 0); // fixed instant for deterministic tests

const FREE = "7";
const PRO = "21";

describe("checkDailySpendForUser — tier-aware ceiling", () => {
  const origFree = process.env.DAILY_PAID_CALL_LIMIT;
  const origPro = process.env.DAILY_PAID_CALL_LIMIT_PRO;

  beforeEach(() => {
    __resetDailySpend();
    getWebBillingStatus.mockReset();
    process.env.DAILY_PAID_CALL_LIMIT = FREE;
    process.env.DAILY_PAID_CALL_LIMIT_PRO = PRO;
  });
  afterEach(() => {
    if (origFree === undefined) delete process.env.DAILY_PAID_CALL_LIMIT;
    else process.env.DAILY_PAID_CALL_LIMIT = origFree;
    if (origPro === undefined) delete process.env.DAILY_PAID_CALL_LIMIT_PRO;
    else process.env.DAILY_PAID_CALL_LIMIT_PRO = origPro;
  });

  // THE claim under test: /pricing sells Pro on "Higher AI generation limits".
  // If these two ever report the same ceiling, that claim is false again.
  it("gives an active Pro subscriber a HIGHER ceiling than a free user", async () => {
    getWebBillingStatus.mockResolvedValue({ hasPaid: false, tier: null, status: null });
    const free = await checkDailySpendForUser("free-user", T0);

    getWebBillingStatus.mockResolvedValue({ hasPaid: true, tier: "pro", status: "active" });
    const pro = await checkDailySpendForUser("pro-user", T0);

    expect(free.limit).toBe(7);
    expect(pro.limit).toBe(21);
    expect(pro.limit).toBeGreaterThan(free.limit);
  });

  it("treats pro_annual the same as monthly Pro", async () => {
    getWebBillingStatus.mockResolvedValue({ hasPaid: true, tier: "pro_annual", status: "active" });
    expect((await checkDailySpendForUser("annual-user", T0)).limit).toBe(21);
  });

  it("keeps a one-time Apartment purchase on the FREE ceiling", async () => {
    // "Higher AI generation limits" is a Pro-only bullet — Apartment ($29
    // one-time) is not sold with it, so hasPaid alone must not raise the ceiling.
    getWebBillingStatus.mockResolvedValue({ hasPaid: true, tier: "apartment", status: "active" });
    expect((await checkDailySpendForUser("apartment-user", T0)).limit).toBe(7);
  });

  it("keeps a LAPSED Pro subscription on the free ceiling", async () => {
    // hasPaid:false is how getWebBillingStatus reports an expired/unpaid Pro row
    // (grace window exhausted). The tier string alone must not grant the ceiling.
    getWebBillingStatus.mockResolvedValue({ hasPaid: false, tier: "pro", status: "unpaid" });
    expect((await checkDailySpendForUser("lapsed-user", T0)).limit).toBe(7);
  });

  it("keeps a Pro subscriber in past_due GRACE on the Pro ceiling", async () => {
    // getWebBillingStatus resolves the grace window itself and reports hasPaid.
    // A subscriber mid-grace is still paying for Pro, so the ceiling holds.
    getWebBillingStatus.mockResolvedValue({ hasPaid: true, tier: "pro", status: "past_due" });
    expect((await checkDailySpendForUser("grace-user", T0)).limit).toBe(21);
  });
});

describe("checkDailySpendForUser — the ceiling fails DOWN, never up", () => {
  const origFree = process.env.DAILY_PAID_CALL_LIMIT;
  const origPro = process.env.DAILY_PAID_CALL_LIMIT_PRO;

  beforeEach(() => {
    __resetDailySpend();
    getWebBillingStatus.mockReset();
    process.env.DAILY_PAID_CALL_LIMIT = FREE;
    process.env.DAILY_PAID_CALL_LIMIT_PRO = PRO;
  });
  afterEach(() => {
    if (origFree === undefined) delete process.env.DAILY_PAID_CALL_LIMIT;
    else process.env.DAILY_PAID_CALL_LIMIT = origFree;
    if (origPro === undefined) delete process.env.DAILY_PAID_CALL_LIMIT_PRO;
    else process.env.DAILY_PAID_CALL_LIMIT_PRO = origPro;
  });

  // Deliberately the OPPOSITE of hasProEntitlementWeb's fail-open: an
  // indeterminate answer must never hand out 3x the paid-API budget.
  it("uses the free ceiling when billing status is indeterminate (null)", async () => {
    getWebBillingStatus.mockResolvedValue(null);
    expect((await checkDailySpendForUser("outage-user", T0)).limit).toBe(7);
  });

  it("uses the free ceiling — and does not throw — when the lookup rejects", async () => {
    getWebBillingStatus.mockRejectedValue(new Error("connection reset"));
    const result = await checkDailySpendForUser("throwing-user", T0);
    expect(result.limit).toBe(7);
    expect(result.allowed).toBe(true); // the route must still serve the request
  });

  it("never resolves the Pro ceiling BELOW the free one", async () => {
    // A mis-set env (or a raised free limit) must not leave subscribers worse
    // off than free users.
    process.env.DAILY_PAID_CALL_LIMIT = "50";
    process.env.DAILY_PAID_CALL_LIMIT_PRO = "10";
    getWebBillingStatus.mockResolvedValue({ hasPaid: true, tier: "pro", status: "active" });
    expect((await checkDailySpendForUser("pro-user", T0)).limit).toBe(50);
  });

  it("falls back to the built-in Pro default on a junk env value", async () => {
    delete process.env.DAILY_PAID_CALL_LIMIT;
    process.env.DAILY_PAID_CALL_LIMIT_PRO = "not-a-number";
    getWebBillingStatus.mockResolvedValue({ hasPaid: true, tier: "pro", status: "active" });
    expect((await checkDailySpendForUser("pro-user", T0)).limit).toBe(180);
  });
});

describe("checkDailySpendForUser — metering still works through the wrapper", () => {
  const origFree = process.env.DAILY_PAID_CALL_LIMIT;
  const origPro = process.env.DAILY_PAID_CALL_LIMIT_PRO;

  beforeEach(() => {
    __resetDailySpend();
    getWebBillingStatus.mockReset();
    process.env.DAILY_PAID_CALL_LIMIT = "2";
    process.env.DAILY_PAID_CALL_LIMIT_PRO = "4";
  });
  afterEach(() => {
    if (origFree === undefined) delete process.env.DAILY_PAID_CALL_LIMIT;
    else process.env.DAILY_PAID_CALL_LIMIT = origFree;
    if (origPro === undefined) delete process.env.DAILY_PAID_CALL_LIMIT_PRO;
    else process.env.DAILY_PAID_CALL_LIMIT_PRO = origPro;
  });

  it("counts up to the tier ceiling and then blocks", async () => {
    getWebBillingStatus.mockResolvedValue({ hasPaid: true, tier: "pro", status: "active" });
    for (let i = 1; i <= 4; i++) {
      const r = await checkDailySpendForUser("pro-user", T0);
      expect(r).toMatchObject({ allowed: true, used: i, limit: 4 });
    }
    const blocked = await checkDailySpendForUser("pro-user", T0);
    expect(blocked.allowed).toBe(false);
    expect(blocked.used).toBe(4);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it("shares one counter with checkDailySpend — the tier only moves the ceiling", async () => {
    // A Pro user's usage must not reset just because a call went through the
    // bare function (or vice versa); the wrapper is a ceiling selector, not a
    // second budget.
    getWebBillingStatus.mockResolvedValue({ hasPaid: true, tier: "pro", status: "active" });
    await checkDailySpendForUser("shared-user", T0);
    const second = checkDailySpend("shared-user", T0);
    expect(second.used).toBe(2);
  });

  it("blocks a free user at the free ceiling even mid-day", async () => {
    getWebBillingStatus.mockResolvedValue({ hasPaid: false, tier: null, status: null });
    await checkDailySpendForUser("free-user", T0);
    await checkDailySpendForUser("free-user", T0);
    const blocked = await checkDailySpendForUser("free-user", T0);
    expect(blocked).toMatchObject({ allowed: false, used: 2, limit: 2 });
  });
});
