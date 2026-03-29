/**
 * Model configuration for the AI pipeline.
 *
 * Tiered strategy:
 * - Flash Lite ($0.25/$1.50 per 1M) for high-volume, simpler tasks:
 *   search, extraction, quick scoring, quick screening, search briefs, mockups
 * - Flash ($0.50/$3.00 per 1M) for complex reasoning tasks:
 *   area analysis, deep product scoring, bundle evaluation, validation, diagnosis
 *
 * Flash Lite's thinking is too shallow for design analysis (1300-1800 tokens
 * even on "high"), leading to low validation confidence and mixed-up context.
 * Regular Flash provides deeper reasoning at only 2x the cost.
 */

export const MODELS = {
  /** Fast/cheap model for high-volume tasks */
  fast: "gemini-3.1-flash-lite-preview",
  /** Reasoning model for complex analysis tasks */
  reasoning: "gemini-3-flash-preview",
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
  switch (task) {
    // Complex reasoning tasks → Flash (deeper thinking)
    case "area_analysis":
    case "scoring":
    case "bundle":
    case "validation":
    case "diagnosis":
    case "apartment_analysis":
      return MODELS.reasoning;

    // Image generation
    case "image_generation":
      return MODELS.image;

    // Everything else → Flash Lite (fast & cheap)
    case "extraction":
    case "search_brief":
    case "search":
    case "quick_score":
    case "quick_screen":
    case "mockup_prompt":
    case "apartment_research":
    default:
      return MODELS.fast;
  }
}
