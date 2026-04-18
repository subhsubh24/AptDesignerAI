import { describe, it, expect } from "vitest";
import {
  getBundleScoringPrompt,
  getBundleVibePrompt,
} from "@/lib/prompts/bundle-eval";
import type { DiagnosisData, DesignDirection } from "@/lib/types/database";

const baseArgs = { roomType: "living_room" };

describe("getBundleScoringPrompt", () => {
  it("should generate a non-empty prompt", () => {
    const prompt = getBundleScoringPrompt(baseArgs);
    expect(prompt).toBeTruthy();
    expect(prompt.length).toBeGreaterThan(500);
  });

  it("should include all 7 scoring dimensions", () => {
    const prompt = getBundleScoringPrompt(baseArgs);
    expect(prompt).toContain("palette_harmony_score");
    expect(prompt).toContain("material_balance_score");
    expect(prompt).toContain("scale_balance_score");
    expect(prompt).toContain("style_consistency_score");
    expect(prompt).toContain("room_completion_score");
    expect(prompt).toContain("spatial_arrangement_score");
    expect(prompt).toContain("practicality_score");
  });

  it("should include spatial layout when provided", () => {
    const prompt = getBundleScoringPrompt({
      ...baseArgs,
      spatialLayout: "L-shaped arrangement with dining zone",
    });
    expect(prompt).toContain("SPATIAL LAYOUT PLAN");
    expect(prompt).toContain("L-shaped arrangement");
  });

  it("should include placement map when provided", () => {
    const prompt = getBundleScoringPrompt({
      ...baseArgs,
      placementMap: {
        coffee_table: "Center of seating area",
        floor_lamp: "Left of sofa",
      },
    });
    expect(prompt).toContain("INTENDED PLACEMENTS");
    expect(prompt).toContain("coffee_table");
    expect(prompt).toContain("Center of seating area");
    expect(prompt).toContain("floor_lamp");
    expect(prompt).toContain("Left of sofa");
  });

  it("should include floor plan when provided", () => {
    const prompt = getBundleScoringPrompt({
      ...baseArgs,
      floorPlan: { total_sqft: 650, room_dimensions: { living_room: "12x15" } },
    });
    expect(prompt).toContain("FLOOR PLAN DIMENSIONS");
    expect(prompt).toContain("650");
  });

  it("should include lighting conditions when provided", () => {
    const prompt = getBundleScoringPrompt({
      ...baseArgs,
      lightingConditions: "South-facing, bright afternoon sun",
    });
    expect(prompt).toContain("LIGHTING CONDITIONS");
    expect(prompt).toContain("South-facing");
  });

  it("should include window/door positions when provided", () => {
    const prompt = getBundleScoringPrompt({
      ...baseArgs,
      windowDoorPositions: "Large window on south wall, entry on east",
    });
    expect(prompt).toContain("WINDOW & DOOR POSITIONS");
    expect(prompt).toContain("south wall");
  });

  it("should include durability and climate guidance in material_balance", () => {
    const prompt = getBundleScoringPrompt(baseArgs);
    expect(prompt).toContain("durability");
    expect(prompt).toContain("climate suitability");
  });

  it("should include acoustic balance in practicality", () => {
    const prompt = getBundleScoringPrompt(baseArgs);
    expect(prompt).toContain("acoustic balance");
  });

  it("should include lighting adequacy in practicality", () => {
    const prompt = getBundleScoringPrompt(baseArgs);
    expect(prompt).toContain("lighting adequacy");
  });

  it("should include window/door clearance in spatial_arrangement", () => {
    const prompt = getBundleScoringPrompt(baseArgs);
    expect(prompt).toContain("window/door clearance");
  });

  it("should include outlet access in spatial_arrangement", () => {
    const prompt = getBundleScoringPrompt(baseArgs);
    expect(prompt).toContain("outlet access");
  });

  it("should include traffic flow clearance standards", () => {
    const prompt = getBundleScoringPrompt(baseArgs);
    expect(prompt).toContain("36"); // main paths
    expect(prompt).toContain("18"); // coffee table to sofa
  });

  it("should include priorities when provided", () => {
    const prompt = getBundleScoringPrompt({ ...baseArgs, priorities: ["hosting", "comfort"] });
    expect(prompt).toContain("hosting");
    expect(prompt).toContain("comfort");
  });

  it("should include diagnosis context when provided", () => {
    const diagnosis = {
      what_is_working: ["warm walnut floors"],
      what_is_not_working: ["no area rug", "harsh lighting"],
    } as DiagnosisData;
    const prompt = getBundleScoringPrompt({ ...baseArgs, diagnosis });
    expect(prompt).toContain("warm walnut floors");
    expect(prompt).toContain("no area rug");
  });

  it("should include design direction when provided", () => {
    const direction = {
      recommended_palette: ["ivory", "walnut"],
      recommended_materials: ["wool", "walnut", "brass"],
      style_notes: "Urban organic warmth",
    } as DesignDirection;
    const prompt = getBundleScoringPrompt({ ...baseArgs, designDirection: direction });
    expect(prompt).toContain("ivory");
    expect(prompt).toContain("Urban organic warmth");
  });

  it("should request JSON output format with all fields", () => {
    const prompt = getBundleScoringPrompt(baseArgs);
    expect(prompt).toContain('"scores"');
    expect(prompt).toContain('"analysis"');
    expect(prompt).toContain('"verdict"');
    expect(prompt).toContain('"strongest_aspect"');
    expect(prompt).toContain('"weakest_aspect"');
  });
});

describe("getBundleVibePrompt", () => {
  it("should generate a non-empty prompt", () => {
    const prompt = getBundleVibePrompt(baseArgs);
    expect(prompt).toBeTruthy();
    expect(prompt.length).toBeGreaterThan(200);
  });

  it("should reference room vibe output", () => {
    const prompt = getBundleVibePrompt(baseArgs);
    expect(prompt).toContain("room_vibe");
  });

  it("should include vibe_summary in the output format", () => {
    const prompt = getBundleVibePrompt(baseArgs);
    expect(prompt).toContain("vibe_summary");
  });

  it("should include style_keywords in the output format", () => {
    const prompt = getBundleVibePrompt(baseArgs);
    expect(prompt).toContain("style_keywords");
  });

  it("should include color_story in the output format", () => {
    const prompt = getBundleVibePrompt(baseArgs);
    expect(prompt).toContain("color_story");
  });

  it("should include mood in the output format", () => {
    const prompt = getBundleVibePrompt(baseArgs);
    expect(prompt).toContain("mood");
  });

  it("should incorporate scoring verdict when provided", () => {
    const prompt = getBundleVibePrompt(baseArgs, "strong palette harmony, needs more texture");
    expect(prompt).toContain("strong palette harmony");
  });
});
