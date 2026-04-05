import { describe, it, expect } from "vitest";
import { computeFinalBundleScore } from "@/lib/scoring/bundle-scorer";
import type { BundleScores } from "@/lib/types/scoring";

function makeBundleScores(override: Partial<BundleScores> = {}): BundleScores {
  return {
    palette_harmony_score: 7,
    material_balance_score: 7,
    scale_balance_score: 7,
    style_consistency_score: 7,
    room_completion_score: 7,
    practicality_score: 7,
    ...override,
  };
}

describe("computeFinalBundleScore", () => {
  it("should return less than arithmetic mean when spatial defaults to 5 (geometric compounding)", () => {
    // When spatial_arrangement_score is undefined, it defaults to 5.
    // Geometric mean penalizes the low spatial score more than arithmetic mean would.
    // Arithmetic would give ~6.68; geometric mean gives lower due to compounding.
    const scores = makeBundleScores();
    const result = computeFinalBundleScore(scores);
    expect(result).toBeLessThan(6.68);
    expect(result).toBeGreaterThan(5.5);
  });

  it("should return 7.0 when all scores including spatial are 7", () => {
    const scores = makeBundleScores({ spatial_arrangement_score: 7 });
    const result = computeFinalBundleScore(scores);
    expect(result).toBe(7);
  });

  it("should return 10.0 when all scores are 10", () => {
    const scores: BundleScores = {
      palette_harmony_score: 10,
      material_balance_score: 10,
      scale_balance_score: 10,
      style_consistency_score: 10,
      room_completion_score: 10,
      spatial_arrangement_score: 10,
      practicality_score: 10,
    };
    expect(computeFinalBundleScore(scores)).toBe(10);
  });

  it("should return floor value (0.5) when all scores are 0", () => {
    // With geometric mean and a floor of 0.5, all-zero scores clamp to 0.5
    const scores: BundleScores = {
      palette_harmony_score: 0,
      material_balance_score: 0,
      scale_balance_score: 0,
      style_consistency_score: 0,
      room_completion_score: 0,
      spatial_arrangement_score: 0,
      practicality_score: 0,
    };
    expect(computeFinalBundleScore(scores)).toBe(0.5);
  });

  it("should default spatial_arrangement_score to 5 when undefined", () => {
    const withSpatial = makeBundleScores({ spatial_arrangement_score: 5 });
    const withoutSpatial = makeBundleScores(); // spatial is undefined
    expect(computeFinalBundleScore(withSpatial)).toBe(
      computeFinalBundleScore(withoutSpatial)
    );
  });

  it("should produce higher score when spatial_arrangement is high vs default", () => {
    const highSpatial = makeBundleScores({ spatial_arrangement_score: 9 });
    const defaultSpatial = makeBundleScores(); // defaults to 5
    expect(computeFinalBundleScore(highSpatial)).toBeGreaterThan(
      computeFinalBundleScore(defaultSpatial)
    );
  });

  it("should round to 2 decimal places", () => {
    const scores = makeBundleScores({
      palette_harmony_score: 3,
      material_balance_score: 8,
      spatial_arrangement_score: 6,
    });
    const result = computeFinalBundleScore(scores);
    const decimalPlaces = (result.toString().split(".")[1] || "").length;
    expect(decimalPlaces).toBeLessThanOrEqual(2);
  });

  it("should return value between 0 and 10", () => {
    const scores = makeBundleScores({
      palette_harmony_score: 2,
      material_balance_score: 9,
      scale_balance_score: 4,
      style_consistency_score: 8,
      room_completion_score: 3,
      spatial_arrangement_score: 7,
      practicality_score: 6,
    });
    const result = computeFinalBundleScore(scores);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(10);
  });
});
