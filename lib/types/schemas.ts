/**
 * Zod schemas for validating all LLM responses.
 * Every AI agent response gets validated through these schemas
 * before being used in the pipeline — preventing malformed data
 * from silently corrupting scores or crashing downstream.
 */

import { z } from "zod";

// ─── Helpers ──────────────────────────────────────────────────

/** Score must be a number 0-10 (coerced from string if needed). */
const score = z.coerce.number().min(0).max(10);

/** Non-empty string array with at least 1 item. */
const nonEmptyStringArray = z.array(z.string().min(1)).min(1);

/** String array that defaults to empty. */
const stringArray = z.array(z.string()).default([]);

// ─── Product Evaluation ───────────────────────────────────────

export const ProductScoresSchema = z.object({
  style_fit_score: score,
  palette_fit_score: score,
  material_fit_score: score,
  scale_fit_score: score,
  function_fit_score: score,
  cohesion_fit_score: score,
  value_fit_score: score,
  confidence_score: score,
});

export const ProductEvalReasoningSchema = z.object({
  top_reasons: z.array(z.string()).min(1).default(["No reasoning provided"]),
  risks: z.array(z.string()).default([]),
  suggestions: z.array(z.string()).default([]),
});

export const ProductEvalResponseSchema = z.object({
  scores: ProductScoresSchema,
  reasoning: ProductEvalReasoningSchema,
  area_fit_note: z.string().optional().default(""),
  apartment_fit_note: z.string().optional().default(""),
});

// Split-pass sub-schemas — kept for backward-compat with manual-path routes.
// scoreProduct now uses the merged CombinedEvalResponseSchema (single call).

/** Aesthetic-pass scores: style/palette/material/cohesion (vision + taste). */
export const AestheticScoresSchema = z.object({
  style_fit_score: score,
  palette_fit_score: score,
  material_fit_score: score,
  cohesion_fit_score: score,
});

export const AestheticEvalResponseSchema = z.object({
  scores: AestheticScoresSchema,
  reasoning: ProductEvalReasoningSchema,
  area_fit_note: z.string().optional().default(""),
  apartment_fit_note: z.string().optional().default(""),
});

/** Functional-pass scores: scale/function/value/confidence (objective/math-vetoed). */
export const FunctionalScoresSchema = z.object({
  scale_fit_score: score,
  function_fit_score: score,
  value_fit_score: score,
  confidence_score: score,
});

export const FunctionalEvalResponseSchema = z.object({
  scores: FunctionalScoresSchema,
});

/**
 * Combined single-pass response: all 8 dimensions + reasoning + optional notes.
 * Replaces the two-pass Promise.all — one LLM call instead of two per product.
 */
export const CombinedEvalResponseSchema = z.object({
  scores: ProductScoresSchema,
  reasoning: ProductEvalReasoningSchema,
  area_fit_note: z.string().optional().default(""),
  apartment_fit_note: z.string().optional().default(""),
});

// ─── Quick Score ──────────────────────────────────────────────

export const QuickScoreEntrySchema = z.object({
  index: z.coerce.number().int().min(0),
  style_fit: score,
  scale_fit: score.optional().default(5),
  value_fit: score,
  confidence: score,
});

export const QuickScoreResponseSchema = z.object({
  scores: z.array(QuickScoreEntrySchema).min(1),
});

// ─── Bundle Evaluation ────────────────────────────────────────

export const BundleScoresSchema = z.object({
  palette_harmony_score: score,
  material_balance_score: score,
  scale_balance_score: score,
  style_consistency_score: score,
  room_completion_score: score,
  spatial_arrangement_score: score.optional().default(5),
  practicality_score: score,
});

export const BundleAnalysisSchema = z.object({
  strongest_aspect: z.string().default("Not provided"),
  weakest_aspect: z.string().default("Not provided"),
  what_feels_missing: z.string().default("Not provided"),
  what_should_be_swapped_first: z.string().default("Not provided"),
});

export const RoomVibeSchema = z.object({
  vibe_summary: z.string().default(""),
  style_keywords: z.array(z.string()).default([]),
  color_story: z.string().default(""),
  mood: z.string().default(""),
}).optional();

// Split-pass sub-schemas for bundle evaluation.

