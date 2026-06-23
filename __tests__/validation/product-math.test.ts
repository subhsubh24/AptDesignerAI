/**
 * Tests for lib/validation/product-math.ts
 *
 * computeProductMathScores: 6 scoring axes (scale, palette, material, value,
 * proportion, lifestyle) + weighted overall composite.
 * formatProductMathForPrompt: format helper for LLM injection.
 *
 * All assertions are unconditional — no if(condition){expect} patterns.
 */

import { describe, it, expect } from "vitest";
import {
  computeProductMathScores,
  formatProductMathForPrompt,
} from "../../lib/validation/product-math";

// ─── Helpers ────────────────────────────────────────────────────

function baseCtx() {
  return {
    roomType: "living_room",
    budgetMode: "balanced",
  };
}

// ─── Output shape and bounds ─────────────────────────────────────

describe("computeProductMathScores — output shape and bounds", () => {
  it("returns all required fields for a fully specified product", () => {
    const result = computeProductMathScores(
      { title: "Test Sofa", category: "sofa", dimensions: { width: 84, depth: 38, height: 34 }, price: 1200, materials: ["linen"], colors: ["ivory"] },
      { ...baseCtx(), recommendedPalette: ["ivory", "cream"], recommendedMaterials: ["linen"], tierPriceRange: [800, 1800] },
    );

    expect(result.scale_fit).toBeGreaterThanOrEqual(0);
    expect(result.scale_fit).toBeLessThanOrEqual(1);
    expect(result.palette_fit).toBeGreaterThanOrEqual(0);
    expect(result.palette_fit).toBeLessThanOrEqual(1);
    expect(result.material_fit).toBeGreaterThanOrEqual(0);
    expect(result.material_fit).toBeLessThanOrEqual(1);
    expect(result.value_fit).toBeGreaterThanOrEqual(0);
    expect(result.value_fit).toBeLessThanOrEqual(1);
    expect(result.proportion_fit).toBeGreaterThanOrEqual(0);
    expect(result.proportion_fit).toBeLessThanOrEqual(1);
    expect(result.lifestyle_fit).toBeGreaterThanOrEqual(0);
    expect(result.lifestyle_fit).toBeLessThanOrEqual(1);
    expect(result.overall).toBeGreaterThanOrEqual(0);
    expect(result.overall).toBeLessThanOrEqual(1);
    expect(Array.isArray(result.issues)).toBe(true);
  });

  it("overall is the weighted sum of the 6 axes", () => {
    // Give a product that exercises all axes, then verify the overall is a
    // reasonable weighted combination. The weights sum to 1.0 so if all sub-
    // scores are identical the overall must equal that score.
    const result = computeProductMathScores(
      { category: "coffee_table", dimensions: { width: 48, depth: 24, height: 18 }, price: 500, materials: ["walnut"], colors: ["walnut"] },
      { ...baseCtx(), recommendedPalette: ["walnut"], recommendedMaterials: ["walnut"], tierPriceRange: [400, 700] },
    );
    // overall must agree with weighted formula within float precision
    const expected =
      0.24 * result.scale_fit +
      0.20 * result.palette_fit +
      0.20 * result.material_fit +
      0.12 * result.value_fit +
      0.16 * result.proportion_fit +
      0.08 * result.lifestyle_fit;
    expect(result.overall).toBeCloseTo(expected, 2);
  });

  it("issues array collects all per-axis issues", () => {
    // Sofa with a clashing color and out-of-range width + no price
    const result = computeProductMathScores(
      { category: "sofa", dimensions: { width: 120, depth: 38 }, colors: ["hunter green"], materials: [] },
      { ...baseCtx(), recommendedPalette: ["ivory", "cream"] },
    );
    // At least a scale issue (120" > 96") and a palette issue (hunter green vs ivory)
    expect(result.issues.length).toBeGreaterThan(0);
    const combined = result.issues.join(" ");
    expect(combined).toMatch(/width|above typical sofa/i);
  });
});

// ─── Scale fit ───────────────────────────────────────────────────

