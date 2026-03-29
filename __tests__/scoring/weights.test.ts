import { describe, it, expect } from "vitest";
import { PRODUCT_WEIGHTS, BUNDLE_WEIGHTS, VERDICT_THRESHOLDS } from "@/lib/scoring/weights";

describe("PRODUCT_WEIGHTS", () => {
  it("should sum to exactly 1.0", () => {
    const sum = Object.values(PRODUCT_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(Math.round(sum * 100) / 100).toBe(1.0);
  });

  it("should have all required dimensions", () => {
    const requiredKeys = [
      "style_fit",
      "palette_fit",
      "material_fit",
      "scale_fit",
      "function_fit",
      "cohesion_fit",
      "value_fit",
    ];
    for (const key of requiredKeys) {
      expect(PRODUCT_WEIGHTS).toHaveProperty(key);
    }
  });

  it("should have 7 dimensions", () => {
    expect(Object.keys(PRODUCT_WEIGHTS)).toHaveLength(7);
  });

  it("should have all weights between 0 and 1", () => {
    for (const [key, weight] of Object.entries(PRODUCT_WEIGHTS)) {
      expect(weight, `${key} should be > 0`).toBeGreaterThan(0);
      expect(weight, `${key} should be < 1`).toBeLessThan(1);
    }
  });

  it("style_fit and scale_fit should be the heaviest", () => {
    const maxWeight = Math.max(...Object.values(PRODUCT_WEIGHTS));
    expect(PRODUCT_WEIGHTS.style_fit).toBe(maxWeight);
    expect(PRODUCT_WEIGHTS.scale_fit).toBe(maxWeight);
  });
});

describe("BUNDLE_WEIGHTS", () => {
  it("should sum to exactly 1.0", () => {
    const sum = Object.values(BUNDLE_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(Math.round(sum * 100) / 100).toBe(1.0);
  });

  it("should have all required dimensions including spatial_arrangement", () => {
    const requiredKeys = [
      "palette_harmony",
      "material_balance",
      "scale_balance",
      "style_consistency",
      "room_completion",
      "spatial_arrangement",
      "practicality",
    ];
    for (const key of requiredKeys) {
      expect(BUNDLE_WEIGHTS).toHaveProperty(key);
    }
  });

  it("should have 7 dimensions", () => {
    expect(Object.keys(BUNDLE_WEIGHTS)).toHaveLength(7);
  });

  it("should have all weights between 0 and 1", () => {
    for (const [key, weight] of Object.entries(BUNDLE_WEIGHTS)) {
      expect(weight, `${key} should be > 0`).toBeGreaterThan(0);
      expect(weight, `${key} should be < 1`).toBeLessThan(1);
    }
  });

  it("spatial_arrangement should have meaningful weight (>= 0.10)", () => {
    expect(BUNDLE_WEIGHTS.spatial_arrangement).toBeGreaterThanOrEqual(0.1);
  });
});

describe("VERDICT_THRESHOLDS", () => {
  it("should have strong_yes, yes, and maybe thresholds", () => {
    expect(VERDICT_THRESHOLDS).toHaveProperty("strong_yes");
    expect(VERDICT_THRESHOLDS).toHaveProperty("yes");
    expect(VERDICT_THRESHOLDS).toHaveProperty("maybe");
  });

  it("strong_yes should require higher score than yes", () => {
    expect(VERDICT_THRESHOLDS.strong_yes.min_score).toBeGreaterThan(
      VERDICT_THRESHOLDS.yes.min_score
    );
  });

  it("yes should require higher score than maybe", () => {
    expect(VERDICT_THRESHOLDS.yes.min_score).toBeGreaterThan(
      VERDICT_THRESHOLDS.maybe.min_score
    );
  });

  it("strong_yes should require higher confidence than yes", () => {
    expect(VERDICT_THRESHOLDS.strong_yes.min_confidence).toBeGreaterThan(
      VERDICT_THRESHOLDS.yes.min_confidence
    );
  });
});
