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
  /**
   * Nano Banana 2 — Gemini 3.1 Flash Image Preview.
   * High-efficiency image generation: fast, high-volume, supports 4K,
   * image search grounding, up to 14 reference images. thinkingLevel can
   * be set to "high" to match Pro quality at lower cost.
   */
  image: "gemini-3.1-flash-image-preview",
  /**
   * Nano Banana Pro — Gemini 3 Pro Image Preview.
   * Professional asset production: thinking always on (can't disable),
   * generates up to 4K, best for complex instructions, multi-reference
   * composition, and interior design mockups where quality is paramount.
   * Use for final-quality room mockups shown to users.
   */
  imagePro: "gemini-3-pro-image-preview",
  /**
   * Computer Use (browser-control agent). Preview-only — supports a subset
   * of models distinct from the regular text model. The env override
   * COMPUTER_USE_MODEL lets ops swap to gemini-3-flash-preview if Google
   * moves the feature there.
   */
  computerUse: "gemini-2.5-computer-use-preview-10-2025",
} as const;

export const DEEPSEEK_MODELS = {
  text: "deepseek-v4-flash",
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
  | "mockup_image"        // Nano Banana Pro — final-quality room mockups
  | "mockup_image_fast"   // Nano Banana 2 — quick previews / thumbnail renders
  | "validation"
  | "apartment_research"
  | "image_generation"
  | "search"
  | "quick_score"
  | "quick_screen"
  | "computer_use";

/** Route a task to the right model. Text tasks all share one model. */
export function selectModel(task: TaskType): string {
  // Final-quality room mockup — use Nano Banana Pro (thinking always on)
  if (task === "mockup_image") return MODELS.imagePro;
  // Quick preview / thumbnail — use Nano Banana 2 (faster, cheaper)
  if (task === "mockup_image_fast" || task === "image_generation") return MODELS.image;
  if (task === "computer_use") {
    return process.env.COMPUTER_USE_MODEL || MODELS.computerUse;
  }
  return MODELS.text;
}
