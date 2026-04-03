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

export const BundleEvalResponseSchema = z.object({
  scores: BundleScoresSchema,
  verdict: z.string().default("No verdict provided"),
  analysis: BundleAnalysisSchema,
  room_vibe: RoomVibeSchema,
});

// ─── Harmony Validation ───────────────────────────────────────

export const HarmonyItemScoreSchema = z.object({
  category: z.string(),
  harmony_score: score,
  keeps_well_with: stringArray,
  clashes_with: stringArray,
  revised_search_title: z.string().optional(),
  revised_specs: z.string().optional(),
  revised_placement: z.string().optional(),
  drop: z.boolean().default(false),
  root_cause: z.string().optional(),
  reason: z.string().default(""),
});

export const HarmonyValidationResponseSchema = z.object({
  confidence: score,
  item_scores: z.array(HarmonyItemScoreSchema).min(1),
  overall_cohesion: score,
  palette_coherence: z.string().default(""),
  material_coherence: z.string().default(""),
  spatial_flow: z.string().default(""),
  issues: stringArray,
  revisedAnalysis: z.record(z.string(), z.unknown()).nullable().optional(),
});

// ─── Product Set Validation ───────────────────────────────────

export const ProductFlagSchema = z.object({
  title: z.string(),
  category: z.string(),
  harmony_score: score,
  clashes_with: stringArray,
  reason: z.string().default(""),
});

export const ProductSetValidationResponseSchema = z.object({
  isValid: z.boolean(),
  confidence: score,
  issues: stringArray,
  suggestions: stringArray,
  product_flags: z.array(ProductFlagSchema).optional(),
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
  lighting_issues: stringArray,
  clutter_editing_issues: stringArray,
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
});

export const DiagnosisResponseSchema = z.object({
  diagnosis: DiagnosisDataSchema,
  design_direction: DesignDirectionSchema,
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
  retailers_to_target: stringArray,
});

export const SearchBriefCategorySchema = z.object({
  category: z.string().min(1),
  tiers: z.record(z.string(), TierBriefSchema),
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
  materials: z.array(z.string()).default([]),
  colors: z.array(z.string()).default([]),
  category: z.string().default("unknown"),
  description: z.string().nullable().default(null),
  image_url: z.string().nullable().default(null),
  lifestyle_image_url: z.string().nullable().optional().default(null),
  visual_style_tags: z.array(z.string()).optional().default([]),
  available_variants: z.array(z.string()).optional().default([]),
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
