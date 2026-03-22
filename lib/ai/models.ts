/**
 * Model configuration for the AI pipeline.
 * Gemini 3 Flash for fast tasks, Gemini 3.1 Pro for deep analysis,
 * Gemini 3.1 Flash Image for image generation.
 */

export const MODELS = {
  /** Fast model for extraction, normalization, search briefs */
  fast: "gemini-3-flash-preview",
  /** Primary analysis model for diagnosis, scoring, evaluation, validation */
  primary: "gemini-3.1-pro-preview",
  /** Image generation model */
  image: "gemini-3.1-flash-image-preview",
} as const;

export type ModelTier = keyof typeof MODELS;

/** Select appropriate model based on task complexity */
export function selectModel(
  task:
    | "diagnosis"
    | "apartment_analysis"
    | "area_analysis"
    | "extraction"
    | "scoring"
    | "bundle"
    | "search_brief"
    | "mockup_prompt"
    | "validation"
    | "apartment_research"
    | "image_generation"
    | "search"
): string {
  switch (task) {
    case "diagnosis":
    case "apartment_analysis":
    case "area_analysis":
    case "scoring":
    case "bundle":
    case "validation":
    case "apartment_research":
      return MODELS.primary;
    case "image_generation":
      return MODELS.image;
    case "extraction":
    case "search_brief":
    case "mockup_prompt":
    case "search":
      return MODELS.fast;
    default:
      return MODELS.fast;
  }
}
