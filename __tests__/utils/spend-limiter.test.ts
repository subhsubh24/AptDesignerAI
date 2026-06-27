import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetDailySpend,
  checkDailySpend,
  dailySpendExceededResponse,
} from "@/lib/utils/spend-limiter";

const T0 = Date.UTC(2026, 5, 27, 10, 0, 0); // fixed instant for deterministic tests

describe("checkDailySpend", () => {
  const orig = process.env.DAILY_PAID_CALL_LIMIT;
  beforeEach(() => {
    __resetDailySpend();
  });
  afterEach(() => {
    if (orig === undefined) delete process.env.DAILY_PAID_CALL_LIMIT;
    else process.env.DAILY_PAID_CALL_LIMIT = orig;
  });

  it("allows calls up to the limit then blocks", () => {
    process.env.DAILY_PAID_CALL_LIMIT = "3";
    expect(checkDailySpend("u1", T0)).toMatchObject({ allowed: true, used: 1, limit: 3 });
    expect(checkDailySpend("u1", T0)).toMatchObject({ allowed: true, used: 2 });
    expect(checkDailySpend("u1", T0)).toMatchObject({ allowed: true, used: 3 });
    const blocked = checkDailySpend("u1", T0);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it("does not consume budget on a rejected call", () => {
    process.env.DAILY_PAID_CALL_LIMIT = "2";
    checkDailySpend("u2", T0);
    checkDailySpend("u2", T0);
    const a = checkDailySpend("u2", T0);
    const b = checkDailySpend("u2", T0);
    expect(a.allowed).toBe(false);
    expect(b.allowed).toBe(false);
    expect(a.used).toBe(2);
    expect(b.used).toBe(2); // stays pinned, never climbs past the limit
  });

  it("tracks each user independently", () => {
    process.env.DAILY_PAID_CALL_LIMIT = "1";
    expect(checkDailySpend("alice", T0).allowed).toBe(true);
    expect(checkDailySpend("alice", T0).allowed).toBe(false);
    expect(checkDailySpend("bob", T0).allowed).toBe(true);
  });

  it("resets after the UTC day rolls over", () => {
    process.env.DAILY_PAID_CALL_LIMIT = "1";
    expect(checkDailySpend("u3", T0).allowed).toBe(true);
    expect(checkDailySpend("u3", T0).allowed).toBe(false);
    const nextDay = T0 + 24 * 60 * 60 * 1000;
    expect(checkDailySpend("u3", nextDay).allowed).toBe(true);
  });

  it("falls back to the default limit on a bad env value", () => {
    process.env.DAILY_PAID_CALL_LIMIT = "not-a-number";
    expect(checkDailySpend("u4", T0).limit).toBe(60);
  });

  it("falls back to the default limit when env is zero", () => {
    process.env.DAILY_PAID_CALL_LIMIT = "0";
    expect(checkDailySpend("u4b", T0).limit).toBe(60);
  });

  it("falls back to the default limit when env is negative", () => {
    process.env.DAILY_PAID_CALL_LIMIT = "-5";
    expect(checkDailySpend("u4c", T0).limit).toBe(60);
  });

  it("uses the default limit when env is unset", () => {
    delete process.env.DAILY_PAID_CALL_LIMIT;
    expect(checkDailySpend("u5", T0).limit).toBe(60);
  });
});

describe("dailySpendExceededResponse", () => {
  it("returns a 429 with a Retry-After header and a generic message", async () => {
    const res = dailySpendExceededResponse({
      allowed: false,
      used: 60,
      limit: 60,
      retryAfterMs: 5000,
    });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("5");
    const body = await res.json();
    expect(body.error).toMatch(/daily usage limit/i);
  });

  it("never emits a Retry-After below 1 second", () => {
    const res = dailySpendExceededResponse({ allowed: false, used: 1, limit: 1, retryAfterMs: 200 });
    expect(res.headers.get("Retry-After")).toBe("1");
  });
});
