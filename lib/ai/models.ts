/**
 * Model configuration for the AI pipeline.
 *
 * Single-model, tiered-thinking strategy:
 * - Every text task uses `gemini-3.1-flash-lite-preview` — the cheapest
 *   Gemini 3 model ($0.10 / $0.40 per 1M tokens in/out).
 * - Quality comes from `thinkingLevel`. Flash Lite defaults to LOW (near-zero
 *   thinking tokens); on HIGH it reasons deeper than Flash at LOW for
 *   complex analysis — at a fraction of the cost of Flash.
 *
 * Callsites should pair `selectModel(task)` with `selectThinkingLevel(task)`
 * to get the right (model, thinkingLevel) combination for their task tier.
 */

export const MODELS = {
  /** Unified text model — thinking level controls quality/cost tradeoff. */
  text: "gemini-3.1-flash-lite-preview",
  /** Image generation model. */
  image: "gemini-3.1-flash-image-preview",
} as const;

// Kept as aliases so no-argument lookups still work. Both point to the same
// text model now; thinking level is what differentiates tiers.
export const LEGACY_MODEL_ALIASES = {
  fast: MODELS.text,
  reasoning: MODELS.text,
  image: MODELS.image,
} as const;

export type ThinkingLevel = "minimal" | "low" | "medium" | "high";

export type TaskType =
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
  | "quick_screen";

/**
 * Task → thinking level.
 *
 * "high" — tasks that were previously on Flash for deep reasoning. On Flash
 *          Lite with high thinking, quality matches Flash-low at lower cost.
 * "low"  — high-volume utility tasks (extraction, simple classification).
 *          Keeps token cost and latency minimal.
 */
export function selectThinkingLevel(task: TaskType): ThinkingLevel {
  switch (task) {
    // Complex reasoning — use deep thinking.
    case "diagnosis":
    case "apartment_analysis":
    case "area_analysis":
    case "scoring":
    case "bundle":
    case "validation":
      return "high";

    // Image generation has no thinking knob; value is ignored downstream.
    case "image_generation":
      return "low";

    // Lightweight tasks — minimal thinking keeps them fast and cheap.
    case "extraction":
    case "search_brief":
    case "search":
    case "quick_score":
    case "quick_screen":
    case "mockup_prompt":
    case "apartment_research":
    default:
      return "low";
  }
}

/** Select appropriate model for a task. All text tasks share one model. */
export function selectModel(task: TaskType): string {
  if (task === "image_generation") return MODELS.image;
  return MODELS.text;
}

/** Convenience: pick (model, thinkingConfig) together. */
export function selectModelConfig(task: TaskType): {
  model: string;
  thinkingConfig: { thinkingLevel: ThinkingLevel };
} {
  return {
    model: selectModel(task),
    thinkingConfig: { thinkingLevel: selectThinkingLevel(task) },
  };
}
