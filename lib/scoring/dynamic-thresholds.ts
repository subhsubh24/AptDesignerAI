/**
 * Dynamic thresholds — distribution-derived alternatives to hardcoded
 * cutoffs.
 *
 * Subjective-domain note: hardcoded thresholds (`score >= 6`,
 * `>= 3 strong products`) assume a fixed score distribution. In practice
 * the distribution shifts per category, room, budget tier, and even per
 * run (model temperature, prompt drift). These helpers derive thresholds
 * from the OBSERVED distribution so the same logical decision ("keep the
 * top half") works regardless of where the model decided to anchor.
 *
 * All functions are deterministic — given the same input distribution,
 * they always return the same threshold. No LLM calls; no randomness.
 *
 * Use these whenever a hardcoded numeric cutoff would otherwise live in
 * the orchestrator or a scorer. Pair each with a sensible MIN floor and
 * MAX ceiling so degenerate distributions (1 product, all-equal scores)
 * fall back to safe defaults.
 */

/**
 * Compute a percentile (0-100) of a number array. Linear interpolation
 * between adjacent elements when the percentile falls between indices.
 *
 * Examples:
 *   percentile([1, 2, 3, 4, 5], 50) === 3   (median)
 *   percentile([1, 2, 3, 4, 5], 75) === 4
 *   percentile([1, 2, 3, 4, 5], 100) === 5
 */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  if (values.length === 1) return values[0];
  if (p <= 0) return Math.min(...values);
  if (p >= 100) return Math.max(...values);

  const sorted = [...values].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower];
  const frac = idx - lower;
  return sorted[lower] * (1 - frac) + sorted[upper] * frac;
}

/** Median = 50th percentile, with safe fallback. */
export function median(values: number[]): number {
  return percentile(values, 50);
}

/** Population standard deviation (not sample). 0 when < 2 values. */
export function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Threshold to identify "strong" products in a category.
 * Distribution-derived: 60th percentile of the score distribution.
 *
 * Why 60th percentile: keeps the "above-average" products by definition.
 * In a normal distribution this is ~mean + 0.25σ — selective without
 * being so strict that backfill always triggers.
 *
 * Bounded: never below `minFloor` (so we don't accept obvious duds even
 * when all scores are low) and never above `maxCeiling` (so a single
 * outlier doesn't lock everything else out).
 *
 * @param scores  All deep-scored final_item_scores for this category
 * @param minFloor  Minimum acceptable threshold (default 5.0 — products
 *                  below this are weak regardless of distribution)
 * @param maxCeiling  Maximum threshold (default 7.5 — never demand more
 *                    than this even if the distribution is excellent)
 */
export function getStrongProductThreshold(
  scores: number[],
  minFloor = 5.0,
  maxCeiling = 7.5,
): number {
  if (scores.length === 0) return minFloor;
  const p60 = percentile(scores, 60);
  return Math.max(minFloor, Math.min(maxCeiling, p60));
}

/**
 * Threshold for the quick-score gate (how strict should we be about
 * what passes from quick-score to deep-score). Distribution-derived
 * from the quick-score outputs.
 *
 * Strategy: keep the top `targetSurvivorPct` (default 60%) of products
 * by quick score, but never below `minFloor` (default 4.0 — quick scores
 * below this rarely earn deep-score budget) and never above `maxCeiling`
 * (default 7.0 — don't demand more than necessary).
 */
export function getQuickScoreGate(
  scores: number[],
  targetSurvivorPct = 60,
  minFloor = 4.0,
  maxCeiling = 7.0,
): number {
  if (scores.length === 0) return minFloor;
  // Keep top X% → cutoff is the (100 - X)th percentile
  const cutoff = percentile(scores, 100 - targetSurvivorPct);
  return Math.max(minFloor, Math.min(maxCeiling, cutoff));
}

/**
 * Number of strong products required per (category, tier) before
 * backfill is unnecessary. Scales with the typical product count per
 * category in this run — categories with naturally more products should
 * have more strong picks before we declare "done".
 *
 * Example:
 *   - 6 products in category, threshold 25% → require 2 strong
 *   - 12 products in category, threshold 25% → require 3 strong
 *   - Always between minRequired and maxRequired bounds
 */
export function getBackfillThreshold(
  productCount: number,
  pctRequired = 25,
  minRequired = 2,
  maxRequired = 4,
): number {
  const target = Math.ceil((productCount * pctRequired) / 100);
  return Math.max(minRequired, Math.min(maxRequired, target));
}

/**
 * Score floor for products to be KEPT after deep-scoring. Distribution-
 * derived: the 25th percentile of the deep-score distribution OR a
 * minimum floor, whichever is higher. This drops the bottom quartile
 * but no further — so even a "bad" run keeps its top 75%.
 *
 * Pair with `getStrongProductThreshold` for downstream "strong" decisions.
 */
export function getDeepScoreKeepFloor(
  scores: number[],
  minFloor = 5.0,
  maxCeiling = 6.5,
): number {
  if (scores.length === 0) return minFloor;
  const p25 = percentile(scores, 25);
  return Math.max(minFloor, Math.min(maxCeiling, p25));
}

/**
 * Decide whether two top scores are well-separated enough to skip
 * pairwise reranking. Distribution-derived: separation must exceed
 * 1 standard deviation of the score distribution to be considered
 * meaningful. Falls back to absolute gap when stdev is degenerate.
 */
export function isWellSeparated(
  topScores: number[],
  fullDistribution: number[],
  minAbsoluteGap = 1.5,
): boolean {
  if (topScores.length < 2) return true;
  const gap = topScores[0] - topScores[1];
  const sigma = stdev(fullDistribution);
  if (sigma > 0.1) return gap > sigma;
  return gap > minAbsoluteGap;
}

/**
 * Summary statistics for a score distribution. Useful for logging,
 * threshold-advisor prompts, and pipeline-trace events.
 */
export interface DistributionSummary {
  count: number;
  min: number;
  max: number;
  median: number;
  p25: number;
  p60: number;
  p75: number;
  mean: number;
  stdev: number;
}

export function summarizeDistribution(values: number[]): DistributionSummary {
  if (values.length === 0) {
    return { count: 0, min: 0, max: 0, median: 0, p25: 0, p60: 0, p75: 0, mean: 0, stdev: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return {
    count: values.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    median: percentile(sorted, 50),
    p25: percentile(sorted, 25),
    p60: percentile(sorted, 60),
    p75: percentile(sorted, 75),
    mean,
    stdev: stdev(values),
  };
}
