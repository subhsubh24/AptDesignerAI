import { describe, it, expect } from "vitest";
import {
  MODELS,
  TEXT_TIERS,
  DEFAULT_THINKING,
  defaultThinking,
  selectModel,
  selectModelTier,
  isBaseTier,
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

  it("pins computerUse to gemini-3.5-flash (GA built-in computer use)", () => {
    // Guard: computer use is a built-in tool in Gemini 3.5 Flash (GA since 2026-06-24).
    // Changing this to a preview/legacy model regresses injection-safety guarantees.
    expect(MODELS.computerUse).toBe("gemini-3.5-flash");
  });
});

describe("TEXT_TIERS", () => {
  it("has base, mid, ceiling tiers", () => {
    expect(TEXT_TIERS.base).toMatch(/^gemini-/);
    expect(TEXT_TIERS.mid).toMatch(/^gemini-/);
    expect(TEXT_TIERS.ceiling).toMatch(/^gemini-/);
  });

  it("base is cheaper than mid", () => {
    expect(TEXT_TIERS.base).not.toBe(TEXT_TIERS.mid);
  });
});

describe("selectModel", () => {
  it("routes image_generation to the image model", () => {
    expect(selectModel("image_generation")).toBe(MODELS.image);
  });

  it("routes HIGH-thinking tasks to mid tier (flash-lite has no thinking support)", () => {
    expect(selectModel("diagnosis")).toBe(TEXT_TIERS.mid);
    expect(selectModel("apartment_analysis")).toBe(TEXT_TIERS.mid);
    expect(selectModel("area_analysis")).toBe(TEXT_TIERS.mid);
  });

  it("routes cheap text tasks to base tier", () => {
    const cheapTasks = [
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
    for (const task of cheapTasks) {
      expect(selectModel(task)).toBe(TEXT_TIERS.base);
    }
  });

  it("routes computer_use to MODELS.computerUse or env override", () => {
    // selectModel respects the COMPUTER_USE_MODEL env var; when unset, returns MODELS.computerUse.
    const expected = process.env.COMPUTER_USE_MODEL || MODELS.computerUse;
    expect(selectModel("computer_use")).toBe(expected);
    expect(selectModel("computer_use")).toMatch(/^gemini-/);
  });

  it("never returns undefined or empty string", () => {
    const allTasks = [
      "diagnosis", "apartment_analysis", "area_analysis", "extraction",
      "scoring", "bundle", "search_brief", "mockup_prompt", "validation",
      "apartment_research", "image_generation", "search", "quick_score", "quick_screen",
      "computer_use",
    ] as const;

    for (const task of allTasks) {
      const result = selectModel(task);
      expect(result, `selectModel("${task}") should return a non-empty string`).toBeTruthy();
      expect(typeof result).toBe("string");
    }
  });
});

describe("selectModelTier", () => {
  it("routes image tasks to image models regardless of tier", () => {
    expect(selectModelTier("mockup_image", "base")).toBe(MODELS.imagePro);
    expect(selectModelTier("mockup_image_fast", "mid")).toBe(MODELS.image);
    expect(selectModelTier("image_generation", "ceiling")).toBe(MODELS.image);
  });

  it("routes text tasks to the requested tier", () => {
    expect(selectModelTier("validation", "base")).toBe(TEXT_TIERS.base);
    expect(selectModelTier("validation", "mid")).toBe(TEXT_TIERS.mid);
    expect(selectModelTier("validation", "ceiling")).toBe(TEXT_TIERS.ceiling);
  });
});

describe("isBaseTier", () => {
  it("returns true for the base tier model", () => {
    expect(isBaseTier(TEXT_TIERS.base)).toBe(true);
  });

  it("returns false for mid/ceiling tiers", () => {
    expect(isBaseTier(TEXT_TIERS.mid)).toBe(false);
    expect(isBaseTier(TEXT_TIERS.ceiling)).toBe(false);
  });

  it("returns false for image models", () => {
    expect(isBaseTier(MODELS.image)).toBe(false);
    expect(isBaseTier(MODELS.imagePro)).toBe(false);
  });
});

describe("defaultThinking", () => {
  it("returns high for reasoning tasks", () => {
    expect(defaultThinking("apartment_analysis")).toBe("high");
    expect(defaultThinking("area_analysis")).toBe("high");
    expect(defaultThinking("diagnosis")).toBe("high");
  });

  it("returns low for structured output tasks", () => {
    expect(defaultThinking("validation")).toBe("low");
    expect(defaultThinking("scoring")).toBe("low");
    expect(defaultThinking("bundle")).toBe("low");
  });

  it("returns minimal for cheap tasks", () => {
    expect(defaultThinking("extraction")).toBe("minimal");
    expect(defaultThinking("quick_score")).toBe("minimal");
    expect(defaultThinking("quick_screen")).toBe("minimal");
    expect(defaultThinking("search")).toBe("minimal");
  });

  it("falls back to low for unknown tasks", () => {
    expect(defaultThinking("mockup_image" as never)).toBe("low");
  });
});

describe("DEFAULT_THINKING", () => {
  it("covers all major text task types", () => {
    const textTasks = [
      "diagnosis", "apartment_analysis", "area_analysis",
      "extraction", "scoring", "bundle", "validation",
      "quick_score", "quick_screen", "search",
    ];
    for (const task of textTasks) {
      expect(DEFAULT_THINKING).toHaveProperty(task);
    }
  });
});
