/**
 * Model configuration for the AI pipeline.
 * All pipeline tasks use Gemini 3.1 Pro for reliability.
 * Flash was too unreliable (400 errors with urlContext, JSON truncation,
 * token limit exceeded, intermittent 500s).
 */

export const MODELS = {
  /** Primary model for all pipeline tasks */
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
    | "quick_score"
    | "quick_screen"
): string {
  if (task === "image_generation") {
    return MODELS.image;
  }
  return MODELS.primary;
}
