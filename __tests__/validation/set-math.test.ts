import { describe, it, expect } from "vitest";
import { computeSetMathScores, formatSetMathForPrompt } from "@/lib/validation/set-math";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProduct(overrides: {
  title?: string;
  category?: string;
  tier?: string;
  price?: number;
  colors?: string[];
  materials?: string[];
}) {
  return {
    title: overrides.title ?? "Generic Item",
    category: overrides.category ?? "accent_chair",
    tier: overrides.tier ?? "balanced",
    price: overrides.price,
    colors: overrides.colors,
    materials: overrides.materials,
  };
}

const CTX_LIVING_ROOM = {
  roomType: "living_room",
  designDirection: "warm-modern",
  existingItems: [] as string[],
  recommendedPalette: ["ivory", "walnut brown", "sage green"],
  recommendedMaterials: ["walnut", "linen", "brass"],
};

// ---------------------------------------------------------------------------
// computeSetMathScores — basic contracts
// ---------------------------------------------------------------------------

describe("computeSetMathScores — output shape and bounds", () => {
  it("returns all scores in [0, 1] for a well-formed input", () => {
    const products = [
      makeProduct({ title: "Linen Sofa", category: "sofa", tier: "balanced", price: 1200, colors: ["ivory"], materials: ["linen"] }),
      makeProduct({ title: "Walnut Coffee Table", category: "coffee_table", tier: "balanced", price: 600, colors: ["walnut brown"], materials: ["walnut"] }),
      makeProduct({ title: "Wool Area Rug", category: "area_rug", tier: "balanced", price: 400, colors: ["cream"], materials: ["wool"] }),
      makeProduct({ title: "Brass Floor Lamp", category: "floor_lamp", tier: "balanced", price: 250, colors: ["brass"], materials: ["brass"] }),
    ];
    const result = computeSetMathScores(products, CTX_LIVING_ROOM);
    expect(result.cross_product_coherence).toBeGreaterThanOrEqual(0);
    expect(result.cross_product_coherence).toBeLessThanOrEqual(1);
    expect(result.material_coherence).toBeGreaterThanOrEqual(0);
    expect(result.material_coherence).toBeLessThanOrEqual(1);
    expect(result.duplicate_score).toBeGreaterThanOrEqual(0);
    expect(result.duplicate_score).toBeLessThanOrEqual(1);
    expect(result.tier_differentiation).toBeGreaterThanOrEqual(0);
    expect(result.tier_differentiation).toBeLessThanOrEqual(1);
    expect(result.collective_coverage).toBeGreaterThanOrEqual(0);
    expect(result.collective_coverage).toBeLessThanOrEqual(1);
    expect(result.overall).toBeGreaterThanOrEqual(0);
    expect(result.overall).toBeLessThanOrEqual(1);
  });

  it("returns overall close to weighted combination of subscores", () => {
    const products = [
      makeProduct({ title: "Velvet Chair", category: "accent_chair", tier: "balanced", price: 800, colors: ["navy"], materials: ["velvet"] }),
      makeProduct({ title: "Oak Table", category: "coffee_table", tier: "balanced", price: 400, colors: ["oak"], materials: ["oak"] }),
    ];
    const result = computeSetMathScores(products, CTX_LIVING_ROOM);
    const W = { cross: 0.25, mat: 0.22, dup: 0.15, tier: 0.15, cov: 0.23 };
    const expected =
      W.cross * result.cross_product_coherence +
      W.mat * result.material_coherence +
      W.dup * result.duplicate_score +
      W.tier * result.tier_differentiation +
      W.cov * result.collective_coverage;
    expect(result.overall).toBeCloseTo(expected, 2);
  });

  it("returns scores for empty product array without throwing", () => {
    const result = computeSetMathScores([], CTX_LIVING_ROOM);
    expect(result.overall).toBeGreaterThanOrEqual(0);
    expect(result.overall).toBeLessThanOrEqual(1);
  });

  it("returns scores for single product", () => {
    const result = computeSetMathScores(
      [makeProduct({ title: "Solo Sofa", category: "sofa", tier: "balanced", price: 1000 })],
      CTX_LIVING_ROOM,
    );
    expect(result.overall).toBeGreaterThanOrEqual(0);
    expect(result.per_product).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// computeSetMathScores — cross_product_coherence
// ---------------------------------------------------------------------------

describe("computeSetMathScores — cross_product_coherence", () => {
  it("scores harmonious palette higher than clashing palette", () => {
    const harmonious = [
      makeProduct({ title: "A", category: "sofa", tier: "balanced", colors: ["ivory"], materials: ["linen"] }),
      makeProduct({ title: "B", category: "coffee_table", tier: "balanced", colors: ["cream"], materials: ["oak"] }),
      makeProduct({ title: "C", category: "area_rug", tier: "balanced", colors: ["beige"], materials: ["wool"] }),
    ];
    const clashing = [
      makeProduct({ title: "X", category: "sofa", tier: "balanced", colors: ["ivory"], materials: ["linen"] }),
      makeProduct({ title: "Y", category: "coffee_table", tier: "balanced", colors: ["hunter green"], materials: ["oak"] }),
      makeProduct({ title: "Z", category: "area_rug", tier: "balanced", colors: ["cobalt"], materials: ["wool"] }),
    ];
    const harmResult = computeSetMathScores(harmonious, CTX_LIVING_ROOM);
    const clashResult = computeSetMathScores(clashing, CTX_LIVING_ROOM);
    expect(harmResult.cross_product_coherence).toBeGreaterThanOrEqual(clashResult.cross_product_coherence);
  });

  it("products with no resolvable colors get neutral score (not zero)", () => {
    const products = [
      makeProduct({ title: "Mystery Wood Chair", category: "accent_chair", tier: "balanced", colors: ["driftwood patina"], materials: ["walnut"] }),
      makeProduct({ title: "Textured Table", category: "coffee_table", tier: "balanced", colors: ["oxidized teak"], materials: ["teak"] }),
    ];
    const result = computeSetMathScores(products, CTX_LIVING_ROOM);
    expect(result.cross_product_coherence).toBeGreaterThan(0.4);
  });
});

// ---------------------------------------------------------------------------
// computeSetMathScores — material_coherence
// ---------------------------------------------------------------------------

describe("computeSetMathScores — material_coherence", () => {
  it("penalizes sets with more than 2 wood species", () => {
    const tooManyWoods = [
      makeProduct({ title: "A", category: "sofa", tier: "balanced", materials: ["walnut"] }),
      makeProduct({ title: "B", category: "coffee_table", tier: "balanced", materials: ["oak"] }),
      makeProduct({ title: "C", category: "area_rug", tier: "balanced", materials: ["ash"] }),
      makeProduct({ title: "D", category: "accent_chair", tier: "balanced", materials: ["cherry"] }),
    ];
    const twoWoods = [
      makeProduct({ title: "A", category: "sofa", tier: "balanced", materials: ["walnut"] }),
      makeProduct({ title: "B", category: "coffee_table", tier: "balanced", materials: ["walnut"] }),
      makeProduct({ title: "C", category: "area_rug", tier: "balanced", materials: ["oak"] }),
    ];
    const manyResult = computeSetMathScores(tooManyWoods, CTX_LIVING_ROOM);
    const twoResult = computeSetMathScores(twoWoods, CTX_LIVING_ROOM);
    expect(manyResult.material_coherence).toBeLessThan(twoResult.material_coherence);
    expect(manyResult.issues.some(i => i.includes("wood species"))).toBe(true);
  });

  it("flags warm + cool metal conflict across set", () => {
    const mixedMetals = [
      makeProduct({ title: "A", category: "floor_lamp", tier: "balanced", materials: ["brass"] }),
      makeProduct({ title: "B", category: "side_table", tier: "balanced", materials: ["chrome"] }),
    ];
    const result = computeSetMathScores(mixedMetals, CTX_LIVING_ROOM);
    expect(result.issues.some(i => i.toLowerCase().includes("metal"))).toBe(true);
  });

  it("scores set without metal conflicts higher", () => {
    const warmOnly = [
      makeProduct({ title: "A", category: "floor_lamp", tier: "balanced", materials: ["brass"] }),
      makeProduct({ title: "B", category: "side_table", tier: "balanced", materials: ["copper"] }),
    ];
    const mixed = [
      makeProduct({ title: "A", category: "floor_lamp", tier: "balanced", materials: ["brass"] }),
      makeProduct({ title: "B", category: "side_table", tier: "balanced", materials: ["chrome"] }),
    ];
    const warmResult = computeSetMathScores(warmOnly, CTX_LIVING_ROOM);
    const mixedResult = computeSetMathScores(mixed, CTX_LIVING_ROOM);
    expect(warmResult.material_coherence).toBeGreaterThanOrEqual(mixedResult.material_coherence);
  });
});

// ---------------------------------------------------------------------------
// computeSetMathScores — duplicate_score
// ---------------------------------------------------------------------------

describe("computeSetMathScores — duplicate_score", () => {
  it("scores 1.0 when all products are clearly distinct", () => {
    const distinct = [
      makeProduct({ title: "Linen Sofa", category: "sofa", tier: "balanced", price: 1200 }),
      makeProduct({ title: "Brass Floor Lamp", category: "floor_lamp", tier: "balanced", price: 250 }),
      makeProduct({ title: "Wool Area Rug", category: "area_rug", tier: "balanced", price: 400 }),
    ];
    const result = computeSetMathScores(distinct, CTX_LIVING_ROOM);
    expect(result.duplicate_score).toBeCloseTo(1.0, 1);
  });

  it("penalizes near-duplicates (same category+tier, similar title and price)", () => {
    const withDupes = [
      makeProduct({ title: "Linen Sofa Ivory", category: "sofa", tier: "balanced", price: 1200, materials: ["linen"], colors: ["ivory"] }),
      makeProduct({ title: "Linen Sofa Cream", category: "sofa", tier: "balanced", price: 1250, materials: ["linen"], colors: ["cream"] }),
      makeProduct({ title: "Oak Coffee Table", category: "coffee_table", tier: "balanced", price: 600 }),
    ];
    const withoutDupes = [
      makeProduct({ title: "Linen Sofa", category: "sofa", tier: "balanced", price: 1200, materials: ["linen"] }),
      makeProduct({ title: "Velvet Bench", category: "sofa", tier: "high_end", price: 2500, materials: ["velvet"] }),
      makeProduct({ title: "Oak Coffee Table", category: "coffee_table", tier: "balanced", price: 600 }),
    ];
    const dupeResult = computeSetMathScores(withDupes, CTX_LIVING_ROOM);
    const noDupeResult = computeSetMathScores(withoutDupes, CTX_LIVING_ROOM);
    expect(dupeResult.duplicate_score).toBeLessThanOrEqual(noDupeResult.duplicate_score);
  });
});

// ---------------------------------------------------------------------------
// computeSetMathScores — tier_differentiation
// ---------------------------------------------------------------------------

describe("computeSetMathScores — tier_differentiation", () => {
  it("scores well when budget and high_end tiers have clear price separation", () => {
    const wellDifferentiated = [
      makeProduct({ title: "Budget Chair", category: "accent_chair", tier: "budget", price: 200 }),
      makeProduct({ title: "Luxury Chair", category: "accent_chair", tier: "high_end", price: 800 }),
    ];
    const result = computeSetMathScores(wellDifferentiated, CTX_LIVING_ROOM);
    expect(result.tier_differentiation).toBeGreaterThan(0.6);
  });

  it("penalizes insufficient tier price separation and emits an issue", () => {
    // budget $400, balanced $420 → only 5% separation (< 20% threshold) → penalty -0.2 → score 0.8
    const weakSeparation = [
      makeProduct({ title: "Budget Chair", category: "accent_chair", tier: "budget", price: 400 }),
      makeProduct({ title: "Balanced Chair", category: "side_table", tier: "balanced", price: 420 }),
    ];
    const result = computeSetMathScores(weakSeparation, CTX_LIVING_ROOM);
    expect(result.tier_differentiation).toBeLessThan(1.0);
    expect(result.issues.some(i =>
      i.toLowerCase().includes("separation") || i.toLowerCase().includes("price")
    )).toBe(true);
  });

  it("returns 0.7 base score when only one tier present (no comparison possible)", () => {
    const singleTier = [
      makeProduct({ title: "Chair A", category: "accent_chair", tier: "balanced", price: 400 }),
      makeProduct({ title: "Table B", category: "coffee_table", tier: "balanced", price: 600 }),
    ];
    const result = computeSetMathScores(singleTier, CTX_LIVING_ROOM);
    expect(result.tier_differentiation).toBeCloseTo(0.7, 1);
  });
});

// ---------------------------------------------------------------------------
// computeSetMathScores — collective_coverage
// ---------------------------------------------------------------------------

describe("computeSetMathScores — collective_coverage", () => {
  it("scores 1.0 when all 6 functional roles are covered", () => {
    const fullCoverage = [
      makeProduct({ title: "Linen Sofa", category: "sofa", tier: "balanced" }),           // seating
      makeProduct({ title: "Oak Coffee Table", category: "coffee_table", tier: "balanced" }), // surface
      makeProduct({ title: "Bookshelf", category: "bookshelf", tier: "balanced" }),         // storage
      makeProduct({ title: "Floor Lamp", category: "floor_lamp", tier: "balanced" }),       // lighting
      makeProduct({ title: "Area Rug", category: "area_rug", tier: "balanced" }),           // textile
      makeProduct({ title: "Wall Art", category: "wall_art", tier: "balanced" }),           // decorative
    ];
    const result = computeSetMathScores(fullCoverage, CTX_LIVING_ROOM);
    expect(result.collective_coverage).toBeCloseTo(1.0, 1);
  });

  it("scores lower when only one functional role is present", () => {
    const singleRole = [
      makeProduct({ title: "Sofa A", category: "sofa", tier: "balanced" }),
      makeProduct({ title: "Sofa B", category: "sofa", tier: "balanced" }),
      makeProduct({ title: "Armchair C", category: "armchair", tier: "balanced" }),
    ];
    const result = computeSetMathScores(singleRole, CTX_LIVING_ROOM);
    expect(result.collective_coverage).toBeLessThan(0.5);
  });
});

// ---------------------------------------------------------------------------
// computeSetMathScores — per_product
// ---------------------------------------------------------------------------

describe("computeSetMathScores — per_product", () => {
  it("populates per_product with title, category, math_harmony, color_score, material_score", () => {
    const products = [
      makeProduct({ title: "Velvet Chair", category: "accent_chair", tier: "balanced", colors: ["navy"], materials: ["velvet"] }),
      makeProduct({ title: "Oak Table", category: "coffee_table", tier: "balanced", colors: ["oak"], materials: ["oak"] }),
    ];
    const result = computeSetMathScores(products, CTX_LIVING_ROOM);
    expect(result.per_product).toHaveLength(2);
    for (const p of result.per_product) {
      expect(p.title).toBeTruthy();
      expect(p.category).toBeTruthy();
      expect(p.math_harmony).toBeGreaterThanOrEqual(0);
      expect(p.math_harmony).toBeLessThanOrEqual(1);
      expect(p.color_score).toBeGreaterThanOrEqual(0);
      expect(p.color_score).toBeLessThanOrEqual(1);
      expect(p.material_score).toBeGreaterThanOrEqual(0);
      expect(p.material_score).toBeLessThanOrEqual(1);
      expect(Array.isArray(p.issues)).toBe(true);
    }
  });

  it("math_harmony is the average of color_score and material_score", () => {
    const products = [
      makeProduct({ title: "Linen Sofa", category: "sofa", tier: "balanced", colors: ["ivory"], materials: ["linen"] }),
    ];
    const result = computeSetMathScores(products, CTX_LIVING_ROOM);
    const p = result.per_product[0];
    expect(p.math_harmony).toBeCloseTo((p.color_score + p.material_score) / 2, 2);
  });
});

// ---------------------------------------------------------------------------
// formatSetMathForPrompt
// ---------------------------------------------------------------------------

describe("formatSetMathForPrompt", () => {
  it("includes all required sections and score labels", () => {
    const products = [
      makeProduct({ title: "Sofa", category: "sofa", tier: "balanced", price: 1000, colors: ["ivory"], materials: ["linen"] }),
      makeProduct({ title: "Table", category: "coffee_table", tier: "balanced", price: 500, colors: ["oak"], materials: ["oak"] }),
    ];
    const scores = computeSetMathScores(products, CTX_LIVING_ROOM);
    const text = formatSetMathForPrompt(scores);
    expect(text).toContain("MATHEMATICAL ANALYSIS");
    expect(text).toContain("Color coherence:");
    expect(text).toContain("Material coherence:");
    expect(text).toContain("Duplicate score:");
    expect(text).toContain("Tier differentiation:");
    expect(text).toContain("Collective coverage:");
    expect(text).toContain("Overall set math score:");
  });

  it("includes issues section when violations are present", () => {
    const products = [
      makeProduct({ title: "A", category: "floor_lamp", tier: "balanced", materials: ["brass"] }),
      makeProduct({ title: "B", category: "side_table", tier: "balanced", materials: ["chrome"] }),
    ];
    const scores = computeSetMathScores(products, CTX_LIVING_ROOM);
    // brass (warm metal) + chrome (cool metal) must unconditionally produce a conflict issue
    expect(scores.issues.length).toBeGreaterThan(0);
    const text = formatSetMathForPrompt(scores);
    expect(text).toContain("Issues found:");
  });

  it("includes per-product section when products have issues", () => {
    const products = [
      makeProduct({ title: "A", category: "sofa", tier: "balanced", colors: ["ivory"], materials: ["brass"] }),
      makeProduct({ title: "B", category: "coffee_table", tier: "balanced", colors: ["hunter green"], materials: ["chrome"] }),
    ];
    const scores = computeSetMathScores(products, CTX_LIVING_ROOM);
    // brass warm + chrome cool → each product gets a per-item metal conflict issue
    expect(scores.per_product.some(p => p.issues.length > 0)).toBe(true);
    const text = formatSetMathForPrompt(scores);
    expect(text).toContain("Per-product math harmony:");
  });

  it("includes the prompt instruction about not scoring 8+ on violations", () => {
    const scores = computeSetMathScores([], CTX_LIVING_ROOM);
    const text = formatSetMathForPrompt(scores);
    expect(text).toContain("harmony_score");
  });
});
