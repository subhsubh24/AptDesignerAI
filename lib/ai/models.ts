/**
 * Model configuration for the AI pipeline.
 *
 * We run on a single text model (Gemini 3.1 Flash Lite) plus the image model.
 * Flash Lite at HIGH thinking matches Flash at LOW thinking in quality for our
 * tasks, at a fraction of the cost. HIGH is enforced as the default inside
 * `geminiProvider.chat` so callsites don't have to set it — they just call
 * `selectModel(task)` and get the right model.
 */

export const MODELS = {
  /** Unified text model for every non-image task. */
  text: "gemini-3.1-flash-lite-preview",
  /** Image generation model (Nano Banana 2). */
  image: "gemini-3.1-flash-image-preview",
  /**
   * Computer Use (browser-control agent). Preview-only — supports a subset
   * of models distinct from the regular text model. The env override
   * COMPUTER_USE_MODEL lets ops swap to gemini-3-flash-preview if Google
   * moves the feature there.
   */
  computerUse: "gemini-2.5-computer-use-preview-10-2025",
} as const;

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
  | "quick_screen"
  | "computer_use";

/** Route a task to the right model. Text tasks all share one model. */
export function selectModel(task: TaskType): string {
  if (task === "image_generation") return MODELS.image;
  if (task === "computer_use") {
    return process.env.COMPUTER_USE_MODEL || MODELS.computerUse;
  }
  return MODELS.text;
}
