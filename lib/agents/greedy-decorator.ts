// Greedy design expansion agent.
//
// Runs AFTER runRoomDiagnosis() produces the initial action_list. Iteratively
// asks an LLM to envision the room and add one more finishing item, stopping
// when the LLM declares the room complete or math guardrails exhaust all
// categories.
//
// Insertion point: app/api/diagnosis/route.ts, after the initial save.
// No changes required to the product search pipeline — it just sees a larger
// action_list with more entries.

import { geminiProvider } from "@/lib/ai/gemini";
import { selectModel } from "@/lib/ai/models";
import { extractJsonObject } from "@/lib/ai/extract-json";
import { createLogger } from "@/lib/logging/logger";
import {
  initializeSaturation,
  updateSaturation,
  wouldExceedHardCap,
  type SaturationProfile,
} from "@/lib/validation/saturation-math";
import {
  EXPANSION_SYSTEM_PROMPT,
  buildExpansionPrompt,
  buildRetryPrompt,
  type ExpansionPromptContext,
} from "@/lib/prompts/greedy-decorator-prompt";
import type { ActionItem, DesignDirection } from "@/lib/types/database";

const log = createLogger("greedy-decorator");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ExpansionContext {
  currentItems: ActionItem[];
  room: { type: string; sqft?: number };
  designDirection?: DesignDirection | null;
  /** Room photo URLs — passed to the LLM for visual context */
  roomPhotos?: string[];
  /** Maximum number of expansion iterations (default 20) */
  maxIterations?: number;
}

export type StopReason =
  | "llm_stop"
  | "llm_cluttered"
  | "hard_cap_exhausted"
  | "consecutive_rejections"
  | "max_iterations";

export interface DecoratorDecision {
  iteration: number;
  verdict: "ADD" | "STOP" | "GUARDRAIL_REJECTED";
  item?: Partial<ActionItem & { variant?: string; quantity?: number }>;
  reasoning: string;
  density_feel: string;
  /** Ratio of current total_items to hard_cap at the time of decision */
  saturation_pct: number;
}

export interface ExpansionResult {
  expanded_items: ActionItem[];
  added_count: number;
  stop_reason: StopReason;
  decision_log: DecoratorDecision[];
}

// ─── JSON response schema ─────────────────────────────────────────────────────

interface LLMExpansionResponse {
  verdict: "ADD" | "STOP";
  item?: {
    category?: string;
    action?: string;
    variant?: string | null;
    quantity?: number | null;
    priority?: number;
    reasoning?: string;
  };
  density_feel?: string;
  overall_reasoning?: string;
}

function parseExpansionResponse(raw: string): LLMExpansionResponse | null {
  try {
    const obj = extractJsonObject(raw) as LLMExpansionResponse;
    if (!obj || typeof obj.verdict !== "string") return null;
    const v = obj.verdict.toUpperCase() as "ADD" | "STOP";
    if (v !== "ADD" && v !== "STOP") return null;
    return { ...obj, verdict: v };
  } catch {
    return null;
  }
}

function buildActionItem(
  llmItem: NonNullable<LLMExpansionResponse["item"]>,
): ActionItem & { variant?: string; quantity?: number } {
  return {
    category: llmItem.category ?? "decorative_objects",
    action: llmItem.action ?? "",
    priority: llmItem.priority ?? 5,
    reasoning: llmItem.reasoning ?? "",
    variant: llmItem.variant ?? undefined,
    quantity: llmItem.quantity ?? undefined,
    // source is set by the caller via object spread after type assertions
  };
}

// ─── Main loop ────────────────────────────────────────────────────────────────

