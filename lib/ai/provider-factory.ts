/**
 * Provider routing — decides whether a task runs on Gemini or DeepSeek.
 *
 * Default: AI_PROVIDER=gemini (no behavior change).
 * When AI_PROVIDER=deepseek, text-only tasks route to DeepSeek V4 Flash.
 * Vision tasks, image generation, computer use, and Gemini-exclusive tools
 * always stay on Gemini regardless of the setting.
 */

import { geminiProvider } from "@/lib/ai/gemini";
import type { AIProvider, GeminiTool } from "@/lib/ai/provider";
import type { TaskType } from "@/lib/ai/models";

const GEMINI_ONLY_TASKS: Set<TaskType> = new Set([
  "mockup_image",
  "mockup_image_fast",
  "image_generation",
  "computer_use",
]);

function hasGeminiOnlyTool(tools?: GeminiTool[]): boolean {
  if (!tools) return false;
  return tools.some((t) => {
    const entry = t as Record<string, unknown>;
    return (
      "googleSearch" in entry ||
      "urlContext" in entry ||
      "googleMaps" in entry ||
      "computerUse" in entry ||
      "codeExecution" in entry
    );
  });
}

let _deepseek: AIProvider | null = null;
function getDeepSeek(): AIProvider {
  if (!_deepseek) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _deepseek = require("@/lib/ai/deepseek").deepseekProvider;
  }
  return _deepseek!;
}

export function getProvider(task: TaskType, tools?: GeminiTool[]): AIProvider {
  const setting = process.env.AI_PROVIDER || "deepseek";
  if (setting === "gemini") return geminiProvider;
  if (GEMINI_ONLY_TASKS.has(task)) return geminiProvider;
  if (hasGeminiOnlyTool(tools)) return geminiProvider;
  return getDeepSeek();
}
