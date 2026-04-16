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
import { selectModelConfig, type ThinkingLevel } from "@/lib/ai/models";
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
import {
  CRITIQUE_SYSTEM_PROMPT,
  MAX_REFINEMENTS,
  buildCritiquePrompt,
} from "@/lib/prompts/greedy-decorator-critique-prompt";
import type { AdaptiveCapContext } from "@/lib/validation/saturation-math";
import type { ActionItem, DesignDirection } from "@/lib/types/database";

const log = createLogger("greedy-decorator");

// ─── Types ────────────────────────────────────────────────────────────────────

/** Per-room budget the expansion should respect. */
export interface ExpansionBudget {
  /** Total dollars available for this room, if known. */
  totalDollars?: number | null;
  /** Budget tier name (e.g. "budget" | "balanced" | "best_possible"). */
  mode?: string | null;
  /**
   * Approximate dollars already "committed" by the existing action_list.
   * Callers can pass a rough estimate (e.g. mid-point of each item's tier);
   * the LLM uses it as guidance, not a hard constraint.
   */
  committedDollars?: number | null;
}

/** Summary of a sibling room used to keep expansion cross-room coherent. */
export interface SiblingRoomSummary {
  roomType: string;
  /** 3-8 materials the sibling room already leans on. */
  materials?: string[];
  /** 3-8 accent colors / palette entries the sibling room commits to. */
  palette?: string[];
  /** Top categories the sibling already has (to avoid redundant textures). */
  topCategories?: string[];
  /** Free-form style notes from the sibling's design direction. */
  styleNotes?: string;
}

export interface ExpansionContext {
  currentItems: ActionItem[];
  room: { type: string; sqft?: number };
  designDirection?: DesignDirection | null;
  /** Room photo URLs — passed to the LLM for visual context */
  roomPhotos?: string[];
  /** Maximum number of expansion iterations (default 20) */
  maxIterations?: number;
  /** Budget context — shown to the LLM so it avoids recommending items that blow the cap. */
  budget?: ExpansionBudget | null;
  /** Sibling rooms in the same apartment — used to keep material / palette coherent across rooms. */
  siblingRooms?: SiblingRoomSummary[] | null;
  /**
   * Preference signals inferred from sibling rooms (keep/replace patterns,
   * recurring materials + palette, density tendency). Soft prompt context.
   */
  preferences?: import("@/lib/design-context/infer-preferences").PreferenceSignals | null;
  /**
   * Adaptive saturation cap signals (e.g. Pass A density observation, inferred
   * user density preference). When provided, tightens or loosens caps before
   * the loop starts. See lib/validation/saturation-math.ts.
   */
  adaptiveCaps?: AdaptiveCapContext | null;
  /**
   * Run a final holistic critique pass after the greedy loop to catch
   * combinatorial wins (styling batches, swaps, consolidations) that
   * one-item-at-a-time can't see. Defaults to true when at least 2 items
   * were added by expansion.
   */
  runCritique?: boolean;
}

export type StopReason =
  | "llm_stop"
  | "llm_cluttered"
  | "hard_cap_exhausted"
  | "consecutive_rejections"
  | "max_iterations";

export interface DecoratorDecision {
  iteration: number;
  verdict: "ADD" | "STOP" | "GUARDRAIL_REJECTED" | "CRITIQUE_ADD" | "CRITIQUE_SWAP" | "CRITIQUE_REMOVE";
  item?: Partial<ActionItem & { variant?: string; quantity?: number }>;
  reasoning: string;
  density_feel: string;
  /** Ratio of current total_items to hard_cap at the time of decision */
  saturation_pct: number;
  /** For SWAP/REMOVE: the index (in items array) that was targeted. */
  target_index?: number;
}

export interface ExpansionResult {
  expanded_items: ActionItem[];
  added_count: number;
  stop_reason: StopReason;
  decision_log: DecoratorDecision[];
  /** Number of refinements applied during the critique pass (0 if skipped). */
  critique_refinements?: number;
  /** The LLM's overall read of the final list (empty if critique skipped). */
  critique_note?: string;
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
  const { model, thinkingConfig } = selectModelConfig("diagnosis"); // same tier as Pass 2 — thoughtful reasoning

  let items: Array<ActionItem & { variant?: string; quantity?: number; source?: string }> =
    ctx.currentItems.map(i => ({ ...i, source: "diagnosis" as const }));
  const originalCount = items.length;

  let profile: SaturationProfile = initializeSaturation(
    items,
    ctx.room,
    ctx.designDirection,
    ctx.adaptiveCaps ?? undefined,
  );