/** Call A: dimension scores + verdict + analysis (holistic bundle quality). */
export const BundleScoringResponseSchema = z.object({
  scores: BundleScoresSchema,
  verdict: z.string().default("No verdict provided"),
  analysis: BundleAnalysisSchema,
});

/** Call B: room vibe narrative (purely descriptive, consumes Call A's verdict). */
export const BundleVibeResponseSchema = z.object({
  room_vibe: RoomVibeSchema,
});

export const BundleEvalResponseSchema = z.object({
  scores: BundleScoresSchema,
  verdict: z.string().default("No verdict provided"),
  analysis: BundleAnalysisSchema,
  room_vibe: RoomVibeSchema,
});

// ─── Harmony Validation ───────────────────────────────────────

/** 6-dimensional sub-scores for granular per-item harmony assessment */
export const HarmonySubScoresSchema = z.object({
  /** Color/palette fit: harmony with keeps, other items, design palette */
  color_fit: score,
  /** Spatial fit: physical fit, clearances, traffic flow, placement validity */
  spatial_fit: score,
  /** Material fit: material compatibility, wood/metal coherence, texture story */
  material_fit: score,
  /** Style coherence: alignment with design direction, style family, visual weight */
  style_coherence: score,
  /** Cross-room fit: apartment-wide palette/material/style coherence */
  cross_room_fit: score,
  /** Functional fit: practical use, durability, lifestyle match, acoustic/lighting */
  functional_fit: score,
});

/** Pairwise compatibility conflict between two items */
export const PairwiseConflictSchema = z.object({
  item_a: z.string(),
  item_b: z.string(),
  compatibility: score,
  conflict_type: z.string().default(""),
  reason: z.string().default(""),
});

export const HarmonyItemScoreSchema = z.object({
  category: z.string(),
  /** Overall harmony score — server-computed from sub_scores via weighted geometric mean */
  harmony_score: score,
  /** 6-dimensional sub-scores for granular assessment */
  sub_scores: HarmonySubScoresSchema,
  keeps_well_with: stringArray,
  clashes_with: stringArray,
  revised_search_title: z.string().nullable().optional(),
  revised_specs: z.string().nullable().optional(),
  revised_placement: z.string().nullable().optional(),
  drop: z.boolean().default(false),
  root_cause: z.string().nullable().optional(),
  reason: z.string().default(""),
  /** Chain-of-thought rationale: step-by-step reasoning that led to this score */
  rationale: z.string().nullable().optional(),
});

export const HarmonyValidationResponseSchema = z.object({
  confidence: score,
  item_scores: z.array(HarmonyItemScoreSchema).min(1),
  /** Pairwise conflicts: pairs with compatibility < 9.0 (omitted pairs assumed 9.5+) */
  pairwise_conflicts: z.array(PairwiseConflictSchema).default([]),
  overall_cohesion: score,
  palette_coherence: z.string().default(""),
  material_coherence: z.string().default(""),
  spatial_flow: z.string().default(""),
  issues: stringArray,
  revisedAnalysis: z.record(z.string(), z.unknown()).nullable().optional(),
});

// Split-pass sub-schemas for harmony validation (2 sequential calls merge into HarmonyValidationResponseSchema).

/** Call A: per-item scoring with 6 sub-dimensions + optional revisions. */
export const HarmonyItemScoresResponseSchema = z.object({
  item_scores: z.array(HarmonyItemScoreSchema).min(1),
});

/** Call B: global harmony + gaps, consuming Call A's item scores. */
export const HarmonyGlobalResponseSchema = z.object({
  confidence: score,
  pairwise_conflicts: z.array(PairwiseConflictSchema).default([]),
  overall_cohesion: score,
  palette_coherence: z.string().default(""),
  material_coherence: z.string().default(""),
  spatial_flow: z.string().default(""),
  issues: stringArray,
  revisedAnalysis: z.record(z.string(), z.unknown()).nullable().optional(),
});

// ─── Final Harmony Assessment ─────────────────────────────────

export const FinalAssessmentItemSchema = z.object({
  category: z.string(),
  final_score: score,
  /** 6-dimensional sub-scores for granular assessment */
  sub_scores: HarmonySubScoresSchema,
  needs_more_work: z.boolean().default(false),
  revised_search_title: z.string().nullable().optional(),
  revised_specs: z.string().nullable().optional(),
  revised_placement: z.string().nullable().optional(),
  root_cause: z.string().nullable().optional(),
  reason: z.string().default(""),
  /** Chain-of-thought rationale: step-by-step reasoning that led to this score */
  rationale: z.string().nullable().optional(),
});

