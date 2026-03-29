import { describe, it, expect } from "vitest";
import { MODELS, selectModel } from "@/lib/ai/models";

describe("MODELS", () => {
  it("should have fast, reasoning, and image tiers", () => {
    expect(MODELS).toHaveProperty("fast");
    expect(MODELS).toHaveProperty("reasoning");
    expect(MODELS).toHaveProperty("image");
  });

  it("should use distinct models for each tier", () => {
    const models = new Set([MODELS.fast, MODELS.reasoning, MODELS.image]);
    expect(models.size).toBe(3);
  });

  it("should use gemini model identifiers", () => {
    expect(MODELS.fast).toMatch(/^gemini-/);
    expect(MODELS.reasoning).toMatch(/^gemini-/);
    expect(MODELS.image).toMatch(/^gemini-/);
  });
});

describe("selectModel", () => {
  describe("reasoning tasks → Flash (complex reasoning)", () => {
    const reasoningTasks = [
      "area_analysis",
      "scoring",
      "bundle",
      "validation",
      "diagnosis",
      "apartment_analysis",
    ] as const;

    for (const task of reasoningTasks) {
      it(`should route "${task}" to reasoning model`, () => {
        expect(selectModel(task)).toBe(MODELS.reasoning);
      });
    }
  });

  describe("fast tasks → Flash Lite (high-volume)", () => {
    const fastTasks = [
      "extraction",
      "search_brief",
      "search",
      "quick_score",
      "quick_screen",
      "mockup_prompt",
      "apartment_research",
    ] as const;

    for (const task of fastTasks) {
      it(`should route "${task}" to fast model`, () => {
        expect(selectModel(task)).toBe(MODELS.fast);
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
