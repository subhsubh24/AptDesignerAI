/**
 * Model configuration for the AI pipeline.
 *
 * TEXT_TIERS defines a cost ladder: base (cheapest) → mid → ceiling (strongest).
 * The default floor is base + task-appropriate thinking level. The escalation
 * ladder (lib/agents/escalation-ladder.ts) steps up only when a deterministic
 * verifier rejects the cheap output. Reasoning-heavy tasks (understanding,
 * diagnosis, design-direction) keep HIGH thinking regardless of tier.
 */

export const TEXT_TIERS = {
  base: "gemini-2.5-flash-lite",
  mid: "gemini-3.1-flash-lite",
  ceiling: process.env.TEXT_CEILING_MODEL || "gemini-3.5-flash",
} as const;

export type TextTier = keyof typeof TEXT_TIERS;

export type ThinkingTier = "minimal" | "low" | "medium" | "high";

export const DEFAULT_THINKING: Partial<Record<TaskType, ThinkingTier>> = {
  apartment_analysis: "high",
  area_analysis: "high",
  diagnosis: "high",
  validation: "low",
  scoring: "low",
  bundle: "low",
  apartment_research: "low",
  extraction: "minimal",
  quick_score: "minimal",
  quick_screen: "minimal",
  search: "minimal",
  search_brief: "low",
  mockup_prompt: "low",
};

export function defaultThinking(task: TaskType): ThinkingTier {
  return DEFAULT_THINKING[task] ?? "low";
}

export function selectModelTier(task: TaskType, tier: TextTier): string {
  if (task === "mockup_image") return MODELS.imagePro;
  if (task === "mockup_image_fast" || task === "image_generation") return MODELS.image;
  if (task === "computer_use") return process.env.COMPUTER_USE_MODEL || MODELS.computerUse;
  return TEXT_TIERS[tier];
}

export const MODELS = {
  /** Unified text model for every non-image task. */
  text: "gemini-3.1-flash-lite",
  /**
   * Nano Banana 2 — Gemini 3.1 Flash Image (GA).
   * High-efficiency image generation: fast, high-volume, supports 4K,
   * image search grounding, up to 14 reference images. thinkingLevel can
   * be set to "high" to match Pro quality at lower cost.
   */
  image: "gemini-3.1-flash-image",
  /**
   * Nano Banana Pro — Gemini 3 Pro Image (GA).
   * Professional asset production: thinking always on (can't disable),
   * generates up to 4K, best for complex instructions, multi-reference
   * composition, and interior design mockups where quality is paramount.
   * Use for final-quality room mockups shown to users.
   */
  imagePro: "gemini-3-pro-image",
  /**
   * Computer Use (browser-control agent). As of 2026-06-24, computer use is a
   * BUILT-IN TOOL in Gemini 3.5 Flash (GA) — no separate preview model needed.
   * Uses the same gemini-3.5-flash model as TEXT_TIERS.ceiling with the
   * `computerUse: { environment: "ENVIRONMENT_BROWSER" }` tool declaration.
   * Includes built-in prompt-injection safety (confirm-on-sensitive, auto-stop).
   * The env override COMPUTER_USE_MODEL lets ops pin to a specific revision.
   */
  computerUse: "gemini-3.5-flash",
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

/** Route a task to the right model. Defaults to the cheapest text tier.
 *  Tasks that need HIGH thinking get the mid tier (flash-lite doesn't support thinking). */
export function isBaseTier(model: string): boolean {
  return model === TEXT_TIERS.base;
}

export function selectModel(task: TaskType): string {
  if (task === "mockup_image") return MODELS.imagePro;
  if (task === "mockup_image_fast" || task === "image_generation") return MODELS.image;
  if (task === "computer_use") {
    return process.env.COMPUTER_USE_MODEL || MODELS.computerUse;
  }
  const thinking = DEFAULT_THINKING[task];
  if (thinking === "high" || thinking === "medium") return TEXT_TIERS.mid;
  return TEXT_TIERS.base;
}