export const FinalAssessmentResponseSchema = z.object({
  confidence: score,
  overall_cohesion: score,
  palette_coherence: z.string().default(""),
  material_coherence: z.string().default(""),
  spatial_flow: z.string().default(""),
  issues: stringArray,
  item_scores: z.array(FinalAssessmentItemSchema).min(1),
  /** Pairwise conflicts: pairs with compatibility < 9.0 */
  pairwise_conflicts: z.array(PairwiseConflictSchema).default([]),
  needs_more_rounds: z.boolean().default(false),
  round_budget: z.coerce.number().int().min(0).max(5).default(0),
});

// Split-pass sub-schemas for final assessment (3 sequential calls merge into FinalAssessmentResponseSchema).

/** Call A: per-item final scoring with revision history context. */
export const FinalItemScoresResponseSchema = z.object({
  item_scores: z.array(FinalAssessmentItemSchema).min(1),
});

/** Call B: holistic assessment, consuming Call A's scores. */
export const FinalHolisticResponseSchema = z.object({
  confidence: score,
  overall_cohesion: score,
  palette_coherence: z.string().default(""),
  material_coherence: z.string().default(""),
  spatial_flow: z.string().default(""),
  issues: stringArray,
  pairwise_conflicts: z.array(PairwiseConflictSchema).default([]),
});

/** Call C: convergence decision — more rounds or stop? */
export const FinalConvergenceResponseSchema = z.object({
  needs_more_rounds: z.boolean().default(false),
  round_budget: z.coerce.number().int().min(0).max(5).default(0),
});

// ─── Product Set Validation ───────────────────────────────────

export const ProductFlagSchema = z.object({
  title: z.string(),
  category: z.string(),
  harmony_score: score,
  /** 6-dimensional sub-scores for granular per-product assessment */
  sub_scores: HarmonySubScoresSchema.optional(),
  reason: z.string().default(""),
});

export const ProductSetValidationResponseSchema = z.object({
  isValid: z.boolean(),
  confidence: score,
  issues: stringArray,
  product_flags: z.array(ProductFlagSchema).optional(),
  /** Pairwise conflicts between products in the set (pairs with compatibility < 9.0) */
  pairwise_conflicts: z.array(PairwiseConflictSchema).default([]),
});

// ─── Room Diagnosis ───────────────────────────────────────────

export const DiagnosisDataSchema = z.object({
  current_vibe_summary: z.string().default(""),
  what_is_working: nonEmptyStringArray,
  what_is_not_working: nonEmptyStringArray,
  biggest_improvement_opportunities: z.array(z.string()).min(1),
  missing_furniture_categories: z.array(z.string()).min(1),
  color_issues: stringArray,
  texture_material_issues: stringArray,
  scale_proportion_issues: stringArray,
  layout_issues: stringArray,
  spatial_gaps: stringArray.default([]),
  lighting_issues: stringArray,
  clutter_editing_issues: stringArray,
  /**
   * Room type verification. Inferred room type from photos; flagged when it
   * doesn't match the user-declared room_type so the caller can warn/block
   * before running downstream expensive passes on the wrong room.
   */
  room_type_confirmation: z
    .object({
      inferred_room_type: z.string().default(""),
      matches_declared: z.boolean().default(true),
      confidence: z.enum(["high", "medium", "low"]).default("high"),
      note: z.string().default(""),
    })
    .optional(),
});

export const DesignDirectionSchema = z.object({
  recommended_palette: z.array(z.string()).min(1),
  recommended_materials: z.array(z.string()).min(1),
  recommended_textures: z.array(z.string()).default([]),
  recommended_furniture_types: z.array(z.union([
    z.string(),
    z.object({ type: z.string(), notes: z.string().optional() }),
  ])).default([]),
  style_notes: z.string().default(""),
});

export const ActionItemSchema = z.object({
  priority: z.coerce.number(),
  action: z.string(),
  category: z.string(),
  reasoning: z.string().default(""),
  /** Distinguishes sub-types within a category (e.g., "trailing shelf" vs "tall floor") */
  variant: z.string().optional(),
  /** Number of this item to source — null / undefined = 1 */
  quantity: z.coerce.number().optional(),
  /** WHERE in the room — reference walls, windows, doors, and existing furniture */
  placement: z.string().optional(),
  /** Tracks whether this entry was produced by the initial diagnosis or the greedy expansion */
  source: z.enum(["diagnosis", "expansion"]).default("diagnosis"),
});

