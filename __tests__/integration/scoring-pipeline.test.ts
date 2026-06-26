import { describe, it, expect, beforeEach } from "vitest";
import { computeFinalItemScore, determineVerdict } from "@/lib/scoring/product-scorer";
import { computeFinalBundleScore } from "@/lib/scoring/bundle-scorer";
import { calibrateScore, applyCategoryBaseline } from "@/lib/scoring/calibration";
import { recordProductScores, recordBundleScores, checkForDrift, resetScoreBuffer, getScoreDistributionSummary } from "@/lib/scoring/drift-monitor";
import { PRODUCT_WEIGHTS, BUNDLE_WEIGHTS } from "@/lib/scoring/weights";
import type { ProductScores, BundleScores } from "@/lib/types/scoring";

/**
 * Integration tests for the full scoring pipeline:
 * Raw LLM scores → calibration → drift monitoring → verdicts
 *
 * These tests verify the modules work correctly together,
 * not just in isolation.
 */

function makeProductScores(override: Partial<ProductScores> = {}): ProductScores {
  return {
    style_fit_score: 7, palette_fit_score: 7, material_fit_score: 7,
    scale_fit_score: 7, function_fit_score: 7, cohesion_fit_score: 7,
    value_fit_score: 7, confidence_score: 8,
    ...override,
  };
}

function makeBundleScores(override: Partial<BundleScores> = {}): BundleScores {
  return {
    palette_harmony_score: 7, material_balance_score: 7, scale_balance_score: 7,
    style_consistency_score: 7, room_completion_score: 7,
    spatial_arrangement_score: 7, practicality_score: 7,
    ...override,
  };
}

