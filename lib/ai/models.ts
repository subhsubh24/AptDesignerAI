/**
 * Model configuration for the AI pipeline.
 * Uses Gemini 3.1 Flash Lite for all tasks — fastest and cheapest model
 * ($0.25/1M input, $1.50/1M output) with full tool support
 * (googleSearch, urlContext, responseMimeType, 1M context, 64K output).
 *
 * Note: gemini-3-flash-preview (the old Flash) was unreliable.
 * gemini-3.1-flash-lite-preview is a newer, different model.
 */

export const MODELS = {
  /** Primary model for all pipeline tasks */
  primary: "gemini-3.1-flash-lite-preview",
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
