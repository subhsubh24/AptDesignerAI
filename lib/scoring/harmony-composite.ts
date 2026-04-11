/**
 * Harmony composite scoring engine.
 *
 * Computes a final harmony_score from 6 sub-dimensions using a weighted
 * geometric mean (naturally compounds — one bad dimension tanks everything)
 * plus pairwise compatibility penalties.
 *
 * Why geometric mean instead of arithmetic mean:
 * - Arithmetic: (10 + 10 + 10 + 10 + 10 + 2) / 6 = 8.67 — hides the 2
 * - Geometric: (10×10×10×10×10×2)^(1/6) = 6.31 — the 2 drags it down hard
 *
 * This ensures a catastrophic failure in ANY dimension (spatial, color, material)
 * cannot be hidden by high scores in other dimensions.
 */

export interface HarmonySubScores {
  color_fit: number;
  spatial_fit: number;
  material_fit: number;
  style_coherence: number;
  cross_room_fit: number;
  functional_fit: number;
}

export interface PairwiseConflict {
  item_a: string;
  item_b: string;
  compatibility: number;
  conflict_type: string;
  reason: string;
}

// ─── Dimension Weights ───────────────────────────────────────
// Sum = 1.0. Spatial and color are heaviest because they're
// math-anchored (most reliable) and have highest visual impact.

export const HARMONY_DIMENSION_WEIGHTS: Record<keyof HarmonySubScores, number> = {
  spatial_fit: 0.22,
  color_fit: 0.20,
  material_fit: 0.18,
  style_coherence: 0.17,
  cross_room_fit: 0.12,
  functional_fit: 0.11,
};

// ─── Math → AI Dimension Mapping ─────────────────────────────
// Maps each math module's output (0-1) to the AI sub-dimension it can cap.

export interface MathDimensionCaps {
  /** From color-math: palette_harmony */
  color_fit?: number;
  /** From spatial-math: combined coverage + clearance */
  spatial_fit?: number;
  /** From material-math: combined balance + wood + metal */
  material_fit?: number;
  /** From color-math: cross_room_coherence */
  cross_room_fit?: number;
  // style_coherence and functional_fit have no math anchor (AI-only)
}

/**
 * Apply per-dimension math caps to AI sub-scores.
 * Math can veto (cap) AI scores but never promote them.
 * Returns the capped sub-scores and a list of dimensions that were capped.
 */
/**
 * Convert a math score (0-1) to a cap value on the 0-10 scale.
 *
 * Uses linear mapping (×10) with a floor at 2.0 to prevent catastrophic
 * geometric mean collapse from near-zero caps.
 *
 * Mapping:
 *  math 0.90+ → no cap (handled by threshold check)
 *  math 0.80  → cap at 8.0
 *  math 0.60  → cap at 6.0
 *  math 0.50  → cap at 5.0
 *  math 0.30  → cap at 3.0
 *  math 0.00  → cap at 2.0 (floor)
 */
function mathToCapValue(mathNormalized: number): number {
  // Floor at 2.0/10 — no dimension should be capped to near-zero
  // since that creates catastrophic geometric mean collapse
  const floor = 2.0;
  return Math.round(Math.max(mathNormalized * 10, floor) * 10) / 10;
}

export function applyMathCaps(
  subScores: HarmonySubScores,
  mathCaps: MathDimensionCaps
): { capped: HarmonySubScores; cappedDimensions: Array<{ dimension: string; aiScore: number; mathCap: number }> } {
  const capped = { ...subScores };
  const cappedDimensions: Array<{ dimension: string; aiScore: number; mathCap: number }> = [];

  for (const [dim, mathNormalized] of Object.entries(mathCaps)) {
    if (mathNormalized === undefined || mathNormalized >= 0.90) continue;
    const key = dim as keyof HarmonySubScores;
    const mathCap = mathToCapValue(mathNormalized);
    if (capped[key] > mathCap) {
      cappedDimensions.push({ dimension: dim, aiScore: capped[key], mathCap });
      capped[key] = mathCap;
    }
  }

  return { capped, cappedDimensions };
}

