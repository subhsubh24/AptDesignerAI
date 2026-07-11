import { describe, it, expect, beforeEach } from "vitest";
import { computeDynamicBaseline } from "@/lib/scoring/calibration";
import {
  recordProductScores,
  resetScoreBuffer,
} from "@/lib/scoring/drift-monitor";

// computeDynamicBaseline drives every product's category baseline shift
// (applyCategoryBaseline calls it), so a regression in its threshold, damping,
// or clamping silently skews all scores. It reads the live drift buffer, which
// we seed via the drift-monitor public API. The dynamic adjustment is
// -(observedMedian - targetMedian) * 0.5, clamped to [-2, 2]; below the 5-sample
// threshold it falls back to the static per-category baseline.

// Record `count` identical scores under `${category}_final_item_score` so the
// distribution has a clean, known median.
function seedCategory(category: string, value: number, count: number): void {
  for (let i = 0; i < count; i++) {
    recordProductScores({ [`${category}_final_item_score`]: value });
  }
}

describe("computeDynamicBaseline", () => {
  beforeEach(() => {
    resetScoreBuffer();
  });

  it("computes a data-driven downward shift when the observed median is above target", () => {
    // median 8, target 6 -> -(8-6)*0.5 = -1.0
    seedCategory("rug", 8, 5);
    expect(computeDynamicBaseline("rug", 6.0)).toBeCloseTo(-1.0, 10);
  });

  it("shifts upward when the observed median is below target", () => {
    // median 4, target 6 -> -(4-6)*0.5 = +1.0
    seedCategory("sofa", 4, 5);
    expect(computeDynamicBaseline("sofa", 6.0)).toBeCloseTo(1.0, 10);
  });

  it("returns 0 from the dynamic path when the median equals the target", () => {
    seedCategory("artwork", 6, 5);
    // -(6-6)*0.5 is -0; toBeCloseTo treats it as 0 (toBe would distinguish -0).
    expect(computeDynamicBaseline("artwork", 6.0)).toBeCloseTo(0, 10);
  });

  it("clamps extreme downward adjustments to -2", () => {
    // median 20, target 6 -> -7, clamped to -2
    seedCategory("rug", 20, 6);
    expect(computeDynamicBaseline("rug", 6.0)).toBe(-2);
  });

  it("clamps extreme upward adjustments to +2", () => {
    // median 0, target 6 -> +3, clamped to +2
    seedCategory("rug", 0, 6);
    expect(computeDynamicBaseline("rug", 6.0)).toBe(2);
  });

  it("falls back to the static baseline below the 5-sample threshold", () => {
    // Only 4 samples -> not enough data -> static rug baseline (-0.3), NOT the
    // dynamic value that median 10 would produce (-2).
    seedCategory("rug", 10, 4);
    expect(computeDynamicBaseline("rug", 6.0)).toBeCloseTo(-0.3, 10);
  });

  it("uses the static baseline when a category has no drift data", () => {
    expect(computeDynamicBaseline("accent_chair")).toBeCloseTo(0.2, 10);
  });

  it("returns 0 for an unknown category with no drift data and no static entry", () => {
    expect(computeDynamicBaseline("nonexistent_category")).toBe(0);
  });

  it("matches the category case-insensitively against the drift key", () => {
    seedCategory("rug", 8, 5);
    // "RUG" must resolve to the same rug_final_item_score distribution as "rug".
    expect(computeDynamicBaseline("RUG", 6.0)).toBeCloseTo(-1.0, 10);
  });

  it("defaults the target median to 6.0 when omitted", () => {
    seedCategory("desk", 8, 5); // -(8-6)*0.5 = -1.0 with the default target
    expect(computeDynamicBaseline("desk")).toBeCloseTo(-1.0, 10);
  });
});
