import { describe, it, expect } from "vitest";
import { getAestheticEvalPrompt, getFunctionalEvalPrompt } from "@/lib/prompts/product-eval";
import type { DiagnosisData, DesignDirection } from "@/lib/types/database";

const baseArgs = {
  roomType: "living_room",
  category: "coffee_table",
  existingItems: ["walnut media console", "gray linen sofa"],
  budgetMode: "balanced",
};

describe("getAestheticEvalPrompt", () => {
  it("should generate a non-empty prompt with basic args", () => {
    const prompt = getAestheticEvalPrompt(baseArgs);
    expect(prompt).toBeTruthy();
    expect(prompt.length).toBeGreaterThan(500);
  });

  it("should include room type and category", () => {
    const prompt = getAestheticEvalPrompt(baseArgs);
    expect(prompt).toContain("living_room");
    expect(prompt).toContain("coffee_table");
  });

  it("should include existing items", () => {
    const prompt = getAestheticEvalPrompt(baseArgs);
    expect(prompt).toContain("walnut media console");
    expect(prompt).toContain("gray linen sofa");
  });

  it("should include aesthetic scoring dimensions", () => {
    const prompt = getAestheticEvalPrompt(baseArgs);
    expect(prompt).toContain("style_fit_score");
    expect(prompt).toContain("palette_fit_score");
    expect(prompt).toContain("material_fit_score");
    expect(prompt).toContain("cohesion_fit_score");
  });

  it("should include durability/maintenance guidance in material_fit", () => {
    const prompt = getAestheticEvalPrompt(baseArgs);
    expect(prompt).toContain("durability");
    expect(prompt).toContain("maintenance");
  });

  it("should include placement context when provided", () => {
    const prompt = getAestheticEvalPrompt({
      ...baseArgs,
      placement: "Centered between sofa and TV wall",
    });
    expect(prompt).toContain("Intended placement");
    expect(prompt).toContain("Centered between sofa and TV wall");
  });

  it("should include spatial layout when provided", () => {
    const prompt = getAestheticEvalPrompt({
      ...baseArgs,
      spatialLayout: "L-shaped seating facing TV with dining zone behind",
    });
    expect(prompt).toContain("SPATIAL LAYOUT PLAN");
    expect(prompt).toContain("L-shaped seating facing TV with dining zone behind");
  });

  it("should include floor plan dimensions when provided", () => {
    const prompt = getAestheticEvalPrompt({
      ...baseArgs,
      floorPlan: { total_sqft: 650, room_dimensions: { living_room: "12x15" } },
    });
    expect(prompt).toContain("FLOOR PLAN DIMENSIONS");
    expect(prompt).toContain("650");
    expect(prompt).toContain("12x15");
  });

  it("should include diagnosis context when provided", () => {
    const diagnosis = {
      what_is_working: ["warm wood tones"],
      what_is_not_working: ["no rug", "poor lighting"],
      scale_proportion_issues: ["coffee table too small"],
      lighting_issues: ["dark corner by reading chair"],
    } as DiagnosisData;
    const prompt = getAestheticEvalPrompt({ ...baseArgs, diagnosis });
    expect(prompt).toContain("warm wood tones");
    expect(prompt).toContain("no rug");
    expect(prompt).toContain("coffee table too small");
    expect(prompt).toContain("dark corner by reading chair");
  });

  it("should include design direction when provided", () => {
    const direction = {
      recommended_palette: ["warm ivory", "walnut brown", "brass"],
      recommended_materials: ["walnut", "linen", "brass"],
      style_notes: "Mid-century modern with organic warmth",
    } as DesignDirection;
    const prompt = getAestheticEvalPrompt({ ...baseArgs, designDirection: direction });
    expect(prompt).toContain("warm ivory");
    expect(prompt).toContain("walnut");
    expect(prompt).toContain("Mid-century modern");
  });

  it("should include other rooms context when provided", () => {
    const prompt = getAestheticEvalPrompt({
      ...baseArgs,
      otherRoomsContext: "Bedroom: minimalist with light oak and white linen",
    });
    expect(prompt).toContain("OTHER ROOMS");
    expect(prompt).toContain("minimalist with light oak");
  });

  it("should request JSON output format", () => {
    const prompt = getAestheticEvalPrompt(baseArgs);
    expect(prompt).toContain('"scores"');
    expect(prompt).toContain('"reasoning"');
  });
});

describe("getFunctionalEvalPrompt", () => {
  it("should generate a non-empty prompt with basic args", () => {
    const prompt = getFunctionalEvalPrompt(baseArgs);
    expect(prompt).toBeTruthy();
    expect(prompt.length).toBeGreaterThan(500);
  });

  it("should include room type and category", () => {
    const prompt = getFunctionalEvalPrompt(baseArgs);
    expect(prompt).toContain("living_room");
    expect(prompt).toContain("coffee_table");
  });

  it("should include functional scoring dimensions", () => {
    const prompt = getFunctionalEvalPrompt(baseArgs);
    expect(prompt).toContain("scale_fit_score");
    expect(prompt).toContain("function_fit_score");
    expect(prompt).toContain("value_fit_score");
  });

  it("should include budget mode guidance", () => {
    const budgetPrompt = getFunctionalEvalPrompt({ ...baseArgs, budgetMode: "budget" });
    expect(budgetPrompt).toContain("Weight HEAVILY");

    const premiumPrompt = getFunctionalEvalPrompt({ ...baseArgs, budgetMode: "best_possible" });
    expect(premiumPrompt).toContain("quality over price");
  });

  it("should include environmental context when provided", () => {
    const prompt = getFunctionalEvalPrompt({
      ...baseArgs,
      lightingConditions: "South-facing windows, bright afternoon light",
      windowDoorPositions: "Large window on south wall, entry door on east",
      outletPositions: "Outlets on south wall flanking window",
    });
    expect(prompt).toContain("LIGHTING CONDITIONS");
    expect(prompt).toContain("South-facing windows");
    expect(prompt).toContain("WINDOW & DOOR POSITIONS");
    expect(prompt).toContain("entry door on east");
    expect(prompt).toContain("OUTLET POSITIONS");
    expect(prompt).toContain("flanking window");
  });

  it("should include acoustic considerations", () => {
    const prompt = getFunctionalEvalPrompt(baseArgs);
    expect(prompt).toContain("coustic"); // "Acoustic" or "acoustic"
  });

  it("should include outlet proximity guidance", () => {
    const prompt = getFunctionalEvalPrompt(baseArgs);
    expect(prompt).toContain("Outlet proximity");
  });

  it("should include window/door clearance in scale_fit", () => {
    const prompt = getFunctionalEvalPrompt(baseArgs);
    expect(prompt).toContain("Window/door clearance");
  });

  it("should request JSON output format", () => {
    const prompt = getFunctionalEvalPrompt(baseArgs);
    expect(prompt).toContain('"scores"');
    expect(prompt).toContain("scale_fit_score");
  });
});
