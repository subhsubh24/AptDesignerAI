import { describe, it, expect } from "vitest";
import {
  getSearchTiers,
  trackExtraction,
  isDomainBlocked,
  tierFitScore,
} from "@/lib/agents/orchestrator";

/**
 * Pure primitives living inside/near `runAgenticSearch`'s main dispatch entry
 * (APT-13's remaining scope — the ~2800-line function itself is not
 * realistically unit-testable, so these are the deterministic pieces pulled
 * out and pinned individually).
 */

describe("getSearchTiers", () => {
  it("maps 'budget' to the budget tier only", () => {
    expect(getSearchTiers("budget")).toEqual(["budget"]);
  });

  it("maps 'best_possible' to the high_end tier only", () => {
    expect(getSearchTiers("best_possible")).toEqual(["high_end"]);
  });

  it("falls back to the balanced tier for any unrecognized mode", () => {
    expect(getSearchTiers("whatever")).toEqual(["balanced"]);
    expect(getSearchTiers("")).toEqual(["balanced"]);
  });

  it("always returns exactly one tier — callers rely on a single-tier search", () => {
    for (const mode of ["budget", "best_possible", "balanced", "unknown"]) {
      expect(getSearchTiers(mode)).toHaveLength(1);
    }
  });
});

describe("trackExtraction / isDomainBlocked", () => {
  it("stays unblocked below the 5-sample floor even at a 100% sentinel rate", () => {
    const host = "https://sparse-sentinel-example.test/product";
    for (let i = 0; i < 4; i++) trackExtraction(host, true);
    expect(isDomainBlocked(host)).toBe(false);
  });

  it("blocks once 5+ samples cross the 0.8 sentinel-rate threshold", () => {
    const host = "https://all-sentinel-example.test/product";
    for (let i = 0; i < 5; i++) trackExtraction(host, true);
    expect(isDomainBlocked(host)).toBe(true);
  });

  it("does NOT block exactly at the 0.8 boundary (strict greater-than)", () => {
    const host = "https://boundary-sentinel-example.test/product";
    // 4 of 5 sentinel = ratio 0.8 exactly — must stay unblocked.
    trackExtraction(host, true);
    trackExtraction(host, true);
    trackExtraction(host, true);
    trackExtraction(host, true);
    trackExtraction(host, false);
    expect(isDomainBlocked(host)).toBe(false);
  });

  it("blocks once the ratio moves strictly above 0.8", () => {
    const host = "https://above-boundary-sentinel-example.test/product";
    // 5 of 6 sentinel = ratio 0.8333... — strictly above 0.8.
    for (let i = 0; i < 5; i++) trackExtraction(host, true);
    trackExtraction(host, false);
    expect(isDomainBlocked(host)).toBe(true);
  });

  it("blocks a proactively-blocklisted domain even with zero tracked extractions", () => {
    expect(isDomainBlocked("https://www.reddit.com/r/somethread")).toBe(true);
  });

  it("does not throw on an invalid URL passed to either function", () => {
    expect(() => trackExtraction("not-a-url", true)).not.toThrow();
    expect(isDomainBlocked("not-a-url")).toBe(false);
  });
});

describe("tierFitScore", () => {
  const range = { min: 100, max: 200 };

  it("scores a price inside the range as a perfect fit", () => {
    expect(tierFitScore(150, range)).toBe(1.0);
  });

  it("scores the exact min/max boundary as a perfect fit", () => {
    expect(tierFitScore(100, range)).toBe(1.0);
    expect(tierFitScore(200, range)).toBe(1.0);
  });

  it("scores the outer edge of the ±40% partial band as 0", () => {
    // range.min * 0.6 = 60 exactly; range.max * 1.4 = 280 exactly.
    expect(tierFitScore(60, range)).toBe(0);
    expect(tierFitScore(280, range)).toBe(0);
  });

  it("returns -Infinity just outside the partial band", () => {
    expect(tierFitScore(59, range)).toBe(-Infinity);
    expect(tierFitScore(281, range)).toBe(-Infinity);
  });

  it("returns -Infinity when no range is given", () => {
    expect(tierFitScore(150, undefined)).toBe(-Infinity);
  });

  it("scores partial fit below the range as an inverse-distance value between 0 and 1", () => {
    // Halfway into the below-range partial band (60..100): price 80 →
    // 1 - (100-80)/(100*0.4) = 1 - 20/40 = 0.5.
    expect(tierFitScore(80, range)).toBeCloseTo(0.5, 5);
  });

  it("scores partial fit above the range as an inverse-distance value between 0 and 1", () => {
    // Halfway into the above-range partial band (200..280): price 240 →
    // 1 - (240-200)/(200*0.4) = 1 - 40/80 = 0.5.
    expect(tierFitScore(240, range)).toBeCloseTo(0.5, 5);
  });
});