describe("scale fit", () => {
  it("returns 0.95 for a sofa within the standard size range", () => {
    const result = computeProductMathScores(
      { category: "sofa", dimensions: { width: 84, depth: 38, height: 34 } },
      baseCtx(),
    );
    expect(result.scale_fit).toBe(0.95);
    expect(result.issues.filter((i) => /width|depth|height.*sofa/i.test(i))).toHaveLength(0);
  });

  it("penalizes a sofa with width above the standard range", () => {
    const inRange = computeProductMathScores(
      { category: "sofa", dimensions: { width: 84, depth: 38 } },
      baseCtx(),
    );
    const tooWide = computeProductMathScores(
      { category: "sofa", dimensions: { width: 120, depth: 38 } },
      baseCtx(),
    );
    expect(tooWide.scale_fit).toBeLessThan(inRange.scale_fit);
    expect(tooWide.issues.some((i) => /width.*above typical sofa/i.test(i))).toBe(true);
  });

  it("penalizes a sofa with width below the standard range", () => {
    const tooNarrow = computeProductMathScores(
      { category: "sofa", dimensions: { width: 55, depth: 38 } },
      baseCtx(),
    );
    expect(tooNarrow.scale_fit).toBeLessThan(0.95);
    expect(tooNarrow.issues.some((i) => /width.*below typical sofa/i.test(i))).toBe(true);
  });

  it("returns 0.5 and adds an issue when no dimensions are available", () => {
    const result = computeProductMathScores(
      { category: "coffee_table" },
      baseCtx(),
    );
    expect(result.scale_fit).toBe(0.5);
    expect(result.issues.some((i) => /no dimensions/i.test(i))).toBe(true);
  });

  it("returns baseline 0.8 for an unknown category with dimensions", () => {
    const result = computeProductMathScores(
      { category: "lamp_shade", dimensions: { width: 20, depth: 20, height: 15 } },
      baseCtx(),
    );
    expect(result.scale_fit).toBe(0.8);
    expect(result.issues.filter((i) => /width|depth|height/i.test(i))).toHaveLength(0);
  });

  it("converts cm dimensions to inches before the range check", () => {
    // 213cm × 97cm = ~83.9" × ~38.2" — within sofa range (72-96" × 32-42")
    const result = computeProductMathScores(
      { category: "sofa", dimensions: { width: 213, depth: 97, height: 86, unit: "cm" } },
      baseCtx(),
    );
    expect(result.scale_fit).toBe(0.95);
  });

  it("penalizes a product whose footprint exceeds 40% of the room area", () => {
    // 150" × 100" sofa in a 12'×12' room (144"×144")
    // Footprint = 15000 sq-in; room = 20736 sq-in → ratio ≈ 0.72 > 0.40
    const result = computeProductMathScores(
      {
        category: "sofa",
        dimensions: { width: 150, depth: 100 },
      },
      {
        ...baseCtx(),
        floorPlan: { room_dimensions: { living_room: "12x12" } },
      },
    );
    // Should flag room oversize, not just category range
    expect(result.issues.some((i) => /too large|footprint/i.test(i))).toBe(true);
    // scale_fit must be strictly below the baseline 0.8
    expect(result.scale_fit).toBeLessThan(0.8);
  });
});

// ─── Palette fit ─────────────────────────────────────────────────

describe("palette fit", () => {
  it("returns 0.5 and adds issue when product has no colors", () => {
    const result = computeProductMathScores(
      { category: "sofa", colors: [] },
      { ...baseCtx(), recommendedPalette: ["ivory", "cream"] },
    );
    expect(result.palette_fit).toBe(0.5);
    expect(result.issues.some((i) => /no product colors/i.test(i))).toBe(true);
  });

  it("returns 0.5 when there is no recommended palette", () => {
    const result = computeProductMathScores(
      { category: "sofa", colors: ["ivory"] },
      baseCtx(),
    );
    expect(result.palette_fit).toBe(0.5);
  });

  it("returns 1.0 when the product color exactly matches the palette", () => {
    const result = computeProductMathScores(
      { category: "sofa", colors: ["ivory"] },
      { ...baseCtx(), recommendedPalette: ["ivory"] },
    );
    // Same color → Delta-E ≈ 0 → score = 1.0
    expect(result.palette_fit).toBe(1.0);
    expect(result.issues.filter((i) => /far from palette|distant from palette/i.test(i))).toHaveLength(0);
  });

  it("returns a high score for a color within 10 Delta-E of the palette", () => {
    // ivory (h=50,s=50,l=93) vs warm ivory (h=45,s=55,l=92) — very similar
    const result = computeProductMathScores(
      { category: "sofa", colors: ["ivory"] },
      { ...baseCtx(), recommendedPalette: ["warm ivory"] },
    );
    expect(result.palette_fit).toBeGreaterThan(0.9);
  });

  it("returns a low score and adds issue for a sharply clashing color", () => {
    // ivory (warm, near-white) vs hunter green (h=145,s=45,l=22) — very different
    const result = computeProductMathScores(
      { category: "sofa", colors: ["ivory"] },
      { ...baseCtx(), recommendedPalette: ["hunter green"] },
    );
    expect(result.palette_fit).toBeLessThan(0.7);
    expect(result.issues.some((i) => /far from palette|distant from palette/i.test(i))).toBe(true);
  });

  it("returns 0.5 when product colors cannot be resolved in the lookup table", () => {
    const result = computeProductMathScores(
      { category: "sofa", colors: ["zzz-unresolvable-color"] },
      { ...baseCtx(), recommendedPalette: ["ivory"] },
    );
    expect(result.palette_fit).toBe(0.5);
  });
});

