import { describe, it, expect } from "vitest";
import {
  compareDesignDirections,
  computeApartmentCoherence,
} from "@/lib/validation/direction-distance";
import type { DesignDirection } from "@/lib/types/database";

const warmNeutrals: DesignDirection = {
  recommended_palette: ["warm white", "cream", "camel", "walnut"],
  recommended_materials: ["oak", "linen", "brass"],
  recommended_textures: ["woven", "nubby"],
  recommended_furniture_types: ["sofa", "coffee_table", "floor_lamp"],
  style_notes: "warm organic modernism with nubby linens and honey-toned wood",
};

const coolMinimal: DesignDirection = {
  recommended_palette: ["charcoal", "cold gray", "arctic white"],
  recommended_materials: ["stainless steel", "marble", "leather"],
  recommended_textures: ["smooth", "polished"],
  recommended_furniture_types: ["sofa", "pendant_light", "accent_chair"],
  style_notes: "crisp industrial minimalism in cool polished surfaces",
};

describe("compareDesignDirections", () => {
  it("returns near-zero distance when comparing a direction to itself", () => {
    const d = compareDesignDirections(warmNeutrals, warmNeutrals);
    expect(d.overall).toBeLessThan(0.05);
    expect(d.compatibility_score).toBeGreaterThan(0.95);
  });

  it("returns high distance between warm-organic and cool-industrial directions", () => {
    const d = compareDesignDirections(warmNeutrals, coolMinimal);
    expect(d.overall).toBeGreaterThan(0.2);
    expect(d.compatibility_score).toBeLessThan(0.8);
  });

  it("falls back to neutral distance when one side is missing", () => {
    const d = compareDesignDirections(warmNeutrals, null);
    expect(d.overall).toBe(0.5);
    expect(d.issues.length).toBeGreaterThan(0);
  });

  it("surfaces palette divergence as an issue when Delta-E is high", () => {
    const d = compareDesignDirections(warmNeutrals, coolMinimal);
    // palette raw ΔE should be meaningful between warm/cool neutrals
    expect(d.raw.palette_mean_deltaE).toBeGreaterThan(5);
  });

  it("flags style vocabularies that barely overlap", () => {
    // Two directions whose style tokens (notes + textures + furniture) are
    // entirely disjoint → Jaccard 0 < 0.10 → the "barely overlap" issue fires.
    const brutalistLoft: DesignDirection = {
      recommended_palette: ["concrete gray", "rust"],
      recommended_materials: ["concrete", "blackened steel"],
      recommended_textures: ["raw", "rough"],
      recommended_furniture_types: ["workbench", "locker"],
      style_notes: "brutalist concrete warehouse loft",
    };
    const coastalCottage: DesignDirection = {
      recommended_palette: ["seafoam", "sand"],
      recommended_materials: ["rattan", "driftwood"],
      recommended_textures: ["gauzy", "breezy"],
      recommended_furniture_types: ["daybed", "hammock"],
      style_notes: "delicate coastal cottage",
    };
    const d = compareDesignDirections(brutalistLoft, coastalCottage);
    expect(d.raw.style_jaccard).toBeLessThan(0.1);
    expect(
      d.issues.some((i) => /barely overlap/i.test(i)),
    ).toBe(true);
  });
});

describe("computeApartmentCoherence", () => {
  it("returns mean_compatibility across all sibling rooms", () => {
    const result = computeApartmentCoherence(warmNeutrals, [
      { name: "bedroom", direction: warmNeutrals },
      { name: "kitchen", direction: coolMinimal },
    ]);
    expect(result.per_room.length).toBe(2);
    expect(result.mean_compatibility).toBeGreaterThanOrEqual(0);
    expect(result.mean_compatibility).toBeLessThanOrEqual(1);
  });

  it("skips siblings with missing directions", () => {
    const result = computeApartmentCoherence(warmNeutrals, [
      { name: "bedroom", direction: warmNeutrals },
      { name: "hallway", direction: null },
    ]);
    expect(result.per_room.length).toBe(1);
  });

  it("returns neutral fallback when no siblings have directions", () => {
    const result = computeApartmentCoherence(warmNeutrals, []);
    expect(result.mean_compatibility).toBeGreaterThan(0);
    expect(result.per_room.length).toBe(0);
  });
});
