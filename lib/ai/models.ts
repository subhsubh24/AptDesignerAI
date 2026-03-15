/**
 * Model configuration for the AI pipeline.
 * Sonnet 4.6 for all analysis. Haiku for lightweight extraction.
 */

export const MODELS = {
  /** Fast model for extraction, normalization */
  fast: "claude-haiku-4-5-20251001",
  /** Primary analysis model for diagnosis, scoring, evaluation */
  primary: "claude-sonnet-4-6",
} as const;

export type ModelTier = keyof typeof MODELS;

/** Select appropriate model based on task complexity */
export function selectModel(task: "diagnosis" | "apartment_analysis" | "area_analysis" | "extraction" | "scoring" | "bundle" | "search_brief" | "mockup_prompt"): string {
  switch (task) {
    case "diagnosis":
    case "apartment_analysis":
    case "area_analysis":
    case "scoring":
    case "bundle":
      return MODELS.primary;
    case "extraction":
    case "search_brief":
    case "mockup_prompt":
      return MODELS.fast;
    default:
      return MODELS.fast;
  }
}