  const decisions: DecoratorDecision[] = [];
  let consecutiveRejections = 0;
  let stopReason: StopReason | null = null;

  for (let i = 0; i < maxIterations; i++) {
    // Build prompt
    const promptCtx: ExpansionPromptContext = {
      roomType: ctx.room.type,
      sqft: ctx.room.sqft,
      designDirection: ctx.designDirection,
      currentItems: items,
      saturation: profile,
      budget: ctx.budget,
      siblingRooms: ctx.siblingRooms,
      preferences: ctx.preferences,
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
        thinkingConfig,
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
      stopReason = parsed.density_feel === "cluttered" ? "llm_cluttered" : "llm_stop";
      break;
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
          thinkingConfig,
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
          stopReason = "consecutive_rejections";
          break;
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

  // Fall-through: reached maxIterations or all caps hit
  if (stopReason === null) {
    stopReason =
      profile.total_items.current >= profile.total_items.hard_cap
        ? "hard_cap_exhausted"
        : "max_iterations";
  }

  log.info("Greedy expansion loop complete", {
    added: items.length - originalCount,
    total: items.length,
    stopReason,
  });

  // ─── Optional critique pass ──────────────────────────────────────────────
  // Runs once after the greedy loop to catch combinatorial wins (styling
  // batches, swaps, consolidations) that single-item-at-a-time can't see.
  // Skipped automatically when fewer than 2 items were added — there's not
  // enough material for a critique to help.
  let critiqueRefinements = 0;
  let critiqueNote = "";
  const addedCount = items.length - originalCount;
  const shouldRunCritique = (ctx.runCritique ?? true) && addedCount >= 2;

  if (shouldRunCritique) {
    try {
      const critiqueOutcome = await runCritiquePass({
        items,
        originalCount,
        profile,
        ctx,
        model,
        thinkingConfig,
      });
      items = critiqueOutcome.items;
      profile = critiqueOutcome.profile;
      for (const d of critiqueOutcome.decisions) decisions.push(d);
      critiqueRefinements = critiqueOutcome.refinementsApplied;
      critiqueNote = critiqueOutcome.overallNote;
    } catch (err) {
      log.warn("Critique pass failed — returning greedy result unchanged", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    expanded_items: items,
    added_count: items.length - originalCount,
    stop_reason: stopReason,
    decision_log: decisions,
    critique_refinements: critiqueRefinements,
    critique_note: critiqueNote,
  };
}

// ─── Critique pass ───────────────────────────────────────────────────────────

interface LLMCritiqueResponse {
  overall_note?: string;
  refinements?: Array<{
    op?: string;
    index?: number;
    item?: {
      category?: string;
      action?: string;
      variant?: string | null;
      quantity?: number | null;
      priority?: number;
      reasoning?: string;
    };
    reason?: string;
  }>;
}

function parseCritiqueResponse(raw: string): LLMCritiqueResponse | null {
  try {
    const obj = extractJsonObject(raw) as LLMCritiqueResponse;
    if (!obj || typeof obj !== "object") return null;
    return obj;
  } catch {
    return null;
  }
}

interface CritiqueOutcome {
  items: Array<ActionItem & { variant?: string; quantity?: number; source?: string }>;
  profile: SaturationProfile;
  decisions: DecoratorDecision[];
  refinementsApplied: number;
  overallNote: string;
}

async function runCritiquePass(args: {
  items: Array<ActionItem & { variant?: string; quantity?: number; source?: string }>;
  originalCount: number;
  profile: SaturationProfile;
  ctx: ExpansionContext;
  model: string;
  thinkingConfig: { thinkingLevel: ThinkingLevel };
}): Promise<CritiqueOutcome> {
  const { originalCount, ctx, model, thinkingConfig } = args;
  let items = args.items;
  let profile = args.profile;
  const decisions: DecoratorDecision[] = [];

  // Items added by expansion = indices >= originalCount in the current list
  const expansionIndices = items
    .map((_, i) => i)
    .filter((i) => i >= originalCount);

  const critiquePrompt = buildCritiquePrompt({
    roomType: ctx.room.type,
    sqft: ctx.room.sqft,
    designDirection: ctx.designDirection,
    items,
    saturation: profile,
    expansionItemIndices: expansionIndices,
  });

  const content = ctx.roomPhotos?.length
    ? [
        ...ctx.roomPhotos.map((url) => ({
          type: "image" as const,
          source: { type: "url" as const, url },
        })),
        { type: "text" as const, text: critiquePrompt },
      ]
    : [{ type: "text" as const, text: critiquePrompt }];

  let response: { content: string };
  try {
    response = await geminiProvider.chat({
      model,
      thinkingConfig,
      system: CRITIQUE_SYSTEM_PROMPT,
      messages: [{ role: "user", content }],
      max_tokens: 2000,
    });
  } catch (err) {
    log.warn("Critique LLM call failed", { error: String(err) });
    return { items, profile, decisions, refinementsApplied: 0, overallNote: "" };
  }

  const parsed = parseCritiqueResponse(response.content);
  if (!parsed) {
    log.warn("Critique: unparseable LLM response");
    return { items, profile, decisions, refinementsApplied: 0, overallNote: "" };
  }

  const overallNote = (parsed.overall_note ?? "").slice(0, 400);
  const refs = Array.isArray(parsed.refinements) ? parsed.refinements.slice(0, MAX_REFINEMENTS) : [];

  let applied = 0;
  for (const ref of refs) {
    const op = (ref.op ?? "").toUpperCase();

    // REMOVE or SWAP target an existing item — only expansion items may be touched
    const targetIdx = typeof ref.index === "number" ? ref.index : -1;
    const isExpansionIndex = targetIdx >= originalCount && targetIdx < items.length;

    if (op === "REMOVE") {
      if (!isExpansionIndex) {
        log.debug("Critique: REMOVE skipped — target is not an expansion item", { targetIdx });
        continue;
      }
      const removed = items[targetIdx];
      items = [...items.slice(0, targetIdx), ...items.slice(targetIdx + 1)];
      // Rebuild the profile from scratch — cleaner than tracking per-item deltas.
      profile = initializeSaturation(items, ctx.room, ctx.designDirection, ctx.adaptiveCaps ?? undefined);
      decisions.push({
        iteration: -1,
        verdict: "CRITIQUE_REMOVE",
        item: removed,
        reasoning: ref.reason ?? "Removed as overlapping or off-style",
        density_feel: "refined",
        saturation_pct: profile.total_items.current / profile.total_items.hard_cap,
        target_index: targetIdx,
      });
      applied += 1;
      continue;
    }

    if (op === "SWAP") {
      if (!isExpansionIndex || !ref.item?.category) {
        log.debug("Critique: SWAP skipped — invalid target or missing item", { targetIdx });
        continue;
      }
      const newItem = {
        ...buildActionItem(ref.item),
        source: "expansion" as const,
      };
      // Check guardrails against a profile where the current item at targetIdx is removed
      const withoutTarget = [...items.slice(0, targetIdx), ...items.slice(targetIdx + 1)];
      const probeProfile = initializeSaturation(withoutTarget, ctx.room, ctx.designDirection, ctx.adaptiveCaps ?? undefined);
      const rejection = wouldExceedHardCap(probeProfile, { category: newItem.category, action: newItem.action });
      if (rejection) {
        log.debug("Critique: SWAP blocked by guardrail", { rejection });
        continue;
      }
      items = [...withoutTarget, newItem];
      profile = initializeSaturation(items, ctx.room, ctx.designDirection, ctx.adaptiveCaps ?? undefined);
      decisions.push({
        iteration: -1,
        verdict: "CRITIQUE_SWAP",
        item: newItem,
        reasoning: ref.reason ?? "Swapped for better cohesion",
        density_feel: "refined",
        saturation_pct: profile.total_items.current / profile.total_items.hard_cap,
        target_index: targetIdx,
      });
      applied += 1;
      continue;
    }

    if (op === "ADD") {
      if (!ref.item?.category) continue;
      const newItem = {
        ...buildActionItem(ref.item),
        source: "expansion" as const,
      };
      const rejection = wouldExceedHardCap(profile, { category: newItem.category, action: newItem.action });
      if (rejection) {
        log.debug("Critique: ADD blocked by guardrail", { rejection });
        continue;
      }
      items = [...items, newItem];
      profile = updateSaturation(profile, newItem);
      decisions.push({
        iteration: -1,
        verdict: "CRITIQUE_ADD",
        item: newItem,
        reasoning: ref.reason ?? "Added to complete a styling batch",
        density_feel: "refined",
        saturation_pct: profile.total_items.current / profile.total_items.hard_cap,
      });
      applied += 1;
      continue;
    }
  }

  log.info("Critique pass complete", {
    refinementsApplied: applied,
    proposed: refs.length,
    finalCount: items.length,
  });

  return { items, profile, decisions, refinementsApplied: applied, overallNote };
}