// ─── Material fit ────────────────────────────────────────────────

describe("material fit", () => {
  it("returns 0.5 and adds issue when product has no materials", () => {
    const result = computeProductMathScores(
      { category: "sofa", materials: [] },
      { ...baseCtx(), recommendedMaterials: ["linen"] },
    );
    expect(result.material_fit).toBe(0.5);
    expect(result.issues.some((i) => /no product materials/i.test(i))).toBe(true);
  });

  it("returns baseline 0.7 when no recommended materials are given", () => {
    const result = computeProductMathScores(
      { category: "sofa", materials: ["linen"] },
      baseCtx(),
    );
    expect(result.material_fit).toBe(0.7);
  });

  it("returns score above baseline for a material that closely matches the recommendation", () => {
    // linen vs linen — exact match in property space → matchRatio = 1.0 → score = 1.0
    const result = computeProductMathScores(
      { category: "sofa", materials: ["linen"] },
      { ...baseCtx(), recommendedMaterials: ["linen"] },
    );
    expect(result.material_fit).toBeGreaterThan(0.7);
  });

  it("penalizes and adds an issue when product introduces a 3rd wood species", () => {
    // Room already has walnut + oak; product introduces maple (3rd species)
    const result = computeProductMathScores(
      { category: "coffee_table", materials: ["maple"] },
      {
        ...baseCtx(),
        roomWoodSpecies: ["walnut", "oak"],
        recommendedMaterials: ["walnut"],
      },
    );
    const baseline = computeProductMathScores(
      { category: "coffee_table", materials: ["maple"] },
      { ...baseCtx(), recommendedMaterials: ["walnut"] },
    );
    expect(result.material_fit).toBeLessThan(baseline.material_fit);
    expect(result.issues.some((i) => /3rd wood species|wood species.*room already/i.test(i))).toBe(true);
  });

  it("penalizes warm+cool metal conflict and adds an issue", () => {
    // Same product (chrome, cool), same recommendedMaterials — only roomMetalFinishes differs
    const withConflict = computeProductMathScores(
      { category: "side_table", materials: ["chrome"] },
      {
        ...baseCtx(),
        roomMetalFinishes: ["brass"],   // warm metal conflicts with chrome (cool)
        recommendedMaterials: ["chrome"],
      },
    );
    const withoutConflict = computeProductMathScores(
      { category: "side_table", materials: ["chrome"] },
      {
        ...baseCtx(),
        roomMetalFinishes: ["nickel"],   // cool metal, consistent with chrome
        recommendedMaterials: ["chrome"],
      },
    );
    expect(withConflict.material_fit).toBeLessThan(withoutConflict.material_fit);
    expect(withConflict.issues.some((i) => /clashes with existing/i.test(i))).toBe(true);
  });
});

// ─── Value fit ───────────────────────────────────────────────────

