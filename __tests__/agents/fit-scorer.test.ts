import { describe, it, expect } from "vitest";
import { applyMathVeto } from "@/lib/agents/fit-scorer";
import type { ScoringContext, QuickScoreEntry } from "@/lib/agents/fit-scorer";
import { MATH_VETO } from "@/lib/config/pipeline";

/**
 * Tests for the fit-scorer module interfaces and data structures.
 * Actual API calls are not tested here (those need integration tests with Gemini).
 */
describe("ScoringContext interface", () => {
  it("should accept all spatial and environmental fields", () => {
    const ctx: ScoringContext = {
      roomType: "living_room",
      budgetMode: "balanced",
      existingItems: ["walnut media console", "gray sofa"],
      roomImageUrls: ["https://example.com/room1.jpg"],
      priorities: ["hosting", "comfort"],
      placement: "Between sofa and TV wall, centered",
      spatialLayout: "L-shaped seating with dining zone behind",
      floorPlan: {
        total_sqft: 650,
        room_dimensions: { living_room: "12x15" },
        notable_spatial_features: ["open to kitchen"],
      },
      lightingConditions: "South-facing windows, bright afternoon",
      windowDoorPositions: "Large window south wall, entry east",
      outletPositions: "South wall flanking window, east wall near entry",
    };

    expect(ctx.placement).toBeDefined();
    expect(ctx.spatialLayout).toBeDefined();
    expect(ctx.floorPlan).toBeDefined();
    expect(ctx.lightingConditions).toBeDefined();
    expect(ctx.windowDoorPositions).toBeDefined();
    expect(ctx.outletPositions).toBeDefined();
  });

  it("should work with minimal required fields only", () => {
    const ctx: ScoringContext = {
      roomType: "bedroom",
      budgetMode: "budget",
      existingItems: [],
      roomImageUrls: [],
    };
    expect(ctx.roomType).toBe("bedroom");
    expect(ctx.placement).toBeUndefined();
    expect(ctx.lightingConditions).toBeUndefined();
  });
});

describe("QuickScoreEntry interface", () => {
  it("should have scaleFit field", () => {
    const entry: QuickScoreEntry = {
      productId: "prod-123",
      quickScore: 7.2,
      styleFit: 8,
      scaleFit: 7,
      valueFit: 6,
      confidence: 8,
    };
    expect(entry.scaleFit).toBe(7);
  });

  it("should compute quick score as average of 4 dimensions", () => {
    const entry: QuickScoreEntry = {
      productId: "prod-123",
      quickScore: 0, // will calculate
      styleFit: 8,
      scaleFit: 6,
      valueFit: 7,
      confidence: 9,
    };
    const expectedAvg = (8 + 6 + 7 + 9) / 4; // 7.5
    entry.quickScore = Math.round(expectedAvg * 10) / 10;
    expect(entry.quickScore).toBe(7.5);
  });

  it("should handle fallback scores (all 5s with low confidence)", () => {
    const fallbackEntry: QuickScoreEntry = {
      productId: "prod-fail",
      quickScore: 5,
      styleFit: 5,
      scaleFit: 5,
      valueFit: 5,
      confidence: 3,
    };
    expect(fallbackEntry.quickScore).toBe(5);
    expect(fallbackEntry.confidence).toBe(3);
  });
});

/**
 * Behaviour tests for the math veto — the deterministic quality gate on the
 * product-scoring money path.
 *
 * The tests above this point only assert the SHAPE of interfaces (that an
 * object literal the test itself just wrote has the fields it wrote). They are
 * kept because they do pin the public types, but they exercise no behaviour.
 * These do.
 *
 * The veto is what stops the model talking itself into a 9 for a sofa that
 * physically does not fit, or whose colours fight the recommended palette:
 * where math is confident-bad (< MATH_VETO.threshold) and the model is
 * confident-good (> threshold * 10), math wins. It runs on every scored product
 * across the sourcing routes, and until now had no test at all.
 */
describe("applyMathVeto", () => {
  const T = MATH_VETO.threshold; // 0.6 — assertions below derive from this, not a literal

  /** Math scores that trigger nothing (all comfortably above threshold). */
  const cleanMath = { scale_fit: 0.9, palette_fit: 0.9, material_fit: 0.9 };
  /** AI scores the model is confident about. */
  const confidentAi = { scale_fit_score: 9, palette_fit_score: 9, material_fit_score: 9 };

  it("caps a confident AI score when math says the product does not fit", () => {
    const out = applyMathVeto(confidentAi, { ...cleanMath, scale_fit: 0.3 });
    expect(out.scale_fit_score).toBe(3);
    // the other dimensions are untouched
    expect(out.palette_fit_score).toBe(9);
    expect(out.material_fit_score).toBe(9);
  });

  it("caps each of the three dimensions independently", () => {
    expect(applyMathVeto(confidentAi, { ...cleanMath, palette_fit: 0.2 }).palette_fit_score).toBe(2);
    expect(applyMathVeto(confidentAi, { ...cleanMath, material_fit: 0.1 }).material_fit_score).toBe(1);
  });

  it("caps all three at once when math rejects the product outright", () => {
    const out = applyMathVeto(confidentAi, { scale_fit: 0.1, palette_fit: 0.2, material_fit: 0.3 });
    expect(out).toMatchObject({
      scale_fit_score: 1,
      palette_fit_score: 2,
      material_fit_score: 3,
    });
  });

  it("does NOT fire when math is exactly at the threshold (strict <)", () => {
    // A product sitting exactly on the bar is not a violation.
    const out = applyMathVeto(confidentAi, { ...cleanMath, scale_fit: T });
    expect(out.scale_fit_score).toBe(9);
  });

  it("does NOT fire when the AI score is exactly threshold*10 (strict >)", () => {
    // The model already agrees the product is mediocre — nothing to veto.
    const out = applyMathVeto(
      { ...confidentAi, scale_fit_score: T * 10 },
      { ...cleanMath, scale_fit: 0.1 },
    );
    expect(out.scale_fit_score).toBe(T * 10);
  });

  it("does NOT raise a low AI score toward a high math score", () => {
    // The veto is one-directional: math can only pull a score DOWN.
    const out = applyMathVeto({ ...confidentAi, scale_fit_score: 2 }, { ...cleanMath, scale_fit: 1 });
    expect(out.scale_fit_score).toBe(2);
  });

  it("rounds the capped value rather than truncating it", () => {
    expect(applyMathVeto(confidentAi, { ...cleanMath, scale_fit: 0.35 }).scale_fit_score).toBe(4);
    expect(applyMathVeto(confidentAi, { ...cleanMath, scale_fit: 0.34 }).scale_fit_score).toBe(3);
  });

  it("leaves the caller's object unmutated", () => {
    const input = { ...confidentAi };
    applyMathVeto(input, { scale_fit: 0.1, palette_fit: 0.1, material_fit: 0.1 });
    expect(input).toEqual(confidentAi);
  });

  it("preserves score fields that are not subject to the veto", () => {
    const withExtras = { ...confidentAi, style_fit_score: 8, confidence_score: 7 };
    const out = applyMathVeto(withExtras, { ...cleanMath, scale_fit: 0.2 });
    expect(out.style_fit_score).toBe(8);
    expect(out.confidence_score).toBe(7);
    expect(out.scale_fit_score).toBe(2);
  });

  it("is a no-op when math finds no violation", () => {
    expect(applyMathVeto(confidentAi, cleanMath)).toEqual(confidentAi);
  });
});
