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
  // Use final_bundle_score distribution for drift detection (not a single proxy dimension)
  const bundleDist = summary["final_bundle_score"];
  const observedMedian = (bundleDist && bundleDist.count >= 5) ? bundleDist.median : undefined;
  const observedMean = (bundleDist && bundleDist.count >= 5) ? bundleDist.mean : undefined;

  // Use "bundle" as category — no baseline shift, but expansion + inflation correction still apply
  return calibrateScore(baseScore, "bundle", observedMedian, observedMean);
}

/**
 * Ground bundle confidence based on data quality signals across the bundle.
 *
 * Bundles inherit data quality issues from their constituent products.
 * A bundle with mostly well-documented products is more trustworthy than
 * one built from products with missing images, dimensions, or materials.
 */
export function groundBundleConfidence(
  rawConfidence: number,
  signals: {
    productCount: number;
    productsWithImages: number;
    productsWithDimensions: number;
    productsWithMaterials: number;
    productsWithPrices: number;
    hasRoomImages: boolean;
    mathValidationRan: boolean;
    hasFloorPlan: boolean;
  }
): number {
  let grounded = rawConfidence;

  // Penalize based on data coverage ratios across the bundle
  const { productCount } = signals;
  if (productCount === 0) return 1;

  const imageCoverage = signals.productsWithImages / productCount;
  const dimCoverage = signals.productsWithDimensions / productCount;
  const matCoverage = signals.productsWithMaterials / productCount;
  const priceCoverage = signals.productsWithPrices / productCount;

  // Penalties scale with how many products are missing data
  if (imageCoverage < 1.0) grounded -= (1.0 - imageCoverage) * 2.0;   // Images critical for visual scoring
  if (dimCoverage < 1.0) grounded -= (1.0 - dimCoverage) * 1.5;       // Dimensions critical for scale/spatial
  if (matCoverage < 1.0) grounded -= (1.0 - matCoverage) * 1.0;       // Materials for harmony assessment
  if (priceCoverage < 1.0) grounded -= (1.0 - priceCoverage) * 0.5;   // Prices for practicality

  if (!signals.hasRoomImages) grounded -= 1.0;
  if (!signals.mathValidationRan) grounded -= 0.5;
  if (!signals.hasFloorPlan) grounded -= 0.5;  // Spatial scoring is guesswork without floor plan

  return Math.max(1, Math.min(10, Math.round(grounded * 10) / 10));
}
