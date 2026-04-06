/**
 * Programmatic score calibration.
 *
 * Applies post-hoc adjustments to LLM-generated scores to counteract
 * known systematic biases:
 * - Per-category baseline shifts (some categories score higher than others)
 * - Score compression (model clusters scores in 5-8 range)
 * - Inflation correction (median drift above target)
 *
 * These adjustments supplement the prompt-level calibration anchors —
 * they don't replace them.
 */

/**
 * (j) Static fallback baselines — used when drift monitor has insufficient data.
 * These are initial estimates; dynamic computation overrides them when data is available.
 */
const STATIC_CATEGORY_BASELINES: Record<string, number> = {
  rug: -0.3,
  area_rug: -0.3,
  floor_lamp: -0.2,
  table_lamp: -0.2,
  pendant_light: -0.2,
  accent_chair: 0.2,
  artwork: 0.2,
  sofa: 0,
  dining_table: 0,
  coffee_table: 0,
  side_table: 0,
  bookshelf: 0,
  media_console: 0,
  dresser: 0,
  bed_frame: 0,
  nightstand: 0,
  desk: 0,
  curtains: -0.1,
  throw_pillows: -0.2,
  throw_blanket: -0.2,
};

/**
 * (j) Dynamically compute category baselines from drift monitor data.
 * If the observed median for a category is far from the target,
 * compute a data-driven adjustment instead of using static guesses.
 */
import { getScoreDistributionSummary as getDriftSummary } from "./drift-monitor";

export function computeDynamicBaseline(category: string, targetMedian = 6.0): number {
  const summary = getDriftSummary();
  // Look for category-specific score data (e.g., "rug_final_item_score")
  const catKey = `${category.toLowerCase()}_final_item_score`;
  const catDist = summary[catKey];

  if (catDist && catDist.count >= 5 && catDist.median !== undefined && !isNaN(catDist.median)) {
    // Dynamic: adjustment = -(observedMedian - target) * dampingFactor
    const adjustment = -(catDist.median - targetMedian) * 0.5;
    return Math.max(-2, Math.min(2, adjustment)); // Clamp to prevent extreme swings
  }

  // Fall back to static baseline
  return STATIC_CATEGORY_BASELINES[category.toLowerCase()] ?? 0;
}

/** Exported for backward compatibility — callers can use this or computeDynamicBaseline directly */
export const CATEGORY_BASELINES: Record<string, number> = STATIC_CATEGORY_BASELINES;

export interface CalibrationConfig {
  /** Apply per-category baseline shifts. Default: true */
  applyBaselines?: boolean;
  /** Apply score expansion to combat compression. Default: true */
  applyExpansion?: boolean;
  /** Target median for the score distribution. Default: 6.0 */
  targetMedian?: number;
  /** If observed median is above this, apply inflation correction. Default: 7.5 */
  inflationThreshold?: number;
}

const DEFAULT_CONFIG: Required<CalibrationConfig> = {
  applyBaselines: true,
  applyExpansion: true,
  targetMedian: 6.0,
  inflationThreshold: 7.5,
};

/**
 * Apply category baseline adjustment to a final score.
 * (j) Uses dynamic computation from drift data when available.
 */
export function applyCategoryBaseline(
  score: number,
  category: string
): number {
  const adjustment = computeDynamicBaseline(category);
  return clamp(score + adjustment, 0, 10);
}

/**
 * Expand compressed scores away from the mean.
 *
 * If model scores cluster between 5.5 and 7.5 (common), this pushes
 * them toward the extremes to use more of the 0-10 range.
 *
 * Formula: expanded = mean + expansionFactor * (score - mean)
 * This symmetrically pushes scores above the mean higher and scores
 * below the mean lower, expanding the distribution in both directions.
 *
 * @param score - The original score
 * @param mean - The observed mean of recent scores (or 6.5 as default)
 * @param expansionFactor - How aggressively to expand. 1.0 = no change, 1.3 = moderate. Default: 1.2
 */
export function expandScore(
  score: number,
  mean = 6.5,
  expansionFactor = 1.2
): number {
  // Guard: mean must be valid
  if (mean < 0 || mean > 10 || isNaN(mean)) return score;
  const expanded = mean + expansionFactor * (score - mean);
  return clamp(expanded, 0, 10);
}

/**
 * Apply inflation correction when median is too high.
 *
 * Shifts all scores down proportionally to bring the distribution
 * back toward the target median.
 */
export function correctInflation(
  score: number,
  observedMedian: number,
  targetMedian = 6.0,
  inflationThreshold = 7.5
): number {
  if (observedMedian <= inflationThreshold) return score;
  const correction = (observedMedian - targetMedian) * 0.5;
  return clamp(score - correction, 0, 10);
}

/**
 * Full calibration pipeline: baseline → expansion → inflation correction.
 *
 * @param rawScore - The LLM-generated final score
 * @param category - Product category for baseline adjustment
 * @param observedMedian - Current observed median from drift monitor (optional)
 * @param observedMean - Current observed mean from drift monitor (optional)
 * @param config - Calibration configuration
 */
export function calibrateScore(
  rawScore: number,
  category: string,
  observedMedian?: number,
  observedMean?: number,
  config: CalibrationConfig = {}
): number {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  let score = rawScore;

  // Step 1: Category baseline
  if (cfg.applyBaselines) {
    score = applyCategoryBaseline(score, category);
  }

  // Step 2: Score expansion (only if we have observed mean)
  if (cfg.applyExpansion && observedMean !== undefined) {
    score = expandScore(score, observedMean);
  }

  // Step 3: Inflation correction (only if we have observed median)
  if (observedMedian !== undefined) {
    score = correctInflation(score, observedMedian, cfg.targetMedian, cfg.inflationThreshold);
  }

  return Math.round(score * 100) / 100;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
