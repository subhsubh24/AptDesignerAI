import { describe, it, expect } from "vitest";
import {
  computeHarmonyScores,
  computeConfidenceInterval,
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

  it("awards the extra-coverage bonus once light sources exceed the room minimum", () => {
    // Kitchen minimum is 2 sources. The `lightSourceCount >= minSources + 1` bonus
    // (+0.05) is a whole branch no test exercised. Isolate it: hold the ambient/
    // task/accent flags fixed and cross the count from exactly 2 (no bonus) to 3
    // via a SPEC-detected third source (a category in no lighting set, so it bumps
    // only the count, not a flag) — the sole score delta must be the +0.05 bonus.
    const atMinimum = computeHarmonyScores(
      {
        what_it_needs: [
          { category: "pendant_light", specs: "ceiling pendant" }, // ambient
          { category: "floor_lamp", specs: "floor lamp" }, // task
        ],
      },
      { roomType: "kitchen" },
    );
    expect(atMinimum.lighting.light_source_count).toBe(2);
    expect(atMinimum.lighting.has_ambient).toBe(true);
    expect(atMinimum.lighting.has_task).toBe(true);
    expect(atMinimum.lighting.has_accent).toBe(false);
    expect(atMinimum.lighting.adequacy_score).toBe(0.95); // no extra-coverage bonus

    const overMinimum = computeHarmonyScores(
      {
        what_it_needs: [
          { category: "pendant_light", specs: "ceiling pendant" }, // ambient
          { category: "floor_lamp", specs: "floor lamp" }, // task
          { category: "open_shelf", specs: "integrated LED under-shelf light" }, // spec-only source, no flag
        ],
      },
      { roomType: "kitchen" },
    );
    expect(overMinimum.lighting.light_source_count).toBe(3);
    // The third source toggled NO flag (accent still false) — so the only change is the bonus.
    expect(overMinimum.lighting.has_accent).toBe(false);
    expect(overMinimum.lighting.adequacy_score).toBe(1.0);
    expect(overMinimum.lighting.adequacy_score - atMinimum.lighting.adequacy_score).toBeCloseTo(0.05, 5);
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

describe("computeConfidenceInterval", () => {
  const richContext = {
    hasFloorPlanDims: true,
    hasBuildingResearch: true,
    hasSpatialViolations: false,
    hasCrossRoomData: true,
  };

  it("a harmony_score of 0 (a dropped item) is NOT coerced to the 5-point fallback", () => {
    // Regression: the inline route code used `(item.harmony_score as number) || 5`,
    // which treats the legitimate, documented harmony_score=0 (validation-agent.ts's
    // "drop=true and harmony_score=0" contract) as falsy and substitutes 5 — giving
    // dropped items a wildly wrong mid-range confidence band instead of one centered
    // on their real score of 0.
    const dropped = computeConfidenceInterval({ harmonyScore: 0, ...richContext });
    const kept = computeConfidenceInterval({ harmonyScore: 5, ...richContext });
    expect(dropped).not.toEqual(kept);
    // With full context uncertainty is 0.5, so a 0 score's interval sits at the floor.
    expect(dropped.low).toBe(0);
    expect(dropped.high).toBe(0.5);
  });

  it("only null/undefined fall back to 5, not 0", () => {
    expect(computeConfidenceInterval({ harmonyScore: null, ...richContext }).low).toBe(4.5);
    expect(computeConfidenceInterval({ harmonyScore: undefined, ...richContext }).low).toBe(4.5);
  });

  it("widens uncertainty for each missing data source, additively", () => {
    const full = computeConfidenceInterval({ harmonyScore: 6, ...richContext });
    expect(full.uncertainty).toBe(0.5);

    const sparse = computeConfidenceInterval({
      harmonyScore: 6,
      hasFloorPlanDims: false,
      hasBuildingResearch: false,
      hasSpatialViolations: true,
      hasCrossRoomData: false,
    });
    // 0.5 base + 0.4 + 0.3 + 0.2 + 0.2
    expect(sparse.uncertainty).toBe(1.6);
    expect(sparse.factors).toEqual([
      "no room dimensions",
      "no building research",
      "has spatial violations",
      "no cross-room data",
    ]);
  });

  it("clamps low/high to the [0, 10] score range", () => {
    const atFloor = computeConfidenceInterval({
      harmonyScore: 0.2,
      hasFloorPlanDims: false,
      hasBuildingResearch: false,
      hasSpatialViolations: true,
      hasCrossRoomData: false,
    });
    expect(atFloor.low).toBe(0);

    const atCeiling = computeConfidenceInterval({
      harmonyScore: 9.8,
      hasFloorPlanDims: false,
      hasBuildingResearch: false,
      hasSpatialViolations: true,
      hasCrossRoomData: false,
    });
    expect(atCeiling.high).toBe(10);
  });

  it("factors list is empty when every data source is present and there are no violations", () => {
    const result = computeConfidenceInterval({ harmonyScore: 7, ...richContext });
    expect(result.factors).toEqual([]);
  });
});

describe("computeHarmonyScores — per-item budget-allocation issues surface as violations", () => {
  // Regression guard: every other math dimension with a "get issues for this
  // item" helper (spatial graph, pairwise, ergonomics, access, outlet reach)
  // was already wired into the per-item `violations` list — budget allocation
  // was the one exception: its score fed into mathScore, but getBudgetIssuesForItem
  // was never called, so a badly-allocated bundle never explained WHY to the
  // per-item consumer (only the aggregate formatMathScoresForPrompt block saw it).
  it("attaches an under-spend issue to the specific under-budgeted item", () => {
    const result = computeHarmonyScores(
      {
        what_it_needs: [
          { category: "sofa", specs: "loveseat, budget pick" },
          { category: "floor_lamp", specs: "statement brass floor lamp" },
        ],
      },
      {
        roomType: "living_room",
        bundle: [
          { category: "sofa", price: 100 },
          { category: "floor_lamp", price: 900 },
        ],
      },
    );

    const sofa = result.itemScores.find((s) => s.category === "sofa");
    expect(sofa?.violations.some((v) => /Under-spent on sofa/.test(v))).toBe(true);
  });

  it("does NOT attach a budget violation to an item whose spend share is within target", () => {
    const result = computeHarmonyScores(
      { what_it_needs: [{ category: "sofa", specs: "84\" sofa" }] },
      {
        roomType: "living_room",
        // sofa share = 300/1000 = 30%, within the living-room sofa target
        // [22%, 40%] — "within", so no issue should attach.
        bundle: [
          { category: "sofa", price: 300 },
          { category: "unmatched_misc_item", price: 700 },
        ],
      },
    );

    const sofa = result.itemScores.find((s) => s.category === "sofa");
    expect(sofa?.violations.some((v) => /spent on/.test(v))).toBe(false);
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
