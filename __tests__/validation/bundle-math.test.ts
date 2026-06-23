import { describe, it, expect } from "vitest";
import { computeBundleMathScores, formatBundleMathForPrompt } from "@/lib/validation/bundle-math";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProduct(overrides: {
  title?: string;
  category?: string;
  price?: number;
  colors?: string[];
  materials?: string[];
  dimensions?: {
    width?: number;
    depth?: number;
    height?: number;
    unit?: string;
  };
}) {
  return {
    title: overrides.title ?? "Generic Item",
    category: overrides.category ?? "accent_chair",
    price: overrides.price,
    colors: overrides.colors,
    materials: overrides.materials,
    dimensions: overrides.dimensions,
  };
}

const CTX_LIVING_ROOM = {
  roomType: "living_room",
  recommendedPalette: ["ivory", "walnut brown", "sage green"],
  recommendedMaterials: ["walnut", "linen", "brass"],
};

const CTX_NO_FLOORPLAN = {
  roomType: "living_room",
  recommendedPalette: ["ivory", "cream"],
};

// ---------------------------------------------------------------------------
// computeBundleMathScores — output shape and bounds
// ---------------------------------------------------------------------------

describe("computeBundleMathScores — output shape and bounds", () => {
  it("returns all scores in [0, 1] for a well-formed input", () => {
    const products = [
      makeProduct({ title: "Linen Sofa", category: "sofa", price: 1200, colors: ["ivory"], materials: ["linen"] }),
      makeProduct({ title: "Oak Coffee Table", category: "coffee_table", price: 600, colors: ["walnut brown"], materials: ["oak"] }),
      makeProduct({ title: "Wool Rug", category: "area_rug", price: 400, colors: ["cream"], materials: ["wool"] }),
      makeProduct({ title: "Brass Floor Lamp", category: "floor_lamp", price: 250, colors: ["brass"], materials: ["brass"] }),
      makeProduct({ title: "Linen Throw Pillows", category: "throw_pillows", price: 80, colors: ["ivory"], materials: ["linen"] }),
      makeProduct({ title: "Media Console", category: "media_console", price: 700, colors: ["walnut brown"], materials: ["walnut"] }),
      makeProduct({ title: "Accent Chair", category: "accent_chair", price: 650, colors: ["sage green"], materials: ["velvet"] }),
      makeProduct({ title: "Side Table", category: "side_table", price: 180, colors: ["walnut brown"], materials: ["walnut"] }),
    ];
    const result = computeBundleMathScores(products, CTX_LIVING_ROOM);
    const keys: (keyof typeof result)[] = [
      "palette_harmony", "material_balance", "scale_balance",
      "spatial_feasibility", "completeness", "price_coherence", "overall",
    ];
    for (const key of keys) {
      const val = result[key] as number;
      expect(val, `${key} should be in [0,1]`).toBeGreaterThanOrEqual(0);
      expect(val, `${key} should be in [0,1]`).toBeLessThanOrEqual(1);
    }
  });

  it("returns overall close to weighted combination of subscores", () => {
    const products = [
      makeProduct({ title: "A", category: "sofa", price: 800, colors: ["ivory"], materials: ["linen"] }),
      makeProduct({ title: "B", category: "coffee_table", price: 400, colors: ["oak"], materials: ["oak"] }),
    ];
    const result = computeBundleMathScores(products, CTX_LIVING_ROOM);
    const W = { pal: 0.18, mat: 0.18, scale: 0.18, spatial: 0.15, comp: 0.18, price: 0.13 };
    const expected =
      W.pal * result.palette_harmony +
      W.mat * result.material_balance +
      W.scale * result.scale_balance +
      W.spatial * result.spatial_feasibility +
      W.comp * result.completeness +
      W.price * result.price_coherence;
    expect(result.overall).toBeCloseTo(expected, 2);
  });

  it("handles empty product array without throwing", () => {
    const result = computeBundleMathScores([], CTX_LIVING_ROOM);
    expect(result.overall).toBeGreaterThanOrEqual(0);
    expect(result.overall).toBeLessThanOrEqual(1);
  });

  it("handles single product without throwing", () => {
    const result = computeBundleMathScores(
      [makeProduct({ title: "Solo Sofa", category: "sofa", price: 1000 })],
      CTX_LIVING_ROOM,
    );
    expect(result.overall).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// computeBundleMathScores — palette_harmony
// ---------------------------------------------------------------------------

describe("computeBundleMathScores — palette_harmony", () => {
  it("returns 0.5 when no colors can be resolved", () => {
    const products = [
      makeProduct({ title: "A", category: "sofa", colors: ["mystery finish"] }),
    ];
    const result = computeBundleMathScores(products, CTX_NO_FLOORPLAN);
    expect(result.palette_harmony).toBe(0.5);
  });

  it("scores harmonious palette higher than clashing palette", () => {
    const harmonious = [
      makeProduct({ title: "A", category: "sofa", colors: ["ivory"], materials: ["linen"] }),
      makeProduct({ title: "B", category: "coffee_table", colors: ["cream"], materials: ["oak"] }),
      makeProduct({ title: "C", category: "side_table", colors: ["beige"], materials: ["walnut"] }),
    ];
    const clashing = [
      makeProduct({ title: "X", category: "sofa", colors: ["ivory"], materials: ["linen"] }),
      makeProduct({ title: "Y", category: "coffee_table", colors: ["hunter green"], materials: ["oak"] }),
      makeProduct({ title: "Z", category: "side_table", colors: ["cobalt"], materials: ["walnut"] }),
    ];
    const harmResult = computeBundleMathScores(harmonious, CTX_LIVING_ROOM);
    const clashResult = computeBundleMathScores(clashing, CTX_LIVING_ROOM);
    expect(harmResult.palette_harmony).toBeGreaterThanOrEqual(clashResult.palette_harmony);
  });

  it("flags palette far from recommended palette via issue and reduced score", () => {
    // hunter green + cobalt are both far from an ivory/cream palette (Delta-E > 50)
    const offPalette = [
      makeProduct({ title: "A", category: "sofa", colors: ["hunter green"] }),
      makeProduct({ title: "B", category: "chair", colors: ["cobalt"] }),
    ];
    const ctx = {
      roomType: "living_room",
      recommendedPalette: ["ivory", "cream"],
    };
    const result = computeBundleMathScores(offPalette, ctx);
    // Palette alignment penalty drives score meaningfully below 0.85
    expect(result.palette_harmony).toBeLessThan(0.85);
    // The issue warning must appear (avgPaletteDe > 30 threshold)
    expect(result.issues.some(i => i.toLowerCase().includes("palette"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// computeBundleMathScores — material_balance
// ---------------------------------------------------------------------------

describe("computeBundleMathScores — material_balance", () => {
  it("returns 0.5 when no materials can be resolved", () => {
    const products = [
      makeProduct({ title: "A", category: "sofa", materials: ["mystery fabric"] }),
    ];
    const result = computeBundleMathScores(products, CTX_NO_FLOORPLAN);
    expect(result.material_balance).toBe(0.5);
  });

  it("penalizes more than 2 wood species", () => {
    const tooManyWoods = [
      makeProduct({ title: "A", category: "coffee_table", materials: ["walnut"] }),
      makeProduct({ title: "B", category: "bookshelf", materials: ["oak"] }),
      makeProduct({ title: "C", category: "desk", materials: ["ash"] }),
      makeProduct({ title: "D", category: "nightstand", materials: ["cherry"] }),
    ];
    const twoWoods = [
      makeProduct({ title: "A", category: "coffee_table", materials: ["walnut"] }),
      makeProduct({ title: "B", category: "bookshelf", materials: ["walnut"] }),
      makeProduct({ title: "C", category: "desk", materials: ["oak"] }),
    ];
    const manyResult = computeBundleMathScores(tooManyWoods, CTX_LIVING_ROOM);
    const twoResult = computeBundleMathScores(twoWoods, CTX_LIVING_ROOM);
    expect(manyResult.material_balance).toBeLessThan(twoResult.material_balance);
    expect(manyResult.issues.some(i => i.includes("wood species"))).toBe(true);
  });

  it("flags warm + cool metal conflict in bundle", () => {
    const mixedMetals = [
      makeProduct({ title: "A", category: "floor_lamp", materials: ["brass"] }),
      makeProduct({ title: "B", category: "side_table", materials: ["chrome"] }),
    ];
    const result = computeBundleMathScores(mixedMetals, CTX_LIVING_ROOM);
    expect(result.issues.some(i => i.toLowerCase().includes("metal"))).toBe(true);
    // Score should be penalized relative to all-warm-metal bundle
    const warmOnly = [
      makeProduct({ title: "A", category: "floor_lamp", materials: ["brass"] }),
      makeProduct({ title: "B", category: "side_table", materials: ["copper"] }),
    ];
    const warmResult = computeBundleMathScores(warmOnly, CTX_LIVING_ROOM);
    expect(warmResult.material_balance).toBeGreaterThanOrEqual(result.material_balance);
  });

  it("rewards material variety (4+ distinct types)", () => {
    // Different material types: warm-wood (walnut), textile (linen), glossy (brass), heavy/stone (marble)
    const varied = [
      makeProduct({ title: "A", category: "coffee_table", materials: ["walnut"] }),
      makeProduct({ title: "B", category: "sofa", materials: ["linen"] }),
      makeProduct({ title: "C", category: "floor_lamp", materials: ["brass"] }),
      makeProduct({ title: "D", category: "side_table", materials: ["marble"] }),
    ];
    const single = [
      makeProduct({ title: "A", category: "coffee_table", materials: ["walnut"] }),
      makeProduct({ title: "B", category: "sofa", materials: ["walnut"] }),
    ];
    const variedResult = computeBundleMathScores(varied, CTX_LIVING_ROOM);
    const singleResult = computeBundleMathScores(single, CTX_LIVING_ROOM);
    expect(variedResult.material_balance).toBeGreaterThanOrEqual(singleResult.material_balance);
  });
});

// ---------------------------------------------------------------------------
// computeBundleMathScores — scale_balance
// ---------------------------------------------------------------------------

describe("computeBundleMathScores — scale_balance", () => {
  it("starts at 0.8 when no dimensional data is available", () => {
    const noDims = [
      makeProduct({ title: "A", category: "sofa" }),
      makeProduct({ title: "B", category: "coffee_table" }),
    ];
    const result = computeBundleMathScores(noDims, CTX_LIVING_ROOM);
    expect(result.scale_balance).toBeCloseTo(0.8, 1);
  });

  it("scores perfectly when coffee table is 2/3 width of sofa", () => {
    const wellScaled = [
      makeProduct({ title: "Sofa", category: "sofa", dimensions: { width: 84, depth: 36, unit: "in" } }),
      makeProduct({ title: "Coffee Table", category: "coffee_table", dimensions: { width: 56, depth: 24, unit: "in" } }),
    ];
    const result = computeBundleMathScores(wellScaled, CTX_LIVING_ROOM);
    expect(result.scale_balance).toBeGreaterThanOrEqual(0.8);
    expect(result.scale_balance).toBeLessThanOrEqual(1.0);
  });

  it("penalizes coffee table that is too narrow relative to sofa", () => {
    const mismatched = [
      makeProduct({ title: "Sofa", category: "sofa", dimensions: { width: 96, depth: 36, unit: "in" } }),
      makeProduct({ title: "Coffee Table", category: "coffee_table", dimensions: { width: 24, depth: 18, unit: "in" } }),
      // 24 < 96*0.5=48 — fails the check
    ];
    const matched = [
      makeProduct({ title: "Sofa", category: "sofa", dimensions: { width: 96, depth: 36, unit: "in" } }),
      makeProduct({ title: "Coffee Table", category: "coffee_table", dimensions: { width: 60, depth: 24, unit: "in" } }),
    ];
    const mismatchResult = computeBundleMathScores(mismatched, CTX_LIVING_ROOM);
    const matchResult = computeBundleMathScores(matched, CTX_LIVING_ROOM);
    expect(mismatchResult.scale_balance).toBeLessThanOrEqual(matchResult.scale_balance);
  });

  it("handles cm dimensions (unit conversion)", () => {
    const cmProduct = [
      makeProduct({ title: "Sofa", category: "sofa", dimensions: { width: 213, depth: 91, unit: "cm" } }),
      makeProduct({ title: "Coffee Table", category: "coffee_table", dimensions: { width: 140, depth: 61, unit: "cm" } }),
    ];
    const result = computeBundleMathScores(cmProduct, CTX_LIVING_ROOM);
    // 213cm ≈ 83.9" sofa, 140cm ≈ 55.1" table → 55.1/83.9 ≈ 0.66 → in range
    expect(result.scale_balance).toBeGreaterThanOrEqual(0.8);
  });
});

// ---------------------------------------------------------------------------
// computeBundleMathScores — spatial_feasibility
// ---------------------------------------------------------------------------

describe("computeBundleMathScores — spatial_feasibility", () => {
  it("returns 0.6 with a note when no floor plan is provided", () => {
    const products = [makeProduct({ title: "Sofa", category: "sofa" })];
    const result = computeBundleMathScores(products, CTX_NO_FLOORPLAN);
    expect(result.spatial_feasibility).toBeCloseTo(0.6, 1);
    expect(result.issues.some(i => i.includes("floor plan"))).toBe(true);
  });

  it("returns 0.7 with empty floor plan object (no parseable dimensions)", () => {
    const ctx = { roomType: "living_room", floorPlan: {} };
    const products = [makeProduct({ title: "Sofa", category: "sofa" })];
    const result = computeBundleMathScores(products, ctx);
    expect(result.spatial_feasibility).toBeCloseTo(0.7, 1);
  });

  it("penalizes overcrowded footprint (>75% of room area)", () => {
    // Room: 10x12 ft = 120x144 in = 17280 sq in
    // dimMap is keyed by category, so use distinct categories with large pieces:
    //   sofa 90x40, coffee_table 70x30, area_rug 100x140, dining_table 80x40, bookshelf 60x18
    //   = 3600+2100+14000+3200+1080 = 24000 sq in = 139% — clearly overcrowded
    const ctx = { roomType: "living_room", floorPlan: { room_dimensions: "10x12" } };
    const largeProducts = [
      makeProduct({ title: "Sofa", category: "sofa", dimensions: { width: 90, depth: 40, unit: "in" } }),
      makeProduct({ title: "Rug", category: "area_rug", dimensions: { width: 100, depth: 140, unit: "in" } }),
      makeProduct({ title: "Dining Table", category: "dining_table", dimensions: { width: 80, depth: 40, unit: "in" } }),
    ];
    // Small products: 432+324=756 sq in = 4.4% of 17280 — below 15% → -0.15 sparse penalty (score=0.65)
    // Still scores higher than the overcrowded bundle (score≈0.40)
    const smallProducts = [
      makeProduct({ title: "Small Table", category: "coffee_table", dimensions: { width: 24, depth: 18, unit: "in" } }),
      makeProduct({ title: "Side Table", category: "side_table", dimensions: { width: 18, depth: 18, unit: "in" } }),
    ];
    const largeResult = computeBundleMathScores(largeProducts, ctx);
    const smallResult = computeBundleMathScores(smallProducts, ctx);
    expect(largeResult.spatial_feasibility).toBeLessThan(smallResult.spatial_feasibility);
  });

  it("rewards ideal footprint coverage (25-55% of room area)", () => {
    // Room: 12x14 ft = 144x168 in = 24192 sq in
    // Ideal band: 25-55% = 6048–13306 sq in
    // Largest piece must stay < 65% of smaller room dim (144") = < 93.6" to avoid traffic penalty.
    // sofa 84x36=3024, coffee_table 48x24=1152, area_rug 84x90=7560
    // total = 11736 sq in = 48.5% ✓; largest dim = 90" < 93.6" ✓
    const ctx = { roomType: "living_room", floorPlan: { room_dimensions: "12x14" } };
    const products = [
      makeProduct({ title: "Sofa", category: "sofa", dimensions: { width: 84, depth: 36, unit: "in" } }),
      makeProduct({ title: "Coffee Table", category: "coffee_table", dimensions: { width: 48, depth: 24, unit: "in" } }),
      makeProduct({ title: "Area Rug", category: "area_rug", dimensions: { width: 84, depth: 90, unit: "in" } }),
    ];
    const result = computeBundleMathScores(products, ctx);
    // 48.5% footprint in ideal range → score = 0.8 + 0.1 bonus = 0.9
    expect(result.spatial_feasibility).toBeGreaterThanOrEqual(0.8);
  });
});

// ---------------------------------------------------------------------------
// computeBundleMathScores — completeness
// ---------------------------------------------------------------------------

describe("computeBundleMathScores — completeness", () => {
  it("scores high when all essential and standard living room items are covered", () => {
    // essential (4): sofa, area_rug, coffee_table, floor_lamp
    // standard (5): side_table, throw_pillows, media_console, table_lamp, accent_chair
    // Finishing tier has 14 items; covering just the 9 above still yields
    //   essentialCoverage=1.0, standardCoverage=1.0, finishingCoverage=0 → raw=0.8
    // Covering some finishing items pushes toward 0.9+.
    const fullBundle = [
      makeProduct({ title: "Sofa", category: "sofa" }),
      makeProduct({ title: "Area Rug", category: "area_rug" }),
      makeProduct({ title: "Coffee Table", category: "coffee_table" }),
      makeProduct({ title: "Floor Lamp", category: "floor_lamp" }),
      makeProduct({ title: "Side Table", category: "side_table" }),
      makeProduct({ title: "Throw Pillows", category: "throw_pillows" }),
      makeProduct({ title: "Media Console", category: "media_console" }),
      makeProduct({ title: "Table Lamp", category: "table_lamp" }),
      makeProduct({ title: "Accent Chair", category: "accent_chair" }),
      makeProduct({ title: "Wall Art", category: "wall_art" }),
      makeProduct({ title: "Plant", category: "plant" }),
      makeProduct({ title: "Throw Blanket", category: "throw_blanket" }),
    ];
    const result = computeBundleMathScores(fullBundle, CTX_LIVING_ROOM);
    expect(result.completeness).toBeGreaterThan(0.75);
    // Essential and standard should be fully covered (no "Missing essential" issue)
    expect(result.issues.some(i => i.includes("Missing essential"))).toBe(false);
    expect(result.issues.some(i => i.includes("Missing standard"))).toBe(false);
  });

  it("penalizes missing essential items (only has sofa)", () => {
    const minimal = [makeProduct({ title: "Sofa", category: "sofa" })];
    const result = computeBundleMathScores(minimal, CTX_LIVING_ROOM);
    // Missing 3 of 4 essential items + 7 below minItemCount → near-zero completeness
    expect(result.completeness).toBeLessThan(0.25);
    expect(result.issues.some(i => i.includes("Missing essential"))).toBe(true);
  });

  it("flags when bundle is below minItemCount for room type", () => {
    // living_room minItemCount = 8
    const tooFew = [
      makeProduct({ title: "Sofa", category: "sofa" }),
      makeProduct({ title: "Coffee Table", category: "coffee_table" }),
      makeProduct({ title: "Area Rug", category: "area_rug" }),
    ];
    const result = computeBundleMathScores(tooFew, CTX_LIVING_ROOM);
    expect(result.issues.some(i => i.includes("minimum"))).toBe(true);
  });

  it("scores completeness for bedroom room type", () => {
    // bedroom essential: bed, nightstand, area_rug, table_lamp
    const bedroomBundle = [
      makeProduct({ title: "Queen Bed", category: "bed" }),
      makeProduct({ title: "Nightstand", category: "nightstand" }),
      makeProduct({ title: "Rug", category: "area_rug" }),
      makeProduct({ title: "Lamp", category: "table_lamp" }),
    ];
    const bedroomCtx = { roomType: "bedroom" };
    const result = computeBundleMathScores(bedroomBundle, bedroomCtx);
    // All 4 essential items present → essentialCoverage = 1.0
    expect(result.completeness).toBeGreaterThan(0.5);
  });
});

// ---------------------------------------------------------------------------
// computeBundleMathScores — price_coherence
// ---------------------------------------------------------------------------

describe("computeBundleMathScores — price_coherence", () => {
  it("returns 0.7 when fewer than 2 products have prices", () => {
    const result = computeBundleMathScores(
      [makeProduct({ title: "A", category: "sofa" })],
      CTX_LIVING_ROOM,
    );
    expect(result.price_coherence).toBeCloseTo(0.7, 1);
  });

  it("scores higher for consistent price range", () => {
    const consistent = [
      makeProduct({ title: "A", category: "sofa", price: 800 }),
      makeProduct({ title: "B", category: "coffee_table", price: 600 }),
      makeProduct({ title: "C", category: "side_table", price: 400 }),
      makeProduct({ title: "D", category: "floor_lamp", price: 500 }),
    ];
    const spread = [
      makeProduct({ title: "A", category: "sofa", price: 200 }),
      makeProduct({ title: "B", category: "coffee_table", price: 50 }),
      makeProduct({ title: "C", category: "side_table", price: 5000 }),
      makeProduct({ title: "D", category: "floor_lamp", price: 8000 }),
    ];
    const consistentResult = computeBundleMathScores(consistent, CTX_LIVING_ROOM);
    const spreadResult = computeBundleMathScores(spread, CTX_LIVING_ROOM);
    expect(consistentResult.price_coherence).toBeGreaterThan(spreadResult.price_coherence);
  });

  it("flags price outliers in issues", () => {
    const withOutlier = [
      makeProduct({ title: "Sofa", category: "sofa", price: 800 }),
      makeProduct({ title: "Chair", category: "accent_chair", price: 750 }),
      makeProduct({ title: "Table", category: "coffee_table", price: 700 }),
      makeProduct({ title: "Lamp", category: "floor_lamp", price: 650 }),
      makeProduct({ title: "Expensive Art", category: "wall_art", price: 15000 }),
    ];
    const result = computeBundleMathScores(withOutlier, CTX_LIVING_ROOM);
    expect(result.issues.some(i => i.includes("outlier"))).toBe(true);
  });

  it("returns neutral 0.7 for zero-price bundles (filtered out as non-prices)", () => {
    // price > 0 filter means zeros are excluded; with < 2 valid prices, code returns the neutral default
    const zeroPrices = [
      makeProduct({ title: "A", category: "sofa", price: 0 }),
      makeProduct({ title: "B", category: "chair", price: 0 }),
    ];
    const result = computeBundleMathScores(zeroPrices, CTX_LIVING_ROOM);
    expect(result.price_coherence).toBeCloseTo(0.7, 1);
  });
});

// ---------------------------------------------------------------------------
// formatBundleMathForPrompt
// ---------------------------------------------------------------------------

describe("formatBundleMathForPrompt", () => {
  it("includes all required score labels and sections", () => {
    const products = [
      makeProduct({ title: "Sofa", category: "sofa", price: 1200, colors: ["ivory"], materials: ["linen"] }),
      makeProduct({ title: "Coffee Table", category: "coffee_table", price: 600, colors: ["walnut brown"], materials: ["walnut"] }),
    ];
    const scores = computeBundleMathScores(products, CTX_LIVING_ROOM);
    const text = formatBundleMathForPrompt(scores);
    expect(text).toContain("MATHEMATICAL ANALYSIS");
    expect(text).toContain("Overall bundle math score:");
    expect(text).toContain("Palette harmony:");
    expect(text).toContain("Material balance:");
    expect(text).toContain("Scale balance:");
    expect(text).toContain("Spatial feasibility:");
    expect(text).toContain("Room completeness:");
    expect(text).toContain("Price coherence:");
  });

  it("includes issues section when violations exist", () => {
    const products = [
      makeProduct({ title: "A", category: "floor_lamp", materials: ["brass"] }),
      makeProduct({ title: "B", category: "side_table", materials: ["chrome"] }),
    ];
    const scores = computeBundleMathScores(products, CTX_LIVING_ROOM);
    // brass (warm) + chrome (cool) must unconditionally produce a conflict issue
    expect(scores.issues.length).toBeGreaterThan(0);
    const text = formatBundleMathForPrompt(scores);
    expect(text).toContain("Issues found:");
  });

  it("includes prompt instruction about not scoring 8+ on violations", () => {
    const scores = computeBundleMathScores([], CTX_LIVING_ROOM);
    const text = formatBundleMathForPrompt(scores);
    expect(text).toContain("8+");
  });

  it("completeness issues appear inline under Room completeness", () => {
    // A single sofa for living_room misses 3 essential items and falls below minItemCount=8
    const minimal = [makeProduct({ title: "Sofa", category: "sofa" })];
    const scores = computeBundleMathScores(minimal, CTX_LIVING_ROOM);
    // These must always fire — assert unconditionally before checking the format output
    expect(scores.issues.some(i => i.includes("essential") || i.includes("minimum"))).toBe(true);
    const text = formatBundleMathForPrompt(scores);
    expect(text).toContain("⚠");
  });
});
