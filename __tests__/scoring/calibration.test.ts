import { describe, it, expect } from "vitest";
import {
  applyCategoryBaseline,
  expandScore,
  correctInflation,
  calibrateScore,
  CATEGORY_BASELINES,
} from "@/lib/scoring/calibration";

describe("CATEGORY_BASELINES", () => {
  it("should have adjustments that are small (between -1 and 1)", () => {
    for (const [, adj] of Object.entries(CATEGORY_BASELINES)) {
      expect(adj).toBeGreaterThanOrEqual(-1);
      expect(adj).toBeLessThanOrEqual(1);
    }
  });
});

describe("applyCategoryBaseline", () => {
  it("should apply negative adjustment for rugs", () => {
    const adjusted = applyCategoryBaseline(7.0, "rug");
    expect(adjusted).toBe(6.7);
  });

  it("should apply positive adjustment for accent chairs", () => {
    const adjusted = applyCategoryBaseline(7.0, "accent_chair");
    expect(adjusted).toBe(7.2);
  });

  it("should apply no adjustment for unknown categories", () => {
    const adjusted = applyCategoryBaseline(7.0, "unknown_category");
    expect(adjusted).toBe(7.0);
  });

  it("should clamp to 0-10 range", () => {
    expect(applyCategoryBaseline(0.1, "rug")).toBeGreaterThanOrEqual(0);
    expect(applyCategoryBaseline(9.9, "accent_chair")).toBeLessThanOrEqual(10);
  });

  it("should be case-insensitive", () => {
    expect(applyCategoryBaseline(7.0, "RUG")).toBe(6.7);
  });
});

describe("expandScore", () => {
  it("should push scores away from the mean", () => {
    // Score above mean should go higher
    expect(expandScore(8.0, 6.5, 1.2)).toBeGreaterThan(8.0);
    // Score below mean should go lower
    expect(expandScore(5.0, 6.5, 1.2)).toBeLessThan(5.0);
  });

  it("should not change score at the mean", () => {
    expect(expandScore(6.5, 6.5, 1.2)).toBe(6.5);
  });

  it("should clamp to 0-10", () => {
    expect(expandScore(9.5, 6.5, 2.0)).toBeLessThanOrEqual(10);
    expect(expandScore(1.0, 6.5, 2.0)).toBeGreaterThanOrEqual(0);
  });

  it("should be identity when expansion factor is 1.0", () => {
    expect(expandScore(7.5, 6.5, 1.0)).toBe(7.5);
  });
});

describe("correctInflation", () => {
  it("should not adjust when median is below threshold", () => {
    expect(correctInflation(7.0, 6.5, 6.0, 7.5)).toBe(7.0);
  });

  it("should adjust down when median exceeds threshold", () => {
    const adjusted = correctInflation(7.0, 8.0, 6.0, 7.5);
    expect(adjusted).toBeLessThan(7.0);
  });

  it("should clamp to 0-10", () => {
    expect(correctInflation(1.0, 9.0, 6.0, 7.5)).toBeGreaterThanOrEqual(0);
  });

  it("should apply proportional correction", () => {
    // Median 8.0, target 6.0 → correction = (8-6)*0.5 = 1.0
    expect(correctInflation(7.0, 8.0, 6.0, 7.5)).toBe(6.0);
    // Median 9.0, target 6.0 → correction = (9-6)*0.5 = 1.5
    expect(correctInflation(7.0, 9.0, 6.0, 7.5)).toBe(5.5);
  });
});

describe("calibrateScore", () => {
  it("should return raw score when no drift data available", () => {
    const result = calibrateScore(7.0, "sofa");
    // sofa has 0 baseline, no drift data → just baseline applied
    expect(result).toBe(7.0);
  });

  it("should apply category baseline", () => {
    const result = calibrateScore(7.0, "rug", undefined, undefined, { applyExpansion: false });
    expect(result).toBe(6.7);
  });

  it("should apply expansion when mean is provided", () => {
    const result = calibrateScore(8.0, "sofa", undefined, 6.5, { applyBaselines: false });
    // 6.5 + 1.2 * (8.0 - 6.5) = 6.5 + 1.8 = 8.3
    expect(result).toBeGreaterThan(8.0);
  });

  it("should apply inflation correction when median is provided and high", () => {
    const result = calibrateScore(7.0, "sofa", 8.0, undefined, { applyBaselines: false, applyExpansion: false });
    expect(result).toBeLessThan(7.0);
  });

  it("should chain all adjustments", () => {
    // rug: baseline -0.3, with high median and compressed mean
    const result = calibrateScore(7.5, "rug", 8.0, 7.0);
    // Should be lower than 7.5 due to rug baseline + inflation correction
    expect(result).toBeLessThan(7.5);
  });

  it("should always return value between 0 and 10", () => {
    expect(calibrateScore(10.0, "accent_chair", 5.0, 5.0)).toBeLessThanOrEqual(10);
    expect(calibrateScore(0.0, "rug", 9.0, 9.0)).toBeGreaterThanOrEqual(0);
  });

  it("should round to 2 decimal places", () => {
    const result = calibrateScore(7.123456, "sofa");
    const decimals = (result.toString().split(".")[1] || "").length;
    expect(decimals).toBeLessThanOrEqual(2);
  });
});
