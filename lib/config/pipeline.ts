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
  /**
   * Hard token cap per search run. Token budget is the ONLY real
   * upper bound on the agentic pipeline (every iteration cap on
   * turns / rounds / corrections has been removed in favor of
   * letting agents run until convergence). Set high so reasoning
   * isn't artificially constrained; raise via env to go higher.
   *
   * 10M tokens ≈ $20-30 on Gemini Flash Lite per run; well within
   * the per-room cost envelope for a high-quality result.
   */
  defaultTokenCap: process.env.SEARCH_TOKEN_CAP
    ? parseInt(process.env.SEARCH_TOKEN_CAP, 10)
    : 10_000_000,

  /**
   * Concurrency limits per phase. All non-image traffic uses Gemini 3.1
   * Flash Lite (10K RPM / 10M TPM on Tier 1) — these limits are sized to
   * max out parallelism while staying well clear of the rate-limit ceiling.
   */
  concurrency: {
    search: 50,
    extract: 25,
    deepScore: 30,
    bundleEval: 20,
    backfillSearch: 30,
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
    cartesianCap: 12,
    topPerCategoryForBundle: 3,
  },

  /** Backfill triggers when strong products < this count */
  backfillStrongThreshold: 3,
  /** Minimum final_item_score for backfill products to be kept */
  backfillMinScore: 6,

  /**
   * When true, the post-search phase (validation/audit/correction/bundle/
   * backfill/fill-tiers) is driven by an agentic function-calling
   * coordinator. The coordinator decides which phases to run and in what
   * order based on objective state signals.
   *
   * Default ON. Set ENABLE_POST_SEARCH_COORDINATOR=0 to fall back to the
   * hardcoded linear flow. Default-ON is the maximally-agentic posture:
   * Gemini 3 makes the post-search decisions, with the linear flow as
   * a manual override.
   */
  enablePostSearchCoordinator:
    process.env.ENABLE_POST_SEARCH_COORDINATOR !== "0" &&
    process.env.ENABLE_POST_SEARCH_COORDINATOR !== "false",

  /**
   * When ON (default), the DesignCoordinator agent orchestrates the
   * area-analysis pipeline using native function calling. When OFF,
   * the hardcoded Pass A → Pass B → enrich → harmony flow runs.
   */
  enableDesignCoordinator:
    process.env.ENABLE_DESIGN_COORDINATOR !== "0" &&
    process.env.ENABLE_DESIGN_COORDINATOR !== "false",
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

// ─── Math Veto ────────────────────────────────────────────────

