import { describe, it, expect } from "vitest";
import { computeFinalItemScore, determineVerdict } from "@/lib/scoring/product-scorer";
import type { ProductScores } from "@/lib/types/scoring";

function makeScores(override: Partial<ProductScores> = {}): ProductScores {
  return {
    style_fit_score: 7,
    palette_fit_score: 7,
    material_fit_score: 7,
    scale_fit_score: 7,
    function_fit_score: 7,
    cohesion_fit_score: 7,
    value_fit_score: 7,
    confidence_score: 8,
    ...override,
  };
}

describe("computeFinalItemScore", () => {
  it("should return 7.0 when all scores are 7", () => {
    const score = computeFinalItemScore(makeScores());
    expect(score).toBe(7);
  });

  it("should return 10.0 when all scores are 10", () => {
    const scores = makeScores({
      style_fit_score: 10,
      palette_fit_score: 10,
      material_fit_score: 10,
      scale_fit_score: 10,
      function_fit_score: 10,
      cohesion_fit_score: 10,
      value_fit_score: 10,
    });
    const score = computeFinalItemScore(scores);
    expect(score).toBe(10);
  });

  it("should return floor value (0.5) when all scores are 0", () => {
    // With geometric mean and a floor of 0.5, all-zero scores clamp to 0.5
    const scores = makeScores({
      style_fit_score: 0,
      palette_fit_score: 0,
      material_fit_score: 0,
      scale_fit_score: 0,
      function_fit_score: 0,
      cohesion_fit_score: 0,
      value_fit_score: 0,
    });
    const score = computeFinalItemScore(scores);
    expect(score).toBe(0.5);
  });

  it("should penalize one bad dimension more than arithmetic mean would", () => {
    // One dimension at 2, rest at 9
    const scores = makeScores({
      style_fit_score: 9,
      palette_fit_score: 9,
      material_fit_score: 2,
      scale_fit_score: 9,
      function_fit_score: 9,
      cohesion_fit_score: 9,
      value_fit_score: 9,
    });
    const score = computeFinalItemScore(scores);
    // Arithmetic mean would be ~8.16 (weighted)
    // Geometric mean should be noticeably lower due to compounding
    expect(score).toBeLessThan(8);
    expect(score).toBeGreaterThan(4);
  });

  it("should NOT include confidence_score in the weighted sum", () => {
    const withHighConfidence = makeScores({ confidence_score: 10 });
    const withLowConfidence = makeScores({ confidence_score: 1 });
    expect(computeFinalItemScore(withHighConfidence)).toBe(
      computeFinalItemScore(withLowConfidence)
    );
  });

  it("should weight style_fit and scale_fit most heavily", () => {
    // High style_fit should produce higher score than high value_fit
    const highStyle = makeScores({
      style_fit_score: 10,
      palette_fit_score: 5,
      material_fit_score: 5,
      scale_fit_score: 5,
      function_fit_score: 5,
      cohesion_fit_score: 5,
      value_fit_score: 5,
    });
    const highValue = makeScores({
      style_fit_score: 5,
      palette_fit_score: 5,
      material_fit_score: 5,
      scale_fit_score: 5,
      function_fit_score: 5,
      cohesion_fit_score: 5,
      value_fit_score: 10,
    });
    expect(computeFinalItemScore(highStyle)).toBeGreaterThan(
      computeFinalItemScore(highValue)
    );
  });

  it("should return a value between 0 and 10", () => {
    const randomScores = makeScores({
      style_fit_score: 3,
      palette_fit_score: 8,
      material_fit_score: 5,
      scale_fit_score: 9,
      function_fit_score: 2,
      cohesion_fit_score: 6,
      value_fit_score: 4,
    });
    const score = computeFinalItemScore(randomScores);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(10);
  });

  it("should round to 2 decimal places", () => {
    const scores = makeScores({
      style_fit_score: 3,
      palette_fit_score: 7,
      material_fit_score: 4,
      scale_fit_score: 8,
      function_fit_score: 6,
      cohesion_fit_score: 2,
      value_fit_score: 9,
    });
    const score = computeFinalItemScore(scores);
    const decimalPlaces = (score.toString().split(".")[1] || "").length;
    expect(decimalPlaces).toBeLessThanOrEqual(2);
  });
});

describe("determineVerdict", () => {
  it("should return 'strong_yes' for high score + high confidence", () => {
    expect(determineVerdict(8.0, 8)).toBe("strong_yes");
    expect(determineVerdict(7.5, 7)).toBe("strong_yes");
  });

  it("should return 'yes' for good score + adequate confidence", () => {
    expect(determineVerdict(7.0, 6)).toBe("yes");
    expect(determineVerdict(6.5, 5)).toBe("yes");
  });

  it("should NOT return 'strong_yes' when confidence is too low", () => {
    expect(determineVerdict(8.0, 5)).not.toBe("strong_yes");
  });

  it("should NOT return 'yes' when confidence is too low", () => {
    expect(determineVerdict(7.0, 3)).not.toBe("yes");
  });

  it("should return 'maybe' for mediocre scores", () => {
    expect(determineVerdict(5.0, 3)).toBe("maybe");
    expect(determineVerdict(6.0, 2)).toBe("maybe");
  });

  it("should return 'no' for low scores", () => {
    expect(determineVerdict(4.9, 10)).toBe("no");
    expect(determineVerdict(3.0, 8)).toBe("no");
    expect(determineVerdict(0, 0)).toBe("no");
  });

  it("should handle edge cases at threshold boundaries", () => {
    // Exactly at strong_yes boundary
    expect(determineVerdict(7.5, 7)).toBe("strong_yes");
    // Just below strong_yes score
    expect(determineVerdict(7.49, 7)).toBe("yes");
    // Exactly at yes boundary
    expect(determineVerdict(6.5, 5)).toBe("yes");
    // Just below yes score
    expect(determineVerdict(6.49, 5)).toBe("maybe");
    // Exactly at maybe boundary
    expect(determineVerdict(5.0, 0)).toBe("maybe");
    // Just below maybe
    expect(determineVerdict(4.99, 10)).toBe("no");
  });
});
