import { describe, it, expect } from "vitest";
import {
  computeHarmonyScores,
  formatMathScoresForPrompt,
} from "@/lib/validation/harmony-math";
import type { DesignDirection } from "@/lib/types/database";

// harmony-math.ts is the ORCHESTRATOR that combines 12 already-unit-tested
// sub-validators into one MathHarmonyResult. These tests cover the orchestration
// contract — aggregation, the lighting-adequacy rules it owns directly, the
// cross-room gating, and prompt formatting — not the sub-validators themselves.

function dd(overrides: Partial<DesignDirection> = {}): DesignDirection {
  return {
    recommended_palette: ["cream", "walnut"],
    recommended_materials: ["oak", "linen"],
    recommended_textures: ["woven"],
    recommended_furniture_types: ["sofa"],
    style_notes: "warm minimal",
    ...overrides,
  };
}

describe("computeHarmonyScores — aggregation contract", () => {
  it("returns a neutral 0.5 overall with no recommended items", () => {
    const result = computeHarmonyScores({ what_it_needs: [] }, {});
    expect(result.itemScores).toEqual([]);
    expect(result.overall).toBe(0.5);
  });

  it("scores each item in [0,1] rounded to 2 decimals, keyed by category", () => {
    const result = computeHarmonyScores(
      {
        what_it_needs: [
          { category: "sofa", specs: "84\" linen sofa in cream", placement: "against the long wall" },
          { category: "area_rug", specs: "8x10 wool rug, beige" },
        ],
      },
      { roomType: "living_room" },
    );

    expect(result.itemScores.map((s) => s.category)).toEqual(["sofa", "area_rug"]);
    for (const s of result.itemScores) {
      expect(s.math_score).toBeGreaterThanOrEqual(0);
      expect(s.math_score).toBeLessThanOrEqual(1);
      // rounded to 2 decimals
      expect(Math.round(s.math_score * 100) / 100).toBe(s.math_score);
    }
  });

  it("computes overall as the mean of the per-item math scores", () => {
    const result = computeHarmonyScores(
      {
        what_it_needs: [
          { category: "sofa", specs: "84\" velvet sofa, navy" },
          { category: "floor_lamp", specs: "62\" tall brass floor lamp with linen drum shade" },
        ],
      },
      { roomType: "living_room" },
    );
    const mean =
      result.itemScores.reduce((sum, s) => sum + s.math_score, 0) /
      result.itemScores.length;
    expect(result.overall).toBeCloseTo(Math.round(mean * 100) / 100, 5);
  });
});

describe("computeHarmonyScores — lighting adequacy", () => {
  it("detects ambient + task light sources from the recommendations", () => {
    const result = computeHarmonyScores(
      {
        what_it_needs: [
          { category: "pendant_light", specs: "18\" brass pendant" },
          { category: "floor_lamp", specs: "60\" floor lamp" },
        ],
      },
      { roomType: "living_room" },
    );
    expect(result.lighting.has_ambient).toBe(true);
    expect(result.lighting.has_task).toBe(true);
    expect(result.lighting.light_source_count).toBeGreaterThanOrEqual(2);
    expect(result.lighting.adequacy_score).toBeGreaterThan(0.5);
  });

  it("flags a living room with no light sources", () => {
    const result = computeHarmonyScores(
      { what_it_needs: [{ category: "sofa", specs: "linen sofa" }] },
      { roomType: "living_room" },
    );
    expect(result.lighting.has_ambient).toBe(false);
    expect(result.lighting.has_task).toBe(false);
    expect(result.lighting.light_source_count).toBe(0);
    // No bonuses are applied → the floor score of 0.5.
    expect(result.lighting.adequacy_score).toBe(0.5);
    const joined = result.lighting.issues.join(" ");
    expect(joined).toContain("ambient");
    expect(joined).toContain("task lighting");
    expect(joined).toMatch(/at least 3/); // living_room minimum
  });

  it("counts existing fixtures named in what_works", () => {
    const result = computeHarmonyScores(
      {
        what_it_needs: [{ category: "sofa", specs: "sofa" }],
        what_works: ["a brass chandelier over the dining area"],
      },
      { roomType: "living_room" },
    );
    expect(result.lighting.has_ambient).toBe(true);
    expect(result.lighting.light_source_count).toBeGreaterThanOrEqual(1);
  });
});

describe("computeHarmonyScores — cross-room direction gating", () => {
  it("is undefined when no sibling structured directions are supplied", () => {
    const result = computeHarmonyScores(
      { what_it_needs: [{ category: "sofa", specs: "sofa" }] },
      {
        roomType: "living_room",
        designDirection: dd(),
        // a plain-narrative sibling without directionStructured must NOT trigger it
        otherRooms: [{ name: "Bedroom", palette: ["sage"] }],
      },
    );
    expect(result.cross_room_directions).toBeUndefined();
  });

  it("is computed when a sibling supplies a structured direction", () => {
    const result = computeHarmonyScores(
      { what_it_needs: [{ category: "sofa", specs: "sofa" }] },
      {
        roomType: "living_room",
        designDirection: dd(),
        otherRooms: [
          { name: "Bedroom", directionStructured: dd({ style_notes: "cool minimal" }) },
        ],
      },
    );
    expect(result.cross_room_directions).toBeDefined();
    expect(result.cross_room_directions!.per_room).toHaveLength(1);
    expect(result.cross_room_directions!.per_room[0].name).toBe("Bedroom");
    expect(result.cross_room_directions!.mean_compatibility).toBeGreaterThanOrEqual(0);
    expect(result.cross_room_directions!.mean_compatibility).toBeLessThanOrEqual(1);
  });
});

describe("formatMathScoresForPrompt", () => {
  it("renders the evidence block with the headline sections and overall score", () => {
    const result = computeHarmonyScores(
      { what_it_needs: [{ category: "sofa", specs: "linen sofa, cream" }] },
      { roomType: "living_room" },
    );
    const text = formatMathScoresForPrompt(result);
    expect(text).toContain("## MATHEMATICAL EVIDENCE");
    expect(text).toContain(`Overall math score: ${result.overall.toFixed(2)}/1.0`);
    expect(text).toContain("### Color Harmony");
    expect(text).toContain("### Spatial Constraints");
  });
});
