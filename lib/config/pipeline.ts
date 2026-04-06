/**
 * Centralized pipeline configuration.
 *
 * All tunable thresholds, limits, and parameters that were previously
 * hardcoded across scoring, calibration, orchestration, and validation modules.
 *
 * Adjust these values to tune pipeline behavior without modifying logic.
 */

// ─── Calibration ──────────────────────────────────────────────

export const CALIBRATION = {
  /** Target median for score distribution */
  targetMedian: 6.0,
  /** Damping factor for dynamic baseline computation */
  dampingFactor: 0.5,
  /** How aggressively to expand compressed scores. 1.0 = no change */
  expansionFactor: 1.2,
  /** If observed median is above this, apply inflation correction */
  inflationThreshold: 7.5,
  /** Max baseline adjustment (prevents extreme swings) */
  maxBaselineShift: 2.0,
  /** Minimum sample count before using dynamic baselines */
  minDynamicSamples: 5,
} as const;

// ─── Drift Monitor ────────────────────────────────────────────

export const DRIFT_MONITOR = {
  /** Max score records kept in memory per process */
  maxBufferSize: 5000,
  /** Minimum sample size before running drift checks */
  minSampleSize: 10,
  /** Minimum sample size before including in distribution summary */
  minSummarySamples: 3,
  /** Std dev below this triggers clustering warning */
  clusteringThreshold: 1.2,
  /** Median above this triggers inflation warning */
  highMedianThreshold: 7.5,
  /** Score range below this triggers low-spread warning */
  lowSpreadThreshold: 3,
} as const;

// ─── Orchestrator ─────────────────────────────────────────────

export const ORCHESTRATOR = {
  /** Hard token cap per search run (~$3-4 on Gemini pricing) */
  defaultTokenCap: 1_500_000,

  /** Concurrency limits per phase */
  concurrency: {
    search: 15,
    extract: 10,
    deepScore: 5,
    bundleEval: 3,
    backfillSearch: 10,
  },

  /** Price range filter multipliers (relative to tier range) */
  priceFilter: {
    maxMultiplier: 1.75,   // Accept up to 1.75x tier max (was 2x)
    minMultiplier: 0.4,    // Accept down to 0.4x tier min (was 0.3x)
  },

  /** Per-tier candidate limits */
  candidates: {
    topNForQuickScore: 8,
    quickScoreMinThreshold: 4,
    quickScorePassThreshold: 6,
    maxDeepScorePerTier: 12,
    topNFinal: 5,
    alsoConsideredMax: 20,
    cartesianCap: 27,
    topPerCategoryForBundle: 3,
  },

  /** Backfill triggers when strong products < this count */
  backfillStrongThreshold: 3,
  /** Minimum final_item_score for backfill products to be kept */
  backfillMinScore: 6,
} as const;

// ─── Bundle Math ──────────────────────────────────────────────

export const BUNDLE_MATH = {
  /** Delta-E thresholds for palette harmony scoring */
  palette: {
    /** Below this = too monotone */
    tooSimilarDe: 10,
    /** Ideal range upper bound */
    idealMaxDe: 35,
    /** Above this = chaotic */
    chaoticDe: 50,
    /** Delta-E from recommended palette that triggers warning */
    paletteAlignmentWarnDe: 30,
  },

  /** Material constraints */
  materials: {
    maxWoodSpecies: 2,
    maxMetalFinishes: 3,
    /** Ideal property variance range */
    idealMinVariance: 0.03,
    idealMaxVariance: 0.12,
  },

  /** Room coverage ratios (furniture footprint / room area) */
  coverage: {
    maxRatio: 0.75,
    minRatio: 0.20,
  },
} as const;

// ─── Product Scoring ──────────────────────────────────────────

export const PRODUCT_SCORING = {
  /** Floor value for geometric mean (prevents log(0)) */
  geometricMeanFloor: 0.5,
  /** Minimum confidence score to include in final results */
  minConfidenceScore: 4,
  /** Minimum sample count before using drift data for calibration */
  minDriftSamplesForCalibration: 5,
} as const;

// ─── Scale Relations ──────────────────────────────────────────

/** Relational size rules between furniture categories */
export const SCALE_RELATIONS_CONFIG = {
  coffeeTableToSofa: { minRatio: 0.5, maxRatio: 1.1, description: "Coffee table should be ½ to full width of sofa" },
  rugBeyondSofa: { extensionInches: 12, description: "Rug should extend ≥6\" beyond sofa on each side" },
  rugBeyondDiningTable: { extensionInches: 48, description: "Rug should extend ≥24\" beyond dining table for chair pullback" },
  nightstandTooBed: { maxWidthRatio: 0.4, description: "Nightstand should be ≤40% of bed width" },
  sideTableHeight: { minHeightRatio: 0.85, maxHeightRatio: 1.1, description: "Side table height should be 85-110% of sofa arm height" },
} as const;