describe("value fit", () => {
  it("returns 0.5 and adds issue when product has no price", () => {
    const result = computeProductMathScores(
      { category: "sofa" },
      { ...baseCtx(), tierPriceRange: [800, 1800] },
    );
    expect(result.value_fit).toBe(0.5);
    expect(result.issues.some((i) => /no price/i.test(i))).toBe(true);
  });

  it("returns 0.7 when no tier price range is provided", () => {
    const result = computeProductMathScores(
      { category: "sofa", price: 1200 },
      baseCtx(),
    );
    expect(result.value_fit).toBe(0.7);
  });

  it("returns a high score (~0.85–1.0) when price is within the tier range", () => {
    const result = computeProductMathScores(
      { category: "sofa", price: 1300 }, // mid-range of [800, 1800]
      { ...baseCtx(), tierPriceRange: [800, 1800] },
    );
    expect(result.value_fit).toBeGreaterThanOrEqual(0.85);
    expect(result.value_fit).toBeLessThanOrEqual(1.0);
    expect(result.issues.filter((i) => /price.*above|price.*below/i.test(i))).toHaveLength(0);
  });

  it("returns 0.9 for a price slightly below the tier minimum", () => {
    // $700 vs tier [800, 1800]: underPct = (800-700)/800 = 0.125 < 0.5 → 0.9
    const result = computeProductMathScores(
      { category: "sofa", price: 700 },
      { ...baseCtx(), tierPriceRange: [800, 1800] },
    );
    expect(result.value_fit).toBe(0.9);
  });

  it("returns 0.5 and adds issue for a price more than 50% below tier minimum", () => {
    // $300 vs tier [800, 1800]: underPct = (800-300)/800 = 0.625 > 0.5 → 0.5
    const result = computeProductMathScores(
      { category: "sofa", price: 300 },
      { ...baseCtx(), tierPriceRange: [800, 1800] },
    );
    expect(result.value_fit).toBe(0.5);
    expect(result.issues.some((i) => /below tier minimum.*quality concerns/i.test(i))).toBe(true);
  });

  it("returns a reduced score and adds issue for a price slightly above tier maximum", () => {
    // $2000 vs tier [800, 1800]: overPct = (2000-1800)/1800 ≈ 0.111
    const result = computeProductMathScores(
      { category: "sofa", price: 2000 },
      { ...baseCtx(), tierPriceRange: [800, 1800] },
    );
    expect(result.value_fit).toBeLessThan(0.85);
    expect(result.value_fit).toBeGreaterThanOrEqual(0.4);
    expect(result.issues.some((i) => /above tier range/i.test(i))).toBe(true);
  });

  it("returns 0.3 and adds issue for a price more than 50% above tier maximum", () => {
    // $3000 vs tier [800, 1800]: overPct = (3000-1800)/1800 ≈ 0.667 > 0.5
    const result = computeProductMathScores(
      { category: "sofa", price: 3000 },
      { ...baseCtx(), tierPriceRange: [800, 1800] },
    );
    expect(result.value_fit).toBe(0.3);
    expect(result.issues.some((i) => /above tier maximum/i.test(i))).toBe(true);
  });
});

// ─── Proportion fit ──────────────────────────────────────────────

describe("proportion fit", () => {
  it("returns 0.8 for a category without height constraints", () => {
    // 'sofa' has no HEIGHT_TARGETS entry
    const result = computeProductMathScores(
      { category: "sofa", dimensions: { width: 84, depth: 38, height: 34 } },
      baseCtx(),
    );
    expect(result.proportion_fit).toBe(0.8);
  });

  it("returns 1.0 for a coffee table at exactly the target height", () => {
    // Coffee table target = 18", tolerance = 2" → 18" is within tolerance
    const result = computeProductMathScores(
      { category: "coffee_table", dimensions: { width: 48, depth: 24, height: 18 } },
      baseCtx(),
    );
    expect(result.proportion_fit).toBe(1.0);
    expect(result.issues.filter((i) => /coffee table|height/i.test(i))).toHaveLength(0);
  });

  it("penalizes a coffee table well outside the target height range", () => {
    // height = 10" — target is 18", tolerance 2" — deviation = 8" - 2" = 6
    // penalty = min(6/8, 0.5) = 0.5 → score = max(0.3, 1.0 - 0.5) = 0.5
    const result = computeProductMathScores(
      { category: "coffee_table", dimensions: { width: 48, depth: 24, height: 10 } },
      baseCtx(),
    );
    expect(result.proportion_fit).toBeLessThan(1.0);
    expect(result.proportion_fit).toBeGreaterThanOrEqual(0.3);
    expect(result.issues.some((i) => /coffee table.*height|height.*coffee table/i.test(i))).toBe(true);
  });

  it("returns 0.6 with issue when a constrained category has no height data", () => {
    // coffee_table is in HEIGHT_TARGETS; no height available
    const result = computeProductMathScores(
      { category: "coffee_table", dimensions: { width: 48, depth: 24 } },
      baseCtx(),
    );
    expect(result.proportion_fit).toBe(0.6);
    expect(result.issues.some((i) => /no height data/i.test(i))).toBe(true);
  });
});

// ─── Lifestyle fit ────────────────────────────────────────────────

