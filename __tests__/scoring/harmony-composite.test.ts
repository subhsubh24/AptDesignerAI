import { describe, it, expect } from "vitest";
import {
  computeCompositeScore,
  computePairwisePenalty,
  computeFinalHarmonyScore,
  applyMathCaps,
  type HarmonySubScores,
  type PairwiseConflict,
} from "@/lib/scoring/harmony-composite";

function makeScores(overrides: Partial<HarmonySubScores> = {}): HarmonySubScores {
  return {
    color_fit: 9, spatial_fit: 9, material_fit: 9,
    style_coherence: 9, cross_room_fit: 9, functional_fit: 9,
    ...overrides,
  };
}

describe("computeCompositeScore", () => {
  it("should return high score when all dimensions are high", () => {
    const score = computeCompositeScore(makeScores());
    expect(score).toBeGreaterThanOrEqual(8.5);
    expect(score).toBeLessThanOrEqual(10);
  });

  it("should heavily penalize one bad dimension (compounding)", () => {
    const allGood = computeCompositeScore(makeScores());
    const oneBad = computeCompositeScore(makeScores({ material_fit: 2 }));

    // One bad dimension should drop score significantly
    expect(allGood - oneBad).toBeGreaterThan(2);
    expect(oneBad).toBeLessThan(7);
  });

  it("should penalize more than arithmetic mean would", () => {
    const scores = makeScores({ spatial_fit: 2 });
    const composite = computeCompositeScore(scores);

    // Arithmetic mean of (9,2,9,9,9,9) with weights ≈ 8.0
    // Geometric mean should be much lower due to compounding
    expect(composite).toBeLessThan(7);
  });

  it("should return near-perfect score when all dimensions are perfect", () => {
    const score = computeCompositeScore(makeScores({
      color_fit: 10, spatial_fit: 10, material_fit: 10,
      style_coherence: 10, cross_room_fit: 10, functional_fit: 10,
    }));
    expect(score).toBe(10);
  });
});

describe("applyMathCaps (soft caps)", () => {
  it("should soft-cap AI scores that exceed math limits (max +2.0 override)", () => {
    const scores = makeScores({ color_fit: 9, spatial_fit: 8 });
    const { capped, cappedDimensions } = applyMathCaps(scores, {
      color_fit: 0.6, // math anchor 6.0 — AI can reach up to 8.0
      spatial_fit: 0.9, // math anchor 9.0 — no cap needed
    });

    // Soft cap: 6.0 + min(9 - 6, 2.0) = 8.0
    expect(capped.color_fit).toBe(8);
    expect(capped.spatial_fit).toBe(8); // not capped (8 < 9)
    expect(cappedDimensions).toHaveLength(1);
    expect(cappedDimensions[0].dimension).toBe("color_fit");
  });

  it("should bound the override to MAX_OVERRIDE (2.0)", () => {
    const scores = makeScores({ color_fit: 10 });
    const { capped } = applyMathCaps(scores, { color_fit: 0.3 }); // anchor at 3.0

    // Soft cap: 3.0 + min(10 - 3, 2.0) = 5.0
    expect(capped.color_fit).toBe(5);
  });

  it("should not modify scores below the math anchor", () => {
    const scores = makeScores({ color_fit: 5 });
    const { capped, cappedDimensions } = applyMathCaps(scores, { color_fit: 0.6 }); // anchor at 6.0

    // AI score (5) is below anchor (6) — no change
    expect(capped.color_fit).toBe(5);
    expect(cappedDimensions).toHaveLength(0);
  });

  it("should not cap when math score is high (>= 0.90)", () => {
    const scores = makeScores({ color_fit: 9 });
    const { capped, cappedDimensions } = applyMathCaps(scores, { color_fit: 0.95 });

    expect(capped.color_fit).toBe(9);
    expect(cappedDimensions).toHaveLength(0);
  });
});

