import { describe, it, expect } from "vitest";
import {
  percentile,
  median,
  stdev,
  getStrongProductThreshold,
  getQuickScoreGate,
  getBackfillThreshold,
  getDeepScoreKeepFloor,
  isWellSeparated,
  summarizeDistribution,
} from "@/lib/scoring/dynamic-thresholds";

describe("percentile", () => {
  it("returns the median for p=50", () => {
    expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3);
  });
  it("interpolates between adjacent values", () => {
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5);
  });
  it("clamps p<=0 to min and p>=100 to max", () => {
    expect(percentile([5, 1, 3], 0)).toBe(1);
    expect(percentile([5, 1, 3], 100)).toBe(5);
    expect(percentile([5, 1, 3], -10)).toBe(1);
    expect(percentile([5, 1, 3], 110)).toBe(5);
  });
  it("returns 0 for empty input", () => {
    expect(percentile([], 50)).toBe(0);
  });
  it("returns the only value for single-element input", () => {
    expect(percentile([7.3], 50)).toBe(7.3);
    expect(percentile([7.3], 100)).toBe(7.3);
  });
});

describe("median + stdev", () => {
  it("median delegates to percentile(50)", () => {
    expect(median([1, 2, 3, 4, 5])).toBe(3);
  });
  it("stdev returns 0 for fewer than 2 values", () => {
    expect(stdev([])).toBe(0);
    expect(stdev([5])).toBe(0);
  });
  it("stdev computes population standard deviation", () => {
    // mean = 3, variance = (4+1+0+1+4)/5 = 2, stdev = sqrt(2) ≈ 1.414
    expect(stdev([1, 2, 3, 4, 5])).toBeCloseTo(Math.sqrt(2), 5);
  });
});

describe("getStrongProductThreshold", () => {
  it("returns the floor for empty input", () => {
    expect(getStrongProductThreshold([])).toBe(5.0);
  });
  it("returns the 60th percentile for a normal-looking distribution", () => {
    // 10 values evenly spread 4-9, p60 should be ~7.0
    const scores = [4, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9];
    const t = getStrongProductThreshold(scores);
    expect(t).toBeGreaterThan(6.5);
    expect(t).toBeLessThanOrEqual(7.5);
  });
  it("respects the minFloor", () => {
    // All weak scores — p60 would be ~3 but minFloor 5 should kick in
    expect(getStrongProductThreshold([1, 2, 3, 3, 4])).toBe(5.0);
  });
  it("respects the maxCeiling", () => {
    // All-perfect scores — p60 would be 10 but maxCeiling 7.5 caps it
    expect(getStrongProductThreshold([9.5, 9.6, 9.7, 9.8, 9.9])).toBe(7.5);
  });
});

describe("getQuickScoreGate", () => {
  it("keeps the top 60% by default", () => {
    // 10 scores 1-10, keep top 60% → cutoff at p40 = 4.6
    const scores = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const cutoff = getQuickScoreGate(scores);
    expect(cutoff).toBeGreaterThanOrEqual(4.0);
    expect(cutoff).toBeLessThan(6.0);
  });
  it("respects minFloor", () => {
    expect(getQuickScoreGate([1, 1.5, 2])).toBe(4.0);
  });
  it("respects maxCeiling", () => {
    expect(getQuickScoreGate([9, 9.5, 9.8, 10])).toBe(7.0);
  });
});

describe("getBackfillThreshold", () => {
  it("scales with product count, bounded by min/max", () => {
    expect(getBackfillThreshold(0)).toBe(2); // min floor
    expect(getBackfillThreshold(4)).toBe(2); // 25% of 4 = 1, but min is 2
    expect(getBackfillThreshold(8)).toBe(2); // 25% of 8 = 2
    expect(getBackfillThreshold(12)).toBe(3); // 25% of 12 = 3
    expect(getBackfillThreshold(20)).toBe(4); // 25% of 20 = 5, but max is 4
    expect(getBackfillThreshold(100)).toBe(4); // capped at max
  });
});

describe("getDeepScoreKeepFloor", () => {
  it("returns 25th percentile bounded by floor and ceiling", () => {
    const scores = [4, 5, 6, 7, 8];
    const f = getDeepScoreKeepFloor(scores);
    // p25 of [4,5,6,7,8] = 5, minFloor 5.0, maxCeiling 6.5 → 5.0
    expect(f).toBe(5.0);
  });
  it("respects minFloor for low distributions", () => {
    expect(getDeepScoreKeepFloor([1, 2, 3])).toBe(5.0);
  });
  it("respects maxCeiling for high distributions", () => {
    // p25 of [9,9.2,9.4,9.6,9.8] = 9.2, but maxCeiling 6.5 caps
    expect(getDeepScoreKeepFloor([9, 9.2, 9.4, 9.6, 9.8])).toBe(6.5);
  });
});

describe("isWellSeparated", () => {
  it("reports true when separation exceeds 1 stdev of full distribution", () => {
    const dist = [5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9];
    const top = [9, 7]; // gap of 2, stdev ~1.3
    expect(isWellSeparated(top, dist)).toBe(true);
  });
  it("reports false when separation is below 1 stdev", () => {
    const dist = [5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9];
    const top = [8, 7.5]; // gap of 0.5, stdev ~1.3
    expect(isWellSeparated(top, dist)).toBe(false);
  });
  it("falls back to absolute gap when stdev is degenerate", () => {
    // All same scores → stdev ~0 → use minAbsoluteGap (default 1.5)
    const dist = [7, 7, 7, 7];
    expect(isWellSeparated([8, 6], dist)).toBe(true); // gap 2 > 1.5
    expect(isWellSeparated([7.5, 7], dist)).toBe(false); // gap 0.5 < 1.5
  });
});

describe("summarizeDistribution", () => {
  it("returns zeros for empty input", () => {
    const s = summarizeDistribution([]);
    expect(s.count).toBe(0);
    expect(s.median).toBe(0);
    expect(s.stdev).toBe(0);
  });
  it("computes correct stats for a known distribution", () => {
    const s = summarizeDistribution([1, 2, 3, 4, 5]);
    expect(s.count).toBe(5);
    expect(s.min).toBe(1);
    expect(s.max).toBe(5);
    expect(s.median).toBe(3);
    expect(s.mean).toBe(3);
    expect(s.stdev).toBeCloseTo(Math.sqrt(2), 5);
  });
});