describe("Scoring pipeline integration", () => {
  beforeEach(() => {
    resetScoreBuffer();
  });

  it("product scores flow through calibration correctly", () => {
    const scores = makeProductScores({ style_fit_score: 8, scale_fit_score: 9 });
    const rawScore = computeFinalItemScore(scores);
    const calibratedScore = computeFinalItemScore(scores, "rug");

    // Rug baseline is -0.3, so calibrated should be lower
    expect(calibratedScore).toBeLessThan(rawScore);
    // But not dramatically different (baseline is small)
    expect(rawScore - calibratedScore).toBeLessThan(1);
  });

  it("bundle scores also get calibrated (no systematic gap with products)", () => {
    // Without calibration, bundle and product scores for same raw value should be close
    const productScores = makeProductScores();
    const bundleScores = makeBundleScores();

    const productFinal = computeFinalItemScore(productScores, "sofa"); // sofa has 0 baseline
    const bundleFinal = computeFinalBundleScore(bundleScores);

    // Both should be 7.0 since all scores are 7 and sofa baseline is 0
    expect(productFinal).toBe(7);
    expect(bundleFinal).toBe(7);
  });

  it("drift monitor records product and bundle scores correctly", () => {
    const productScores = makeProductScores();
    const bundleScores = makeBundleScores();

    recordProductScores(productScores as unknown as Record<string, number>);
    recordBundleScores(bundleScores as unknown as Record<string, number>);

    const summary = getScoreDistributionSummary();
    expect(summary["style_fit_score"]).toBeDefined();
    expect(summary["palette_harmony_score"]).toBeDefined();
    expect(summary["style_fit_score"].count).toBe(1);
  });

  it("drift detection triggers on inflated scores", () => {
    // Record 15 products with inflated scores (median > 7.5). Use deterministic
    // values — Math.random() in test data violates the determinism contract.
    for (let i = 0; i < 15; i++) {
      recordProductScores({
        style_fit_score: 8.5,
        palette_fit_score: 8.5,
        material_fit_score: 8.5,
        scale_fit_score: 8.5,
      });
    }

    const warnings = checkForDrift();
    const highMedianWarnings = warnings.filter((w) => w.issue === "high_median");
    expect(highMedianWarnings.length).toBeGreaterThan(0);
  });

  it("drift detection triggers on clustered scores", () => {
    // Record 15 products with tightly clustered scores. Deterministic values in
    // [6.5, 6.9] replicate the uniform spread of the original random range.
    for (let i = 0; i < 15; i++) {
      recordProductScores({
        style_fit_score: 6.5 + (i % 5) * 0.1, // cycles 6.5 6.6 6.7 6.8 6.9
        palette_fit_score: 6.5 + (i % 5) * 0.1,
      });
    }

    const warnings = checkForDrift();
    const clusterWarnings = warnings.filter((w) => w.issue === "clustering");
    expect(clusterWarnings.length).toBeGreaterThan(0);
  });

  it("calibration with drift data adjusts scores correctly", () => {
    // Simulate inflated model: record 15 high scores
    for (let i = 0; i < 15; i++) {
      recordProductScores({
        style_fit_score: 8.5,
        palette_fit_score: 8.5,
        material_fit_score: 8.5,
        scale_fit_score: 8.5,
        function_fit_score: 8.5,
        cohesion_fit_score: 8.5,
        value_fit_score: 8.5,
      });
    }

    // Now score a product — calibration should use drift data to adjust
    const scores = makeProductScores({ style_fit_score: 8, scale_fit_score: 8 });
    const withCalibration = computeFinalItemScore(scores, "rug");
    const withoutCalibration = computeFinalItemScore(scores);

    // With inflated drift data, calibration should adjust down
    expect(withCalibration).toBeLessThan(withoutCalibration);
  });

  it("verdicts are consistent across product and bundle pipelines", () => {
    // A score of 7.5 with confidence 7+ should be strong_yes for products
    const productVerdict = determineVerdict(7.5, 7);
    expect(productVerdict).toBe("strong_yes");

    // Same threshold check works
    expect(determineVerdict(7.5, 6)).not.toBe("strong_yes");
    expect(determineVerdict(6.5, 5)).toBe("yes");
    expect(determineVerdict(5.0, 3)).toBe("maybe");
    expect(determineVerdict(4.9, 10)).toBe("no");
  });

  it("weights are balanced: product weights sum to 1.0 and bundle weights sum to 1.0", () => {
    const productSum = Object.values(PRODUCT_WEIGHTS).reduce((a, b) => a + b, 0);
    const bundleSum = Object.values(BUNDLE_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(Math.round(productSum * 100) / 100).toBe(1.0);
    expect(Math.round(bundleSum * 100) / 100).toBe(1.0);
  });

  it("calibration pipeline is idempotent on neutral inputs", () => {
    // With no drift data and a 0-baseline category, calibration should be near-identity
    const raw = 7.0;
    const calibrated = calibrateScore(raw, "sofa"); // 0 baseline, no drift
    expect(calibrated).toBe(7.0);
  });

  it("category baselines differentiate high-scoring categories", () => {
    // Rugs tend to score high → negative baseline
    const rugScore = applyCategoryBaseline(7.5, "rug");
    // Accent chairs tend to score low → positive baseline
    const chairScore = applyCategoryBaseline(7.5, "accent_chair");

    expect(rugScore).toBeLessThan(7.5);
    expect(chairScore).toBeGreaterThan(7.5);
    expect(chairScore).toBeGreaterThan(rugScore);
  });

  it("full pipeline: inflated model → calibration corrects → accurate verdicts", () => {
    // 1. Model generates inflated scores
    const inflatedScores = makeProductScores({
      style_fit_score: 8.5,
      palette_fit_score: 8.0,
      material_fit_score: 8.0,
      scale_fit_score: 8.5,
      function_fit_score: 8.0,
      cohesion_fit_score: 8.0,
      value_fit_score: 7.5,
    });

    // 2. Without calibration: would score ~8.1 → strong_yes
    const rawFinal = computeFinalItemScore(inflatedScores);
    expect(rawFinal).toBeGreaterThan(8.0);
    expect(determineVerdict(rawFinal, 8)).toBe("strong_yes");

    // 3. With calibration for a rug (baseline -0.3): should be lower
    const calibratedFinal = computeFinalItemScore(inflatedScores, "rug");
    expect(calibratedFinal).toBeLessThan(rawFinal);

    // 4. Both should still be in valid range
    expect(calibratedFinal).toBeGreaterThanOrEqual(0);
    expect(calibratedFinal).toBeLessThanOrEqual(10);
  });
});
