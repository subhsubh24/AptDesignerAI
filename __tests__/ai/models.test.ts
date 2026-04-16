import { describe, it, expect } from "vitest";
import {
  MODELS,
  selectModel,
  selectThinkingLevel,
  selectModelConfig,
} from "@/lib/ai/models";

describe("MODELS", () => {
  it("exposes text and image tiers", () => {
    expect(MODELS).toHaveProperty("text");
    expect(MODELS).toHaveProperty("image");
  });

  it("uses gemini model identifiers", () => {
    expect(MODELS.text).toMatch(/^gemini-/);
    expect(MODELS.image).toMatch(/^gemini-/);
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

describe("selectThinkingLevel", () => {
  const highThinkingTasks = [
    "diagnosis",
    "apartment_analysis",
    "area_analysis",
    "scoring",
    "bundle",
    "validation",
  ] as const;

  for (const task of highThinkingTasks) {
    it(`uses "high" thinking for ${task}`, () => {
      expect(selectThinkingLevel(task)).toBe("high");
    });
  }

  const lowThinkingTasks = [
    "extraction",
    "search_brief",
    "search",
    "quick_score",
    "quick_screen",
    "mockup_prompt",
    "apartment_research",
  ] as const;

  for (const task of lowThinkingTasks) {
    it(`uses "low" thinking for ${task}`, () => {
      expect(selectThinkingLevel(task)).toBe("low");
    });
  }
});

describe("selectModelConfig", () => {
  it("pairs model with thinkingConfig", () => {
    const cfg = selectModelConfig("diagnosis");
    expect(cfg.model).toBe(MODELS.text);
    expect(cfg.thinkingConfig.thinkingLevel).toBe("high");
  });

  it("returns image model for image_generation", () => {
    const cfg = selectModelConfig("image_generation");
    expect(cfg.model).toBe(MODELS.image);
  });
});