describe("lifestyle fit", () => {
  const noFlags = { has_pets: false, has_kids: false, entertains: false, high_traffic: false, works_from_home: false };

  it("returns 1.0 and no lifestyle_axes when no lifestyle flags are set", () => {
    const result = computeProductMathScores(
      { category: "sofa", materials: ["linen"] },
      baseCtx(), // no lifestyle field
    );
    expect(result.lifestyle_fit).toBe(1.0);
    expect(result.lifestyle_axes).toBeUndefined();
  });

  it("returns 1.0 when flags are present but none are active", () => {
    const result = computeProductMathScores(
      { category: "sofa", materials: ["linen"] },
      { ...baseCtx(), lifestyle: noFlags },
    );
    expect(result.lifestyle_fit).toBe(1.0);
    expect(result.lifestyle_axes).toBeUndefined();
  });

  it("scores lifestyle when pets flag is active", () => {
    // linen has low pet_friendly (0.30) — should return a scored result
    const result = computeProductMathScores(
      { category: "sofa", materials: ["linen"] },
      { ...baseCtx(), lifestyle: { ...noFlags, has_pets: true, high_traffic: true } },
    );
    expect(result.lifestyle_fit).toBeGreaterThanOrEqual(0);
    expect(result.lifestyle_fit).toBeLessThanOrEqual(1);
    expect(result.lifestyle_axes).toBeDefined();
    expect(result.lifestyle_axes!.pet_friendly).toBeGreaterThanOrEqual(0);
    expect(result.lifestyle_axes!.pet_friendly).toBeLessThanOrEqual(1);
  });

  it("gives a higher lifestyle score to performance fabric vs silk with pets", () => {
    const petFlags = { ...noFlags, has_pets: true, high_traffic: true };
    const performanceResult = computeProductMathScores(
      { category: "sofa", materials: ["performance fabric"] },
      { ...baseCtx(), lifestyle: petFlags },
    );
    const silkResult = computeProductMathScores(
      { category: "sofa", materials: ["silk"] },
      { ...baseCtx(), lifestyle: petFlags },
    );
    expect(performanceResult.lifestyle_fit).toBeGreaterThan(silkResult.lifestyle_fit);
  });
});

// ─── formatProductMathForPrompt ──────────────────────────────────

describe("formatProductMathForPrompt", () => {
  const scores = {
    scale_fit: 0.95,
    palette_fit: 0.82,
    material_fit: 0.75,
    value_fit: 0.90,
    proportion_fit: 1.0,
    lifestyle_fit: 1.0,
    overall: 0.88,
    issues: ["Width 120\" above typical sofa range (72-96\")", "Price $2000 slightly above tier range"],
  };

  it("includes a MATHEMATICAL ANALYSIS header", () => {
    const prompt = formatProductMathForPrompt(scores);
    expect(prompt).toMatch(/MATHEMATICAL ANALYSIS/i);
  });

  it("includes all score labels with the formatted values", () => {
    const prompt = formatProductMathForPrompt(scores);
    expect(prompt).toMatch(/Scale fit.*0\.95/i);
    expect(prompt).toMatch(/Palette fit.*0\.82/i);
    expect(prompt).toMatch(/Material fit.*0\.75/i);
    expect(prompt).toMatch(/Value fit.*0\.90/i);
    expect(prompt).toMatch(/Proportion fit.*1\.00/i);
    expect(prompt).toMatch(/Overall math score.*0\.88/i);
  });

  it("lists all issues in the output", () => {
    const prompt = formatProductMathForPrompt(scores);
    expect(prompt).toContain("Width 120");
    expect(prompt).toContain("above tier range");
  });

  it("omits the issues section when there are no issues", () => {
    const noIssues = { ...scores, issues: [] };
    const prompt = formatProductMathForPrompt(noIssues);
    expect(prompt).not.toMatch(/issues found/i);
  });

  it("includes the do-not-score-8+ instruction", () => {
    const prompt = formatProductMathForPrompt(scores);
    expect(prompt).toMatch(/8\+|eight or higher/i);
  });

  it("includes lifestyle axes in the output when they are present", () => {
    const withAxes = {
      ...scores,
      lifestyle_axes: { pet_friendly: 0.30, kid_friendly: 0.50, high_traffic: 0.60, easy_clean: 0.55 },
    };
    const prompt = formatProductMathForPrompt(withAxes);
    expect(prompt).toMatch(/Lifestyle fit/i);
    expect(prompt).toMatch(/pet=0\.30/);
    expect(prompt).toMatch(/kid=0\.50/);
    expect(prompt).toMatch(/traffic=0\.60/);
    expect(prompt).toMatch(/clean=0\.55/);
  });
});
