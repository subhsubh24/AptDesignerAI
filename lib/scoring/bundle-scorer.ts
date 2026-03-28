import type { BundleScores } from "@/lib/types/scoring";
import { BUNDLE_WEIGHTS } from "./weights";

export function computeFinalBundleScore(scores: BundleScores): number {
  const raw =
    BUNDLE_WEIGHTS.palette_harmony * scores.palette_harmony_score +
    BUNDLE_WEIGHTS.material_balance * scores.material_balance_score +
    BUNDLE_WEIGHTS.scale_balance * scores.scale_balance_score +
    BUNDLE_WEIGHTS.style_consistency * scores.style_consistency_score +
    BUNDLE_WEIGHTS.room_completion * scores.room_completion_score +
    BUNDLE_WEIGHTS.spatial_arrangement * (scores.spatial_arrangement_score || 5) +
    BUNDLE_WEIGHTS.practicality * scores.practicality_score;

  return Math.round(raw * 100) / 100;
}
