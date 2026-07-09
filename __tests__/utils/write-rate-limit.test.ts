import { describe, it, expect } from "vitest";
import { enforceWriteRateLimit } from "@/lib/utils/write-rate-limit";

describe("enforceWriteRateLimit", () => {
  it("allows requests under the limit (returns null)", () => {
    const cfg = { maxRequests: 3, windowMs: 60_000 };
    const user = `u-${Math.random()}`;
    expect(enforceWriteRateLimit(user, "test", cfg)).toBeNull();
    expect(enforceWriteRateLimit(user, "test", cfg)).toBeNull();
    expect(enforceWriteRateLimit(user, "test", cfg)).toBeNull();
  });

  it("returns a 429 response once the limit is exceeded", async () => {
    const cfg = { maxRequests: 2, windowMs: 60_000 };
    const user = `u-${Math.random()}`;
    enforceWriteRateLimit(user, "test", cfg);
    enforceWriteRateLimit(user, "test", cfg);
    const blocked = enforceWriteRateLimit(user, "test", cfg);
    expect(blocked).not.toBeNull();
    expect(blocked!.status).toBe(429);
    expect(blocked!.headers.get("Retry-After")).toBeTruthy();
    const json = await blocked!.json();
    expect(json.error).toMatch(/too many/i);
  });

  it("keys the limit per user — one user's usage never throttles another", () => {
    const cfg = { maxRequests: 1, windowMs: 60_000 };
    const a = `a-${Math.random()}`;
    const b = `b-${Math.random()}`;
    expect(enforceWriteRateLimit(a, "test", cfg)).toBeNull();
    expect(enforceWriteRateLimit(a, "test", cfg)).not.toBeNull(); // a is now over
    expect(enforceWriteRateLimit(b, "test", cfg)).toBeNull(); // b is unaffected
  });

  it("keys the limit per bucket — different endpoints do not share a budget", () => {
    const cfg = { maxRequests: 1, windowMs: 60_000 };
    const user = `u-${Math.random()}`;
    expect(enforceWriteRateLimit(user, "bucket-one", cfg)).toBeNull();
    expect(enforceWriteRateLimit(user, "bucket-two", cfg)).toBeNull();
  });
});