export const MATH_VETO = {
  /**
   * When a math score (0-1) is below this threshold AND the AI score (0-10)
   * is above the corresponding value (threshold * 10), the AI score gets
   * capped to the math score * 10.
   *
   * Example: threshold=0.6 means if math says 0.4 (bad) and AI says 7 (good),
   * the AI score is capped to 4. This prevents AI from overriding math facts.
   */
  threshold: 0.6,

  /** Dimensions subject to math veto for individual products */
  productDimensions: ["scale_fit", "palette_fit", "material_fit"] as const,

  /** Dimensions subject to math veto for bundles */
  bundleDimensions: ["palette_harmony", "material_balance", "scale_balance", "spatial_feasibility", "completeness"] as const,
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

// ─── Image Generation (Nano Banana 2 / Gemini 3.1 Flash Image Preview) ──

/**
 * Config for Gemini 3.1 Flash Image Preview ("Nano Banana 2").
 *
 * - Default output resolution is 1K; 2K/4K give higher fidelity at higher
 *   cost and latency, and 0.5K is useful for thumbnail previews.
 * - Aspect ratios: the standard square/landscape/portrait set plus the
 *   wide/tall Nano Banana 2 additions (1:4, 4:1, 1:8, 8:1) which are
 *   handy for banners and full-wall elevation views.
 * - `imageSearchGrounding`: opt-in real-time Google Search grounding for
 *   the image model. When enabled, the generator can consult web text +
 *   image results (e.g. current product photos, architectural references)
 *   before rendering.
 */
export const IMAGE_GENERATION_CONFIG = {
  /**
   * Default output resolution for Nano Banana Pro (gemini-3-pro-image-preview).
   * 2K is the recommended default for room mockups — sharp enough for full-screen
   * preview without the cost/latency of 4K. Use 4K for premium export.
   */
  defaultImageSize: "2K",
  defaultAspectRatio: "16:9",
  defaultThumbnailSize: "0.5K",

  /** Fast-preview size for Nano Banana 2 quick renders (progress thumbnails). */
  fastPreviewImageSize: "1K",

  allowedImageSizes: ["0.5K", "1K", "2K", "4K"] as const,
  allowedAspectRatios: [
    "1:1", "3:4", "4:3", "9:16", "16:9", "2:3", "3:2",
    "1:4", "4:1", "1:8", "8:1",
  ] as const,

  /** Default grounding behavior for mockup/vision renders.
   * Disabled: product images are already attached as visual blocks, and web
   * search introduces non-determinism that conflicts with room photos. */
  imageSearchGroundingDefault: false,
} as const;

// ─── Media Resolution Policy ──────────────────────────────────

/**
 * Centralized per-agent media resolution policy. `ultra_high` is the
 * 4K tier and is used wherever the agent must reason about subtle visual
 * detail (fabric texture, material grain, lighting quality, spatial
 * relationships, scale). Ultra-high uses more tokens — only downgrade to
 * `high` for calls that don't need to see the room architecture.
 */
export const MEDIA_RESOLUTION = {
  diagnosis: "ultra_high",
  validation: "ultra_high",
  fitScoring: "ultra_high",
  quickScore: "ultra_high",
  productExtraction: "high",
} as const;

// ─── Room Furnishing Tiers ────────────────────────────────────

/**
 * Three-tier furnishing model defining what "fully furnished" means per room type.
 *
 * essential: Must-have items for the room to function
 * standard:  Expected in a well-furnished room
 * finishing: Decorative completeness
 *
 * minItemCount: Minimum items before the pipeline logs a furnishing gap warning
 * optimalRange: Target range for a complete, well-furnished room [min, max]
 */
export const ROOM_FURNISHING_TIERS: Record<string, {
  essential: string[];
  standard: string[];
  finishing: string[];
  minItemCount: number;
  optimalRange: [number, number];
}> = {
  living_room: {
    essential: ["sofa", "area_rug", "coffee_table", "floor_lamp"],
    standard: ["side_table", "throw_pillows", "media_console", "table_lamp", "accent_chair"],
    finishing: ["wall_art", "plant", "throw_blanket", "vase", "tray", "decorative_objects", "bookshelf",
                "candles", "baskets", "books_styled", "greenery_small", "frames", "poufs", "decorative_bowls"],
    minItemCount: 8,
    optimalRange: [14, 25],
  },
  bedroom: {
    essential: ["bed", "nightstand", "area_rug", "table_lamp"],
    standard: ["dresser", "throw_pillows", "mirror", "second_nightstand"],
    finishing: ["plant", "wall_art", "throw_blanket", "decorative_objects", "bench",
                "candles", "books_styled", "greenery_small", "frames", "tray_styling"],
    minItemCount: 7,
    optimalRange: [10, 20],
  },
  dining_room: {
    essential: ["dining_table", "dining_chairs", "pendant_light"],
    standard: ["area_rug", "sideboard", "table_runner"],
    finishing: ["wall_art", "plant", "centerpiece", "candles", "decorative_bowl",
                "baskets", "books_styled", "sculptures", "frames"],
    minItemCount: 6,
    optimalRange: [10, 18],
  },
  home_office: {
    essential: ["desk", "desk_chair", "task_lamp"],
    standard: ["bookshelf", "area_rug", "storage"],
    finishing: ["plant", "wall_art", "desk_accessories", "decorative_objects",
                "candles", "books_styled", "greenery_small", "frames", "baskets"],
    minItemCount: 5,
    optimalRange: [8, 16],
  },
  entryway: {
    essential: ["console_table", "mirror", "area_rug"],
    standard: ["coat_hooks", "storage_bench", "table_lamp"],
    finishing: ["plant", "wall_art", "tray", "vase",
                "candles", "baskets", "sculptures", "decorative_bowls", "frames"],
    minItemCount: 4,
    optimalRange: [7, 14],
  },
  nursery: {
    essential: ["crib", "dresser", "area_rug", "table_lamp"],
    standard: ["rocking_chair", "storage"],
    finishing: ["wall_art", "plant", "decorative_objects", "mobile",
                "books_styled", "poufs", "greenery_small", "frames"],
    minItemCount: 6,
    optimalRange: [9, 16],
  },
  kitchen: {
    essential: ["bar_stools", "pendant_light"],
    standard: ["kitchen_rug", "storage_containers"],
    finishing: ["plant", "wall_art", "decorative_bowls", "cookbook_display",
                "candles", "baskets", "tray_styling", "greenery_small"],
    minItemCount: 4,
    optimalRange: [7, 14],
  },
  bathroom: {
    essential: ["bath_mat", "mirror", "storage"],
    standard: ["towel_rack", "plant"],
    finishing: ["wall_art", "decorative_objects", "candles", "tray",
                "baskets", "frames", "greenery_small"],
    minItemCount: 4,
    optimalRange: [7, 13],
  },
  guest_room: {
    essential: ["bed", "nightstand", "table_lamp"],
    standard: ["dresser", "area_rug", "mirror"],
    finishing: ["wall_art", "plant", "throw_blanket", "decorative_objects",
                "candles", "books_styled", "tray_styling", "frames"],
    minItemCount: 6,
    optimalRange: [9, 18],
  },
  studio: {
    essential: ["sofa", "area_rug", "floor_lamp", "coffee_table", "desk"],
    standard: ["bookshelf", "throw_pillows", "side_table", "desk_chair"],
    finishing: ["wall_art", "plant", "throw_blanket", "vase", "decorative_objects",
                "candles", "baskets", "books_styled", "greenery_small", "frames", "poufs", "tray_styling"],
    minItemCount: 9,
    optimalRange: [15, 28],
  },
};
