import { describe, it, expect } from "vitest";
import { MODELS, selectModel } from "@/lib/ai/models";

describe("MODELS", () => {
  it("should have primary and image tiers", () => {
    expect(MODELS).toHaveProperty("primary");
    expect(MODELS).toHaveProperty("image");
  });

  it("should use distinct models for primary and image", () => {
    expect(MODELS.primary).not.toBe(MODELS.image);
  });

  it("should use gemini model identifiers", () => {
    expect(MODELS.primary).toMatch(/^gemini-/);
    expect(MODELS.image).toMatch(/^gemini-/);
  });

  it("should use flash lite for primary model", () => {
    expect(MODELS.primary).toContain("flash-lite");
  });
});

describe("selectModel", () => {
  describe("all non-image tasks → primary model (flash lite)", () => {
    const allTasks = [
      "area_analysis",
      "scoring",
      "bundle",
      "validation",
      "diagnosis",
      "apartment_analysis",
      "extraction",
      "search_brief",
      "search",
      "quick_score",
      "quick_screen",
      "mockup_prompt",
      "apartment_research",
    ] as const;

    for (const task of allTasks) {
      it(`should route "${task}" to primary model`, () => {
        expect(selectModel(task)).toBe(MODELS.primary);
      });
    }
  });

  it("should route image_generation to image model", () => {
    expect(selectModel("image_generation")).toBe(MODELS.image);
  });

  it("should never return undefined or empty string", () => {
    const allTasks = [
      "diagnosis", "apartment_analysis", "area_analysis", "extraction",
      "scoring", "bundle", "search_brief", "mockup_prompt", "validation",
      "apartment_research", "image_generation", "search", "quick_score", "quick_screen",
    ] as const;

    for (const task of allTasks) {
      const result = selectModel(task);
      expect(result, `selectModel("${task}") should return a non-empty string`).toBeTruthy();
      expect(typeof result).toBe("string");
    }
  });
});
