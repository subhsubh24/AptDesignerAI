import { describe, it, expect } from "vitest";
import { MODELS, selectModel } from "@/lib/ai/models";

describe("MODELS", () => {
  it("exposes text and image tiers", () => {
    expect(MODELS).toHaveProperty("text");
    expect(MODELS).toHaveProperty("image");
  });

  it("uses gemini model identifiers", () => {
    expect(MODELS.text).toMatch(/^gemini-/);
    expect(MODELS.image).toMatch(/^gemini-/);
  });

  it("text tier is flash-lite (cheap tier)", () => {
    expect(MODELS.text).toBe("gemini-3.1-flash-lite-preview");
  });

  it("uses distinct models for text vs image", () => {
    expect(MODELS.text).not.toBe(MODELS.image);
  });
});

describe("selectModel", () => {
  it("routes image_generation to the image model", () => {
    expect(selectModel("image_generation")).toBe(MODELS.image);
  });

  it("routes all text tasks to the unified text model", () => {
    const textTasks = [
      "diagnosis",
      "apartment_analysis",
      "area_analysis",
      "extraction",
      "scoring",
      "bundle",
      "search_brief",
      "mockup_prompt",
      "validation",
      "apartment_research",
      "search",
      "quick_score",
      "quick_screen",
    ] as const;
    for (const task of textTasks) {
      expect(selectModel(task)).toBe(MODELS.text);
    }
  });

  it("never returns undefined or empty string", () => {
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
