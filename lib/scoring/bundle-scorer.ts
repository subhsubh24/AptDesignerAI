import type { BundleScores } from "@/lib/types/scoring";
import { BUNDLE_WEIGHTS } from "./weights";
import { calibrateScore } from "./calibration";
import { getScoreDistributionSummary } from "./drift-monitor";

export function computeFinalBundleScore(scores: BundleScores): number {
  const raw =
    BUNDLE_WEIGHTS.palette_harmony * scores.palette_harmony_score +
    BUNDLE_WEIGHTS.material_balance * scores.material_balance_score +
    BUNDLE_WEIGHTS.scale_balance * scores.scale_balance_score +
    BUNDLE_WEIGHTS.style_consistency * scores.style_consistency_score +
    BUNDLE_WEIGHTS.room_completion * scores.room_completion_score +
    BUNDLE_WEIGHTS.spatial_arrangement * (scores.spatial_arrangement_score ?? 5) +
    BUNDLE_WEIGHTS.practicality * scores.practicality_score;

  const baseScore = Math.round(raw * 100) / 100;

  // Apply calibration using drift monitor data
  const summary = getScoreDistributionSummary();
  const styleDist = summary["style_consistency_score"];
  const observedMedian = styleDist?.median;
  const observedMean = styleDist?.mean;

  // Use "bundle" as category — no baseline shift, but expansion + inflation correction still apply
  return calibrateScore(baseScore, "bundle", observedMedian, observedMean);
}