/**
 * Compute the composite harmony score using weighted geometric mean.
 *
 * Formula: exp(Σ(w_i × ln(max(score_i, floor))) / Σ(w_i))
 *
 * The floor prevents log(0) and ensures a minimum contribution.
 * A score of 0.5/10 is the floor — anything below is equally catastrophic.
 */
export function computeCompositeScore(subScores: HarmonySubScores): number {
  const FLOOR = 0.5; // Minimum score for log computation
  let weightedLogSum = 0;
  let totalWeight = 0;

  for (const [dim, weight] of Object.entries(HARMONY_DIMENSION_WEIGHTS)) {
    const score = Math.max(subScores[dim as keyof HarmonySubScores], FLOOR);
    weightedLogSum += weight * Math.log(score);
    totalWeight += weight;
  }

  if (totalWeight === 0) return 0;

  const geometricMean = Math.exp(weightedLogSum / totalWeight);
  // Round to one decimal place
  return Math.round(geometricMean * 10) / 10;
}

/**
 * Compute pairwise penalty for a specific item.
 *
 * Looks at all pairwise conflicts involving this item's category.
 * The WORST compatibility score applies as a multiplicative penalty.
 *
 * - compatibility >= 9.0 → no penalty (1.0 factor)
 * - compatibility 5.0 → 0.75 factor (25% penalty)
 * - compatibility 2.0 → 0.50 factor (50% penalty)
 * - compatibility 0.0 → 0.30 factor (70% penalty, floor)
 *
 * The penalty is smooth: factor = 0.3 + 0.7 × (min(compatibility, 9) / 9)
 */
export function computePairwisePenalty(
  category: string,
  pairwiseConflicts: PairwiseConflict[]
): { factor: number; worstConflict?: PairwiseConflict } {
  // Find all conflicts involving this item
  const relevant = pairwiseConflicts.filter(
    (c) => c.item_a === category || c.item_b === category
  );

  if (relevant.length === 0) return { factor: 1.0 };

  // Find the worst compatibility score
  let worst = relevant[0];
  for (const conflict of relevant) {
    if (conflict.compatibility < worst.compatibility) {
      worst = conflict;
    }
  }

  // No penalty for good compatibility
  if (worst.compatibility >= 9.0) return { factor: 1.0 };

  // Smooth penalty: 0.3 at worst (compatibility=0) to 1.0 at compatibility=9
  const factor = 0.3 + 0.7 * (Math.min(worst.compatibility, 9) / 9);
  return { factor: Math.round(factor * 100) / 100, worstConflict: worst };
}

/**
 * Full composite scoring pipeline:
 * 1. Apply per-dimension math caps
 * 2. Compute weighted geometric mean
 * 3. Apply pairwise penalty
 * 4. Return final harmony_score
 */
export function computeFinalHarmonyScore(
  subScores: HarmonySubScores,
  mathCaps: MathDimensionCaps,
  category: string,
  pairwiseConflicts: PairwiseConflict[]
): {
  harmony_score: number;
  composite_before_pairwise: number;
  pairwise_factor: number;
  capped_sub_scores: HarmonySubScores;
  cappedDimensions: Array<{ dimension: string; aiScore: number; mathCap: number }>;
  worstConflict?: PairwiseConflict;
} {
  // Step 1: Math caps
  const { capped, cappedDimensions } = applyMathCaps(subScores, mathCaps);

  // Step 2: Weighted geometric mean
  const composite = computeCompositeScore(capped);

  // Step 3: Pairwise penalty
  const { factor, worstConflict } = computePairwisePenalty(category, pairwiseConflicts);

  // Step 4: Final score
  const harmony_score = Math.round(composite * factor * 10) / 10;

  return {
    harmony_score,
    composite_before_pairwise: composite,
    pairwise_factor: factor,
    capped_sub_scores: capped,
    cappedDimensions,
    worstConflict,
  };
}
