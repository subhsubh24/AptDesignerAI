import type { BundleScores } from "@/lib/types/scoring";
import { BUNDLE_WEIGHTS } from "./weights";
import { calibrateScore } from "./calibration";
import { getScoreDistributionSummary } from "./drift-monitor";

/**
 * Compute the final bundle score using a weighted geometric mean.
 *
 * This mirrors the harmony scoring approach — one bad dimension tanks
 * the overall score due to compounding (vs arithmetic mean which hides it).
 *
 * - Arithmetic: (10+10+10+10+10+10+2)/7 = 8.86 — hides the 2
 * - Geometric: (10×10×10×10×10×10×2)^(1/7) = 7.24 — the 2 drags it down
 */
export function computeFinalBundleScore(scores: BundleScores): number {
  const FLOOR = 0.5; // Minimum score for log computation (prevents log(0))

  const dimensions: Array<{ key: string; weight: number; score: number }> = [
    { key: "palette_harmony", weight: BUNDLE_WEIGHTS.palette_harmony, score: scores.palette_harmony_score },
    { key: "material_balance", weight: BUNDLE_WEIGHTS.material_balance, score: scores.material_balance_score },
    { key: "scale_balance", weight: BUNDLE_WEIGHTS.scale_balance, score: scores.scale_balance_score },
    { key: "style_consistency", weight: BUNDLE_WEIGHTS.style_consistency, score: scores.style_consistency_score },
    { key: "room_completion", weight: BUNDLE_WEIGHTS.room_completion, score: scores.room_completion_score },
    { key: "spatial_arrangement", weight: BUNDLE_WEIGHTS.spatial_arrangement, score: scores.spatial_arrangement_score ?? 5 },
    { key: "practicality", weight: BUNDLE_WEIGHTS.practicality, score: scores.practicality_score },
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

  // Apply calibration using drift monitor data
  const summary = getScoreDistributionSummary();
  const styleDist = summary["style_consistency_score"];
  const observedMedian = styleDist?.median;
  const observedMean = styleDist?.mean;

  // Use "bundle" as category — no baseline shift, but expansion + inflation correction still apply
  return calibrateScore(baseScore, "bundle", observedMedian, observedMean);
}