export async function runDiagnosisExpansion(
  ctx: ExpansionContext,
): Promise<ExpansionResult> {
  const maxIterations = ctx.maxIterations ?? 20;
  const model = selectModel("diagnosis"); // same tier as Pass 2 — thoughtful reasoning

  let items: Array<ActionItem & { variant?: string; quantity?: number; source?: string }> =
    ctx.currentItems.map(i => ({ ...i, source: "diagnosis" as const }));
  const originalCount = items.length;

  let profile: SaturationProfile = initializeSaturation(
    items,
    ctx.room,
    ctx.designDirection,
  );

  const decisions: DecoratorDecision[] = [];
  let consecutiveRejections = 0;

  for (let i = 0; i < maxIterations; i++) {
    // Build prompt
    const promptCtx: ExpansionPromptContext = {
      roomType: ctx.room.type,
      sqft: ctx.room.sqft,
      designDirection: ctx.designDirection,
      currentItems: items,
      saturation: profile,
    };

    const promptText = buildExpansionPrompt(promptCtx);

    // Optionally include room photos for visual grounding
    const content = ctx.roomPhotos?.length
      ? [
          ...ctx.roomPhotos.map(url => ({
            type: "image" as const,
            source: { type: "url" as const, url },
          })),
          { type: "text" as const, text: promptText },
        ]
      : [{ type: "text" as const, text: promptText }];

    let parsed: LLMExpansionResponse | null = null;

    // Primary call
    try {
      const response = await geminiProvider.chat({
        model,
        system: EXPANSION_SYSTEM_PROMPT,
        messages: [{ role: "user", content }],
        max_tokens: 1500,
      });
      parsed = parseExpansionResponse(response.content);
    } catch (err) {
      log.warn("Greedy expansion LLM call failed", { iteration: i, error: String(err) });
      break;
    }

    if (!parsed) {
      log.warn("Greedy expansion: unparseable LLM response", { iteration: i });
      consecutiveRejections++;
      if (consecutiveRejections >= 3) break;
      continue;
    }

    // Stop signals
    if (parsed.verdict === "STOP" || parsed.density_feel === "cluttered") {
      decisions.push({
        iteration: i,
        verdict: "STOP",
        reasoning: parsed.item?.reasoning ?? parsed.overall_reasoning ?? "LLM declared room complete",
        density_feel: parsed.density_feel ?? "full",
        saturation_pct: profile.total_items.current / profile.total_items.hard_cap,
      });
      log.info("Greedy expansion: LLM stopped", {
        iteration: i,
        totalItems: items.length,
        densityFeel: parsed.density_feel,
      });
      return {
        expanded_items: items,
        added_count: items.length - originalCount,
        stop_reason: parsed.density_feel === "cluttered" ? "llm_cluttered" : "llm_stop",
        decision_log: decisions,
      };
    }

    if (!parsed.item?.category) {
      log.warn("Greedy expansion: ADD verdict with no item", { iteration: i });
      consecutiveRejections++;
      if (consecutiveRejections >= 3) break;
      continue;
    }

    // Math guardrail check
    const rejection = wouldExceedHardCap(profile, {
      category: parsed.item.category,
      action: parsed.item.action,
    });

    if (rejection) {
      // One retry with rejection context
      const retryCtx: ExpansionPromptContext = { ...promptCtx, lastRejectionReason: rejection };
      const retryPromptText = buildRetryPrompt(retryCtx);
      const retryContent = ctx.roomPhotos?.length
        ? [
            ...ctx.roomPhotos.map(url => ({
              type: "image" as const,
              source: { type: "url" as const, url },
            })),
            { type: "text" as const, text: retryPromptText },
          ]
        : [{ type: "text" as const, text: retryPromptText }];

      let retryParsed: LLMExpansionResponse | null = null;
      try {
        const retryResponse = await geminiProvider.chat({
          model,
          system: EXPANSION_SYSTEM_PROMPT,
          messages: [{ role: "user", content: retryContent }],
          max_tokens: 1500,
        });
        retryParsed = parseExpansionResponse(retryResponse.content);
      } catch {
        retryParsed = null;
      }

      // If retry also fails guardrail or stops
      const retryRejection = retryParsed?.item?.category
        ? wouldExceedHardCap(profile, {
            category: retryParsed.item.category,
            action: retryParsed.item.action,
          })
        : "no valid item returned";

      if (!retryParsed || retryParsed.verdict === "STOP" || retryRejection) {
        decisions.push({
          iteration: i,
          verdict: "GUARDRAIL_REJECTED",
          item: parsed.item as Partial<ActionItem>,
          reasoning: `Blocked: ${rejection}${retryRejection ? ` | Retry also blocked: ${retryRejection}` : ""}`,
          density_feel: parsed.density_feel ?? "unknown",
          saturation_pct: profile.total_items.current / profile.total_items.hard_cap,
        });
        consecutiveRejections++;
        log.debug("Greedy expansion: guardrail rejection", { iteration: i, rejection });
        if (consecutiveRejections >= 3) {
          return {
            expanded_items: items,
            added_count: items.length - originalCount,
            stop_reason: "consecutive_rejections",
            decision_log: decisions,
          };
        }
        continue;
      }

      // Retry succeeded — use retry result
      parsed = retryParsed;
    }

    // Item accepted — append and update saturation
    consecutiveRejections = 0;
    const newItem = {
      ...buildActionItem(parsed.item!),
      source: "expansion" as const,
    };
    items = [...items, newItem];
    profile = updateSaturation(profile, newItem);

    decisions.push({
      iteration: i,
      verdict: "ADD",
      item: newItem,
      reasoning: newItem.reasoning,
      density_feel: parsed.density_feel ?? "unknown",
      saturation_pct: profile.total_items.current / profile.total_items.hard_cap,
    });

    log.debug("Greedy expansion: item added", {
      iteration: i,
      category: newItem.category,
      totalItems: items.length,
      saturationPct: Math.round((profile.total_items.current / profile.total_items.hard_cap) * 100),
    });
  }

  // Reached maxIterations or all caps hit
  const stopReason: StopReason =
    profile.total_items.current >= profile.total_items.hard_cap
      ? "hard_cap_exhausted"
      : "max_iterations";

  log.info("Greedy expansion complete", {
    added: items.length - originalCount,
    total: items.length,
    stopReason,
  });

  return {
    expanded_items: items,
    added_count: items.length - originalCount,
    stop_reason: stopReason,
    decision_log: decisions,
  };
}
