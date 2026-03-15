/**
 * Model configuration for the AI pipeline.
 * Claude 4.5 Haiku for speed, Claude Opus 4.6 for deep analysis.
 */

export const MODELS = {
  /** Fast model for extraction, normalization, quick scoring */
  fast: "claude-haiku-4-5-20251001",
  /** Deep analysis model for diagnosis, complex evaluations, bundle optimization */
  deep: "claude-opus-4-6",
} as const;

export type ModelTier = keyof typeof MODELS;

/** Select appropriate model based on task complexity */
export function selectModel(task: "diagnosis" | "extraction" | "scoring" | "bundle" | "search_brief" | "mockup_prompt"): string {
  switch (task) {
    case "diagnosis":
    case "bundle":
      return MODELS.deep;
    case "extraction":
    case "scoring":
    case "search_brief":
    case "mockup_prompt":
      return MODELS.fast;
    default:
      return MODELS.fast;
  }
}
