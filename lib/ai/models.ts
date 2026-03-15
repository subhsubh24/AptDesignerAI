/**
 * Model configuration for the AI pipeline.
 * GPT-4.1 for all analysis. GPT-4.1-mini for lightweight extraction.
 */

export const MODELS = {
  /** Fast model for extraction, normalization */
  fast: "gpt-4.1-mini",
  /** Primary analysis model for diagnosis, scoring, evaluation */
  primary: "gpt-4.1",
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
