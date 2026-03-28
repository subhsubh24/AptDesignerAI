/**
 * Scoring weight constants for product and bundle evaluation.
 * Adjust these to tune the scoring system.
 */

export const PRODUCT_WEIGHTS = {
  style_fit: 0.18,
  palette_fit: 0.16,
  material_fit: 0.12,
  scale_fit: 0.18,
  function_fit: 0.12,
  cohesion_fit: 0.16,
  value_fit: 0.08,
} as const;

export const BUNDLE_WEIGHTS = {
  palette_harmony: 0.18,
  material_balance: 0.14,
  scale_balance: 0.14,
  style_consistency: 0.16,
  room_completion: 0.12,
  spatial_arrangement: 0.16,
  practicality: 0.10,
} as const;

/** Verdict thresholds */
export const VERDICT_THRESHOLDS = {
  strong_yes: { min_score: 7.5, min_confidence: 7 },
  yes: { min_score: 6.5, min_confidence: 5 },
  maybe: { min_score: 5.0, min_confidence: 0 },
  // Below 5.0 = "no"
} as const;