export const DiagnosisResponseSchema = z.object({
  diagnosis: DiagnosisDataSchema,
  design_direction: DesignDirectionSchema,
  missing_categories: z.array(z.string()).default([]),
  action_list: z.array(ActionItemSchema).default([]),
});

// Split-pass sub-schemas (runRoomDiagnosis runs two sequential calls).
// Call A produces analysis; Call B consumes it to produce the plan.

/** Call A: diagnosis + design direction (vision-heavy analysis). */
export const DiagnosisAnalysisResponseSchema = z.object({
  diagnosis: DiagnosisDataSchema,
  design_direction: DesignDirectionSchema,
});

/** Call B: missing categories + action list (text-reasoning plan). */
export const DiagnosisPlanResponseSchema = z.object({
  missing_categories: z.array(z.string()).default([]),
  action_list: z.array(ActionItemSchema).default([]),
});

// ─── Search Brief ─────────────────────────────────────────────

export const QueryWithAngleSchema = z.object({
  query: z.string().min(1),
  angle: z.string().default(""),
});

export const TierBriefSchema = z.object({
  search_queries: z.array(QueryWithAngleSchema).min(1),
  price_range: z.object({
    min: z.coerce.number().min(0),
    max: z.coerce.number().min(0),
  }),
});

// NOTE: `tiers` MUST use an explicit object with fixed keys rather than
// z.record(...). When converted to JSON Schema, z.record emits the shape via
// `additionalProperties`, which Gemini's responseSchema does not support and
// we strip in lib/ai/schema.ts. The result is an empty schema — Gemini then
// happily returns `tiers: {}`, Zod accepts it (records allow empty), and the
// orchestrator ends up with zero search tasks. Explicit keys give Gemini a
// concrete schema to fill in.
export const SearchBriefCategorySchema = z.object({
  category: z.string().min(1),
  tiers: z.object({
    budget: TierBriefSchema.optional(),
    balanced: TierBriefSchema.optional(),
    high_end: TierBriefSchema.optional(),
  }),
  key_requirements: stringArray,
});

export const SearchBriefResponseSchema = z.object({
  categories: z.array(SearchBriefCategorySchema).min(1),
});

// ─── Quick Screen ─────────────────────────────────────────────

export const ScreenRatingSchema = z.object({
  index: z.coerce.number().int().min(0),
  rating: z.coerce.number().min(1).max(5),
  reason: z.string().optional(),
});

export const QuickScreenResponseSchema = z.object({
  ratings: z.array(ScreenRatingSchema).min(1),
});

// ─── Product Extraction ───────────────────────────────────────

export const ExtractedProductSchema = z.object({
  title: z.string().nullable().default(null),
  retailer: z.string().nullable().default(null),
  price: z.coerce.number().nullable().default(null),
  dimensions: z.object({
    width: z.coerce.number().optional(),
    depth: z.coerce.number().optional(),
    height: z.coerce.number().optional(),
    diameter: z.coerce.number().optional(),
    unit: z.enum(["inches", "cm"]).default("inches"),
  }).nullable().default(null),
  materials: z.array(z.string()).catch([]),
  colors: z.array(z.string()).catch([]),
  category: z.string().catch("unknown"),
  description: z.string().nullable().default(null),
  image_url: z.string().nullable().default(null),
  lifestyle_image_url: z.string().nullable().optional().default(null),
  visual_style_tags: z.array(z.string()).catch([]),
  available_variants: z.array(z.string()).catch([]),
});

// ─── Search Products ──────────────────────────────────────────

export const SearchProductEntrySchema = z.object({
  title: z.string().default(""),
  url: z.string().min(1),
  snippet: z.string().default(""),
  source: z.string().default(""),
});

export const SearchProductsResponseSchema = z.object({
  products: z.array(SearchProductEntrySchema).default([]),
});

// ─── Identified Products (furniture brand/model recognition) ──

/**
 * Bounding box in normalized coordinates (0..1) relative to the source image.
 * Origin at top-left. Used by the furniture cropper and retained on the
 * identified-product entry so the frontend can render crops for confirmation.
 */
