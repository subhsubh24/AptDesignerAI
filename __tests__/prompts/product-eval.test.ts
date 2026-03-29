import { describe, it, expect } from "vitest";
import { getProductEvalPrompt } from "@/lib/prompts/product-eval";

describe("getProductEvalPrompt", () => {
  const baseArgs = {
    roomType: "living_room",
    category: "coffee_table",
    existingItems: ["walnut media console", "gray linen sofa"],
    budgetMode: "balanced",
  };

  it("should generate a non-empty prompt with basic args", () => {
    const prompt = getProductEvalPrompt(
      baseArgs.roomType,
      baseArgs.category,
      baseArgs.existingItems,
      baseArgs.budgetMode
    );
    expect(prompt).toBeTruthy();
    expect(prompt.length).toBeGreaterThan(500);
  });

  it("should include room type and category", () => {
    const prompt = getProductEvalPrompt(
      baseArgs.roomType,
      baseArgs.category,
      baseArgs.existingItems,
      baseArgs.budgetMode
    );
    expect(prompt).toContain("living_room");
    expect(prompt).toContain("coffee_table");
  });

  it("should include existing items", () => {
    const prompt = getProductEvalPrompt(
      baseArgs.roomType,
      baseArgs.category,
      baseArgs.existingItems,
      baseArgs.budgetMode
    );
    expect(prompt).toContain("walnut media console");
    expect(prompt).toContain("gray linen sofa");
  });

  it("should include all 8 scoring dimensions", () => {
    const prompt = getProductEvalPrompt(
      baseArgs.roomType,
      baseArgs.category,
      baseArgs.existingItems,
      baseArgs.budgetMode
    );
    expect(prompt).toContain("style_fit_score");
    expect(prompt).toContain("palette_fit_score");
    expect(prompt).toContain("material_fit_score");
    expect(prompt).toContain("scale_fit_score");
    expect(prompt).toContain("function_fit_score");
    expect(prompt).toContain("cohesion_fit_score");
    expect(prompt).toContain("value_fit_score");
    expect(prompt).toContain("confidence_score");
  });

  it("should include placement context when provided", () => {
    const prompt = getProductEvalPrompt(
      baseArgs.roomType,
      baseArgs.category,
      baseArgs.existingItems,
      baseArgs.budgetMode,
      undefined, undefined, undefined, undefined,
      "Centered between sofa and TV wall"
    );
    expect(prompt).toContain("Intended placement");
    expect(prompt).toContain("Centered between sofa and TV wall");
  });

  it("should include spatial layout when provided", () => {
    const prompt = getProductEvalPrompt(
      baseArgs.roomType,
      baseArgs.category,
      baseArgs.existingItems,
      baseArgs.budgetMode,
      undefined, undefined, undefined, undefined,
      undefined,
      "L-shaped seating facing TV with dining zone behind"
    );
    expect(prompt).toContain("SPATIAL LAYOUT PLAN");
    expect(prompt).toContain("L-shaped seating facing TV with dining zone behind");
  });

  it("should include floor plan dimensions when provided", () => {
    const prompt = getProductEvalPrompt(
      baseArgs.roomType,
      baseArgs.category,
      baseArgs.existingItems,
      baseArgs.budgetMode,
      undefined, undefined, undefined, undefined,
      undefined, undefined,
      { total_sqft: 650, room_dimensions: { living_room: "12x15" } }
    );
    expect(prompt).toContain("FLOOR PLAN DIMENSIONS");
    expect(prompt).toContain("650");
    expect(prompt).toContain("12x15");
  });

  it("should include environmental context when provided", () => {
    const prompt = getProductEvalPrompt(
      baseArgs.roomType,
      baseArgs.category,
      baseArgs.existingItems,
      baseArgs.budgetMode,
      undefined, undefined, undefined, undefined,
      undefined, undefined, undefined,
      "South-facing windows, bright afternoon light",
      "Large window on south wall, entry door on east",
      "Outlets on south wall flanking window"
    );
    expect(prompt).toContain("LIGHTING CONDITIONS");
    expect(prompt).toContain("South-facing windows");
    expect(prompt).toContain("WINDOW & DOOR POSITIONS");
    expect(prompt).toContain("entry door on east");
    expect(prompt).toContain("OUTLET POSITIONS");
    expect(prompt).toContain("flanking window");
  });

  it("should include durability/maintenance guidance in material_fit", () => {
    const prompt = getProductEvalPrompt(
      baseArgs.roomType,
      baseArgs.category,
      baseArgs.existingItems,
      baseArgs.budgetMode
    );
    expect(prompt).toContain("durability");
    expect(prompt).toContain("maintenance");
  });

  it("should include acoustic considerations in function_fit", () => {
    const prompt = getProductEvalPrompt(
      baseArgs.roomType,
      baseArgs.category,
      baseArgs.existingItems,
      baseArgs.budgetMode
    );
    expect(prompt).toContain("coustic"); // "Acoustic" or "acoustic"
  });

  it("should include lighting suitability guidance", () => {
    const prompt = getProductEvalPrompt(
      baseArgs.roomType,
      baseArgs.category,
      baseArgs.existingItems,
      baseArgs.budgetMode
    );
    expect(prompt).toContain("Lighting suitability");
  });

  it("should include outlet proximity guidance", () => {
    const prompt = getProductEvalPrompt(
      baseArgs.roomType,
      baseArgs.category,
      baseArgs.existingItems,
      baseArgs.budgetMode
    );
    expect(prompt).toContain("Outlet proximity");
  });

  it("should include window/door clearance in scale_fit", () => {
    const prompt = getProductEvalPrompt(
      baseArgs.roomType,
      baseArgs.category,
      baseArgs.existingItems,
      baseArgs.budgetMode
    );
    expect(prompt).toContain("Window/door clearance");
  });

  it("should include final checklist with environmental items", () => {
    const prompt = getProductEvalPrompt(
      baseArgs.roomType,
      baseArgs.category,
      baseArgs.existingItems,
      baseArgs.budgetMode
    );
    expect(prompt).toContain("FINAL CHECKLIST");
    expect(prompt).toContain("durability");
    expect(prompt).toContain("windows");
    expect(prompt).toContain("outlet");
    expect(prompt).toContain("acoustic");
  });

  it("should include diagnosis context when provided", () => {
    const diagnosis = {
      what_is_working: ["warm wood tones"],
      what_is_not_working: ["no rug", "poor lighting"],
      scale_proportion_issues: ["coffee table too small"],
      lighting_issues: ["dark corner by reading chair"],
    };
    const prompt = getProductEvalPrompt(
      baseArgs.roomType,
      baseArgs.category,
      baseArgs.existingItems,
      baseArgs.budgetMode,
      undefined, undefined,
      diagnosis
    );
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
    };
    const prompt = getProductEvalPrompt(
      baseArgs.roomType,
      baseArgs.category,
      baseArgs.existingItems,
      baseArgs.budgetMode,
      undefined, undefined, undefined,
      direction
    );
    expect(prompt).toContain("warm ivory");
    expect(prompt).toContain("walnut");
    expect(prompt).toContain("Mid-century modern");
  });

  it("should handle budget mode variations", () => {
    const budgetPrompt = getProductEvalPrompt("living_room", "rug", [], "budget");
    expect(budgetPrompt).toContain("Weight this heavily");

    const premiumPrompt = getProductEvalPrompt("living_room", "rug", [], "best_possible");
    expect(premiumPrompt).toContain("quality over price");
  });

  it("should include other rooms context when provided", () => {
    const prompt = getProductEvalPrompt(
      baseArgs.roomType,
      baseArgs.category,
      baseArgs.existingItems,
      baseArgs.budgetMode,
      "Bedroom: minimalist with light oak and white linen"
    );
    expect(prompt).toContain("OTHER ROOMS");
    expect(prompt).toContain("minimalist with light oak");
  });

  it("should request JSON output format", () => {
    const prompt = getProductEvalPrompt(
      baseArgs.roomType,
      baseArgs.category,
      baseArgs.existingItems,
      baseArgs.budgetMode
    );
    expect(prompt).toContain('"scores"');
    expect(prompt).toContain('"reasoning"');
    expect(prompt).toContain('"area_fit_note"');
    expect(prompt).toContain('"apartment_fit_note"');
  });
});