describe("computePairwisePenalty", () => {
  it("should return 1.0 when no conflicts", () => {
    const { factor } = computePairwisePenalty("coffee_table", []);
    expect(factor).toBe(1.0);
  });

  it("should return 1.0 when all relevant conflicts are >= 9", () => {
    const conflicts: PairwiseConflict[] = [
      { item_a: "coffee_table", item_b: "sofa", compatibility: 9.5, conflict_type: "", reason: "" },
    ];
    const { factor } = computePairwisePenalty("coffee_table", conflicts);
    expect(factor).toBe(1.0);
  });

  it("should penalize for low pairwise compatibility", () => {
    const conflicts: PairwiseConflict[] = [
      { item_a: "coffee_table", item_b: "side_table", compatibility: 4, conflict_type: "wood_species_clash", reason: "walnut vs oak" },
    ];
    const { factor, worstConflict } = computePairwisePenalty("coffee_table", conflicts);
    expect(factor).toBeLessThan(1.0);
    expect(factor).toBeGreaterThan(0.3);
    expect(worstConflict).toBeDefined();
    expect(worstConflict!.conflict_type).toBe("wood_species_clash");
  });

  it("should use the WORST conflict involving the item", () => {
    const conflicts: PairwiseConflict[] = [
      { item_a: "coffee_table", item_b: "sofa", compatibility: 8, conflict_type: "", reason: "" },
      { item_a: "coffee_table", item_b: "side_table", compatibility: 3, conflict_type: "wood_species_clash", reason: "" },
      { item_a: "sofa", item_b: "rug", compatibility: 2, conflict_type: "", reason: "" }, // not relevant
    ];
    const { factor, worstConflict } = computePairwisePenalty("coffee_table", conflicts);
    expect(worstConflict!.compatibility).toBe(3);
    expect(factor).toBeLessThan(0.6);
  });

  it("matches a conflict by the product TITLE when the category name does not appear in it", () => {
    // Conflicts are keyed on the specific product title (e.g. "velvet chesterfield"),
    // not just the generic category — so a sofa product must still pick up a conflict
    // that names its title even though "sofa" appears nowhere in the pair. Guards the
    // `titleLower` branch, which is never exercised without the 3rd argument.
    const conflicts: PairwiseConflict[] = [
      { item_a: "velvet chesterfield", item_b: "brass floor lamp", compatibility: 3, conflict_type: "style_clash", reason: "ornate vs industrial" },
    ];

    // Without the title, "sofa" matches nothing in the pair → no penalty.
    expect(computePairwisePenalty("sofa", conflicts).factor).toBe(1.0);
    expect(computePairwisePenalty("sofa", conflicts).worstConflict).toBeUndefined();

    // With the title, the conflict is found and penalizes the score.
    const { factor, worstConflict } = computePairwisePenalty("sofa", conflicts, "velvet chesterfield");
    expect(worstConflict).toBeDefined();
    expect(worstConflict!.conflict_type).toBe("style_clash");
    expect(factor).toBeLessThan(1.0);
  });
});

describe("computeFinalHarmonyScore", () => {
  it("should combine soft caps, geometric mean, and pairwise penalty", () => {
    const result = computeFinalHarmonyScore(
      makeScores({ color_fit: 9, spatial_fit: 9 }),
      { color_fit: 0.6 }, // math anchor 6.0 — soft cap allows up to 8.0
      "coffee_table",
      [{ item_a: "coffee_table", item_b: "side_table", compatibility: 5, conflict_type: "clash", reason: "test" }]
    );

    // color soft-capped to 8.0 (6.0 + 2.0), plus pairwise penalty
    expect(result.harmony_score).toBeLessThan(9);
    expect(result.cappedDimensions).toHaveLength(1);
    expect(result.pairwise_factor).toBeLessThan(1.0);
    expect(result.capped_sub_scores.color_fit).toBe(8); // soft cap: 6 + min(3, 2) = 8
  });

  it("should return full score when everything is perfect and no conflicts", () => {
    const result = computeFinalHarmonyScore(
      makeScores({ color_fit: 10, spatial_fit: 10, material_fit: 10, style_coherence: 10, cross_room_fit: 10, functional_fit: 10 }),
      {},
      "sofa",
      []
    );

    expect(result.harmony_score).toBe(10);
    expect(result.pairwise_factor).toBe(1.0);
    expect(result.cappedDimensions).toHaveLength(0);
  });
});
