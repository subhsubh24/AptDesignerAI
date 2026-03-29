/**
 * Model configuration for the AI pipeline.
 *
 * All tasks use Gemini 3.1 Flash Lite for cost efficiency.
 * Prompts are heavily reinforced with chain-of-thought instructions,
 * concrete examples, and explicit checklists to compensate for
 * the lighter model's shallower reasoning.
 */

export const MODELS = {
  /** Primary model for all tasks */
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
