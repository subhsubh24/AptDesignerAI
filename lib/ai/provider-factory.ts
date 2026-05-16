/**
 * Provider routing — decides whether a task runs on Gemini or DeepSeek.
 *
 * Default: AI_PROVIDER=deepseek — text-only tasks route to DeepSeek V4 Flash.
 * Set AI_PROVIDER=gemini to force all agents onto Gemini.
 *
 * Vision tasks, image generation, computer use, and Gemini-exclusive tools
 * always stay on Gemini regardless of the setting.
 *
 * Resilience: DeepSeek calls automatically fall back to Gemini if DeepSeek is
 * unreachable for account reasons (missing/invalid key, insufficient balance,
 * forbidden). The first such failure latches a process-wide flag so the rest
 * of the run goes straight to Gemini instead of wasting a round-trip per call.
 */

import { geminiProvider } from "@/lib/ai/gemini";
import { createLogger } from "@/lib/logging/logger";
import type { AIProvider, GeminiTool } from "@/lib/ai/provider";
import type { TaskType } from "@/lib/ai/models";

const log = createLogger("provider-factory");

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

/**
 * Latched once DeepSeek returns an account-level error. A missing balance or
 * bad key won't fix itself mid-run, so we stop retrying DeepSeek and route
 * everything to Gemini for the rest of the process.
 */
let deepseekDisabledForProcess = false;

/** HTTP statuses that mean "DeepSeek will keep failing — switch to Gemini". */
function isAccountError(err: unknown): boolean {
  const status = (err as { status?: number } | undefined)?.status;
  return status === 401 || status === 402 || status === 403;
}

let _deepseekWithFallback: AIProvider | null = null;
function getDeepSeekWithFallback(): AIProvider {
  if (!_deepseekWithFallback) {
    _deepseekWithFallback = {
      async chat(params) {
        if (deepseekDisabledForProcess) {
          return geminiProvider.chat(params);
        }
        try {
          return await getDeepSeek().chat(params);
        } catch (err) {
          if (isAccountError(err)) {
            deepseekDisabledForProcess = true;
            log.warn(
              "DeepSeek unavailable (account error) — falling back to Gemini for the rest of this process",
              { error: err instanceof Error ? err.message.slice(0, 200) : String(err) },
            );
            return geminiProvider.chat(params);
          }
          throw err;
        }
      },
    };
  }
  return _deepseekWithFallback;
}

export function getProvider(task: TaskType, tools?: GeminiTool[]): AIProvider {
  const setting = process.env.AI_PROVIDER || "deepseek";
  if (setting === "gemini") return geminiProvider;
  if (GEMINI_ONLY_TASKS.has(task)) return geminiProvider;
  if (hasGeminiOnlyTool(tools)) return geminiProvider;
  return getDeepSeekWithFallback();
}
