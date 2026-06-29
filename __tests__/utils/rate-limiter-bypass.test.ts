import { afterEach, describe, expect, it } from "vitest";
import { assertRateLimitBypassSafe, rateLimitBypassedForTest } from "@/lib/utils/rate-limiter";

// Guards the TEST-ONLY rate-limit bypass: it must work in CI (no VERCEL env) but
// HARD-REFUSE on any deployed (Vercel) environment. A silent prod bypass = a
// wallet-drain/abuse hole, so this regression test locks the fail-closed behavior.

const origBypass = process.env.E2E_RATE_LIMIT_BYPASS;
const origVercel = process.env.VERCEL;

afterEach(() => {
  if (origBypass === undefined) delete process.env.E2E_RATE_LIMIT_BYPASS;
  else process.env.E2E_RATE_LIMIT_BYPASS = origBypass;
  if (origVercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = origVercel;
});

describe("rate-limit test bypass (fail-closed on deploy)", () => {
  it("is OFF by default (no env)", () => {
    delete process.env.E2E_RATE_LIMIT_BYPASS;
    delete process.env.VERCEL;
    expect(rateLimitBypassedForTest()).toBe(false);
    expect(() => assertRateLimitBypassSafe()).not.toThrow();
  });

  it("is ON in CI/local when the env is set and NOT on Vercel", () => {
    process.env.E2E_RATE_LIMIT_BYPASS = "1";
    delete process.env.VERCEL;
    expect(rateLimitBypassedForTest()).toBe(true);
    expect(() => assertRateLimitBypassSafe()).not.toThrow();
  });

  it("HARD-REFUSES (throws) if the bypass env is set on a Vercel deploy", () => {
    process.env.E2E_RATE_LIMIT_BYPASS = "1";
    process.env.VERCEL = "1";
    expect(() => assertRateLimitBypassSafe()).toThrow(/E2E_RATE_LIMIT_BYPASS is set on a deployed/);
  });

  it("does not refuse on Vercel when the bypass env is absent", () => {
    delete process.env.E2E_RATE_LIMIT_BYPASS;
    process.env.VERCEL = "1";
    expect(() => assertRateLimitBypassSafe()).not.toThrow();
  });
});