export const BoundingBoxSchema = z.object({
  x: z.coerce.number().min(0).max(1),
  y: z.coerce.number().min(0).max(1),
  w: z.coerce.number().min(0).max(1),
  h: z.coerce.number().min(0).max(1),
});

/** Furniture cropper output — one item per detected piece per room photo. */
export const FurnitureCropsResponseSchema = z.object({
  crops: z.array(z.object({
    label: z.string().default(""),  // rough category label from vision ("sofa", "chair")
    box: BoundingBoxSchema,
  })).default([]),
});

/** Retrieval prior from pgvector/in-memory ANN search. */
export const RetrievalPriorSchema = z.object({
  brand: z.string(),
  model: z.string(),
  similarity: z.coerce.number().min(0).max(1),
});

/**
 * Raw identifier output. Empty `candidates` array is the correct answer
 * in most rooms — the identifier is instructed to omit anything uncertain.
 */
export const IdentifiedProductCandidateSchema = z.object({
  brand: z.string().min(1),
  model: z.string().min(1),
  variant: z.string().nullable().optional(),
  category: z.string().default("unknown"),
  confidence: z.coerce.number().min(0).max(1),
  evidence: z.string().default(""),
  distinguishing_features: z.array(z.string()).default([]),
  bounding_box: BoundingBoxSchema.nullable().optional(),
});

export const IdentifierResponseSchema = z.object({
  candidates: z.array(IdentifiedProductCandidateSchema).default([]),
});

/** Verifier output — post grounded match check. */
export const IdentifiedProductVerifiedSchema = IdentifiedProductCandidateSchema.extend({
  verified: z.boolean(),
  match_score: z.coerce.number().min(0).max(1),
  mismatch_notes: z.array(z.string()).default([]),
  canonical_url: z.string().nullable().optional(),
  source_urls: z.array(z.string()).default([]),
});

export const VerifierResponseSchema = z.object({
  verified: z.boolean(),
  match_score: z.coerce.number().min(0).max(1),
  canonical_url: z.string().nullable().optional(),
  mismatch_notes: z.array(z.string()).default([]),
  source_urls: z.array(z.string()).default([]),
});

/**
 * Final enriched entry stored inline in room_diagnoses.diagnosis_json.
 * `user_confirmed` starts as null (not asked); the frontend confirmation pill
 * patches it to true/false via the confirm endpoint.
 */
export const IdentifiedProductDimensionsSchema = z.object({
  width_in: z.coerce.number().optional(),
  depth_in: z.coerce.number().optional(),
  height_in: z.coerce.number().optional(),
}).nullable().optional();

export const IdentifiedProductPriceRangeSchema = z.object({
  min: z.coerce.number(),
  max: z.coerce.number(),
  currency: z.string().default("USD"),
}).nullable().optional();

export const IdentifiedProductEnrichedSchema = z.object({
  brand: z.string(),
  model: z.string(),
  variant: z.string().nullable().optional(),
  category: z.string().default("unknown"),
  confidence: z.coerce.number().min(0).max(1),
  verified: z.boolean(),
  user_confirmed: z.boolean().nullable().optional(),
  canonical_url: z.string().nullable().optional(),
  source_urls: z.array(z.string()).default([]),
  dimensions: IdentifiedProductDimensionsSchema,
  materials: z.array(z.string()).default([]),
  colors: z.array(z.string()).default([]),
  price_range: IdentifiedProductPriceRangeSchema,
  image_url: z.string().nullable().optional(),
  evidence: z.string().default(""),
  distinguishing_features: z.array(z.string()).default([]),
  retrieval_priors: z.array(RetrievalPriorSchema).default([]),
  correction_source: z.enum(["model", "user"]).default("model"),
  embedding_written_back: z.boolean().default(false),
  bounding_box: BoundingBoxSchema.nullable().optional(),
  source_image_url: z.string().nullable().optional(),
});

export type IdentifiedProductCandidate = z.infer<typeof IdentifiedProductCandidateSchema>;
export type IdentifiedProductVerified = z.infer<typeof IdentifiedProductVerifiedSchema>;
export type IdentifiedProductEnriched = z.infer<typeof IdentifiedProductEnrichedSchema>;
export type RetrievalPrior = z.infer<typeof RetrievalPriorSchema>;
export type BoundingBox = z.infer<typeof BoundingBoxSchema>;
