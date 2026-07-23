import { describe, it, expect } from "vitest";
import { computeQuickScore } from "@/lib/agents/fit-scorer";

/**
 * Unit tests for `computeQuickScore` — the pure quick-score fold + the
 * critical-dimension gate extracted from the LLM batch path in fit-scorer.ts.
 *
 * The gate is load-bearing: it stops a product with one fatal dimension
 * (style/scale/value ≤ 2) from riding a strong average past the deep-score
 * threshold. Assertions use exact values so a mutation to the gate condition,
 * the cap, the averaged dimensions, or the rounding is killed.
 */
describe("computeQuickScore", () => {
  describe("ungated path (all fit dimensions > 2)", () => {
    it("returns the plain average of all four dimensions, one-decimal rounded", () => {
      // (8 + 7 + 9 + 6) / 4 = 7.5 — no dimension ≤ 2, so no cap applies.
      expect(computeQuickScore(8, 7, 9, 6)).toBe(7.5);
    });

    it("rounds the average to one decimal place", () => {
      // (7 + 7 + 8 + 7) / 4 = 7.25 → 7.3 (round half up at the 2nd decimal).
      expect(computeQuickScore(7, 7, 8, 7)).toBe(7.3);
    });

    it("treats exactly 3 on every dimension as ungated (boundary above the gate)", () => {
      // minDim = 3 (> 2) → average, not capped. (3+3+3+3)/4 = 3.
      expect(computeQuickScore(3, 3, 3, 3)).toBe(3);
    });

    it("does NOT let a low confidence trigger the gate — only the three fit dimensions gate", () => {
      // confidence = 1 is NOT one of the gated dimensions; minDim over
      // style/scale/value is 6, so the average path is used, not the cap.
      // (6 + 7 + 8 + 1) / 4 = 5.5 (would be capped to 1 if confidence gated).
      expect(computeQuickScore(6, 7, 8, 1)).toBe(5.5);
    });
  });

  describe("gated path (a fit dimension ≤ 2 caps the score at that minimum)", () => {
    it("caps a strong-average product with a fatal style dimension", () => {
      // style=1 is fatal. avg = (1 + 8 + 9 + 8)/4 = 6.5, but min(6.5, 1) = 1.
      expect(computeQuickScore(1, 8, 9, 8)).toBe(1);
    });

    it("caps on a fatal scale dimension", () => {
      // scale=2 (≤ 2). avg = (9 + 2 + 9 + 9)/4 = 7.25, capped to min(7.3, 2) = 2.
      expect(computeQuickScore(9, 2, 9, 9)).toBe(2);
    });

    it("caps on a fatal value dimension", () => {
      // value=0. avg = (8 + 8 + 0 + 8)/4 = 6, capped to min(6, 0) = 0.
      expect(computeQuickScore(8, 8, 0, 8)).toBe(0);
    });

    it("uses the rounded average when it is BELOW the fatal minimum (cap does not raise)", () => {
      // minDim = 2 (all three fit dims are 2), so the gate fires. But a low
      // confidence drags avg = (2 + 2 + 2 + 0)/4 = 1.5 below the cap, so
      // min(1.5, 2) = 1.5 — the cap never INFLATES a genuinely low score.
      expect(computeQuickScore(2, 2, 2, 0)).toBe(1.5);
    });

    it("fires the gate exactly at the ≤ 2 boundary (2 gates, 3 does not)", () => {
      // minDim = 2 → gated. avg = (2 + 9 + 9 + 9)/4 = 7.25 → min(7.3, 2) = 2.
      expect(computeQuickScore(2, 9, 9, 9)).toBe(2);
    });
  });
});
