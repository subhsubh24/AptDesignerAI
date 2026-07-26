import { describe, it, expect } from "vitest";

import {
  PRO_GENERATION_LIMIT_MULTIPLIER,
  generationLimitFor,
} from "@/lib/entitlements/generation-limits";
import { RATE_LIMITS, checkRateLimit } from "@/lib/utils/rate-limiter";

// "Higher AI generation limits" is sold as a Pro benefit on the pricing and
// upgrade pages. Before this module every generation endpoint applied one flat
// config to free and Pro alike, so the advertised benefit did not exist. These
// tests pin the two properties that make the claim true AND safe: a paying
// subscriber gets strictly more headroom, and a free user's limit is completely
// untouched.

describe("generationLimitFor", () => {
  it("returns the base config UNCHANGED for a free user", () => {
    for (const config of [
      RATE_LIMITS.diagnosis,
      RATE_LIMITS.mockup,
      RATE_LIMITS.recommendationMockup,
      RATE_LIMITS.areaAnalysis,
      RATE_LIMITS.analyzeApartment,
      RATE_LIMITS.floorPlanExtract,
    ]) {
      expect(generationLimitFor(config, false)).toEqual(config);
    }
  });

  it("multiplies only the allowance, never the window", () => {
    const widened = generationLimitFor(RATE_LIMITS.areaAnalysis, true);
    expect(widened.maxRequests).toBe(
      RATE_LIMITS.areaAnalysis.maxRequests * PRO_GENERATION_LIMIT_MULTIPLIER,
    );
    // Widening the WINDOW would change how a burst is smoothed rather than
    // how much a subscriber can do — that is a different (and worse) benefit.
    expect(widened.windowMs).toBe(RATE_LIMITS.areaAnalysis.windowMs);
  });

  it("gives a paid subscriber strictly more headroom on every generation surface", () => {
    for (const config of [
      RATE_LIMITS.diagnosis,
      RATE_LIMITS.mockup,
      RATE_LIMITS.recommendationMockup,
      RATE_LIMITS.areaAnalysis,
      RATE_LIMITS.analyzeApartment,
      RATE_LIMITS.floorPlanExtract,
    ]) {
      expect(generationLimitFor(config, true).maxRequests).toBeGreaterThan(config.maxRequests);
    }
  });

  it("does not mutate the shared RATE_LIMITS config it was handed", () => {
    // The configs are module-level singletons. Mutating one would leak the Pro
    // allowance to every subsequent free-user request in the same process —
    // an entitlement bypass that no per-request test would catch.
    const before = { ...RATE_LIMITS.mockup };
    generationLimitFor(RATE_LIMITS.mockup, true);
    expect(RATE_LIMITS.mockup).toEqual(before);
  });
});

describe("the widened limit as the limiter actually applies it", () => {
  it("blocks a free user at the base allowance and lets Pro keep going", () => {
    const base = RATE_LIMITS.mockup;
    const freeKey = `test-free-${Math.random()}`;
    const proKey = `test-pro-${Math.random()}`;

    // Free: exhaust exactly the base allowance, then the next call is refused.
    for (let i = 0; i < base.maxRequests; i++) {
      expect(checkRateLimit(freeKey, generationLimitFor(base, false)).allowed).toBe(true);
    }
    expect(checkRateLimit(freeKey, generationLimitFor(base, false)).allowed).toBe(false);

    // Pro: the same number of calls leaves real headroom left.
    for (let i = 0; i < base.maxRequests; i++) {
      expect(checkRateLimit(proKey, generationLimitFor(base, true)).allowed).toBe(true);
    }
    const next = checkRateLimit(proKey, generationLimitFor(base, true));
    expect(next.allowed).toBe(true);
    expect(next.remaining).toBeGreaterThan(0);
  });

  it("still refuses Pro once the widened allowance is spent", () => {
    // The benefit is a bigger bucket, not an unlimited one — a subscriber is
    // still bounded, which is what keeps the abuse story intact.
    const base = RATE_LIMITS.diagnosis;
    const key = `test-pro-cap-${Math.random()}`;
    const proConfig = generationLimitFor(base, true);
    for (let i = 0; i < proConfig.maxRequests; i++) {
      expect(checkRateLimit(key, proConfig).allowed).toBe(true);
    }
    expect(checkRateLimit(key, proConfig).allowed).toBe(false);
  });
});

// The tier predicate this module is paired with. `hasProEntitlementWeb` answers
// "has this user paid for ANYTHING" — it returns true for the $29 one-time
// Apartment tier too. "Higher AI generation limits" is listed only under Pro,
// so the generation routes must use `hasProSubscriptionWeb`. Wiring the wrong
// one compiles, passes every other test, and silently hands Apartment buyers a
// Pro differentiator — erasing the difference between the two paid tiers.
describe("the generation routes gate on the PRO SUBSCRIPTION, not on 'has paid'", () => {
  const ROUTES = [
    "app/api/diagnosis/route.ts",
    "app/api/diagnosis/stream/route.ts",
    "app/api/mockups/route.ts",
    "app/api/area-analysis/route.ts",
    "app/api/area-analysis/refine/route.ts",
    "app/api/area-analysis/refine-chat/route.ts",
    "app/api/analyze-apartment/route.ts",
    "app/api/apartment-research/route.ts",
    "app/api/projects/[projectId]/floor-plan/route.ts",
  ];

  it.each(ROUTES)("%s uses hasProSubscriptionWeb and never hasProEntitlementWeb", async (route) => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    // Resolve from this file, not the cwd — the precedent ratchets
    // (__tests__/ai/harness-ratchet.test.ts) do the same so the suite still
    // passes when vitest is invoked from somewhere other than the repo root.
    const src = readFileSync(join(__dirname, "..", "..", route), "utf8");
    expect(src).toContain("hasProSubscriptionWeb");
    expect(src).not.toContain("hasProEntitlementWeb");
    // Assert the resolved tier actually REACHES the widening call. Textual
    // presence alone would pass even if someone left the await in place and
    // hardcoded `generationLimitFor(config, false)` beside it.
    expect(src).toMatch(/const isPro = await hasProSubscriptionWeb\(user\.id\)/);
    expect(src).toMatch(/generationLimitFor\([^,)]+,\s*isPro\)/);
  });
});
