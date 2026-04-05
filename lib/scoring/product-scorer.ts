import type { ProductScores, Verdict } from "@/lib/types/scoring";
import { PRODUCT_WEIGHTS, VERDICT_THRESHOLDS } from "./weights";
import { calibrateScore } from "./calibration";
import { getScoreDistributionSummary } from "./drift-monitor";

/**
 * Compute the final item score using a weighted geometric mean.
 *
 * One bad dimension tanks the overall score due to compounding:
 * - Arithmetic: (10+10+10+10+10+10+2)/7 = 8.86 — hides the 2
 * - Geometric: (10^6 × 2)^(1/7) = 7.24 — the 2 drags it down
 */
export function computeFinalItemScore(scores: ProductScores, category?: string): number {
  const FLOOR = 0.5; // Minimum score for log computation (prevents log(0))

  const dimensions: Array<{ weight: number; score: number }> = [
    { weight: PRODUCT_WEIGHTS.style_fit, score: scores.style_fit_score },
    { weight: PRODUCT_WEIGHTS.palette_fit, score: scores.palette_fit_score },
    { weight: PRODUCT_WEIGHTS.material_fit, score: scores.material_fit_score },
    { weight: PRODUCT_WEIGHTS.scale_fit, score: scores.scale_fit_score },
    { weight: PRODUCT_WEIGHTS.function_fit, score: scores.function_fit_score },
    { weight: PRODUCT_WEIGHTS.cohesion_fit, score: scores.cohesion_fit_score },
    { weight: PRODUCT_WEIGHTS.value_fit, score: scores.value_fit_score },
  ];

  let weightedLogSum = 0;
  let totalWeight = 0;

  for (const { weight, score } of dimensions) {
    const clamped = Math.max(score, FLOOR);
    weightedLogSum += weight * Math.log(clamped);
    totalWeight += weight;
  }

  if (totalWeight === 0) return 0;

  const geometricMean = Math.exp(weightedLogSum / totalWeight);
  const baseScore = Math.round(geometricMean * 100) / 100;

  // Apply programmatic calibration when category is provided
  if (category) {
    const summary = getScoreDistributionSummary();
    // Use the overall style_fit_score distribution as a proxy for general drift
    const styleDist = summary["style_fit_score"];
    const observedMedian = styleDist?.median;
    const observedMean = styleDist?.mean;
    return calibrateScore(baseScore, category, observedMedian, observedMean);
  }

  return baseScore;
}

export function determineVerdict(finalScore: number, confidenceScore: number): Verdict {
  if (
    finalScore >= VERDICT_THRESHOLDS.strong_yes.min_score &&
    confidenceScore >= VERDICT_THRESHOLDS.strong_yes.min_confidence
  ) {
    return "strong_yes";
  }
  if (
    finalScore >= VERDICT_THRESHOLDS.yes.min_score &&
    confidenceScore >= VERDICT_THRESHOLDS.yes.min_confidence
  ) {
    return "yes";
  }
  if (finalScore >= VERDICT_THRESHOLDS.maybe.min_score) {
    return "maybe";
  }
  return "no";
}
