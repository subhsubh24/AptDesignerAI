import type { ProductScores, Verdict } from "@/lib/types/scoring";
import { PRODUCT_WEIGHTS, VERDICT_THRESHOLDS } from "./weights";
import { calibrateScore } from "./calibration";
import { getScoreDistributionSummary } from "./drift-monitor";

export function computeFinalItemScore(scores: ProductScores, category?: string): number {
  const raw =
    PRODUCT_WEIGHTS.style_fit * scores.style_fit_score +
    PRODUCT_WEIGHTS.palette_fit * scores.palette_fit_score +
    PRODUCT_WEIGHTS.material_fit * scores.material_fit_score +
    PRODUCT_WEIGHTS.scale_fit * scores.scale_fit_score +
    PRODUCT_WEIGHTS.function_fit * scores.function_fit_score +
    PRODUCT_WEIGHTS.cohesion_fit * scores.cohesion_fit_score +
    PRODUCT_WEIGHTS.value_fit * scores.value_fit_score;

  const baseScore = Math.round(raw * 100) / 100;

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
