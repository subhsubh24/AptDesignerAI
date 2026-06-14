/**
 * PostSearchCoordinator — native function-calling agent loop.
 *
 * Runs AFTER the initial search → extract → score phases (which must
 * happen in fixed order to produce candidate products). From there, the
 * coordinator agent decides which post-processing steps to run, in what
 * order, and when to stop.
 *
 * Subjective-domain note: this agent makes ONLY operational decisions —
 * which tool to call next, given OBJECTIVE state signals (product counts,
 * score medians, token budget, coverage gaps, audit alignment). It does
 * NOT judge "good design" — that's delegated to the validators it invokes.
 *
 * Tools available:
 *   - run_validation        — harmony validation, returns flag count
 *   - run_audit             — requirement audit, returns alignment + gaps
 *   - re_search_category    — targeted re-search with new queries
 *   - drop_category         — remove an unreachable category
 *   - run_backfill          — backfill a specific weak (category, tier)
 *   - run_bundle_generation — generate per-tier bundles
 *   - fill_empty_tiers      — fill empty cells from also-considered/adjacent
 *   - finalize              — stop the loop
 *
 * Each tool returns objective metrics (counts, scores, deltas) that the
 * agent uses to plan its next step.
 *
 * The loop has NO artificial turn cap — it runs until the model calls
 * `finalize`, returns text without a tool call (implicit finalize), or
 * the token budget is exhausted by upstream callers. Token budget is
 * the only real ceiling; turns are conceptual.
 *
 * Behind feature flag ENABLE_POST_SEARCH_COORDINATOR. When off, the
 * orchestrator's existing hardcoded post-search flow runs instead.
 */

import { getProvider } from "@/lib/ai/provider-factory";
import { selectModel } from "@/lib/ai/models";
import { getSystemPrompt } from "@/lib/prompts/system";
import { DETERMINISTIC_SEED } from "@/lib/ai/determinism";
import { createLogger } from "@/lib/logging/logger";
import type { AgentResult } from "./types";
import type { AIMessage, AIContentBlock, FunctionDeclaration } from "@/lib/ai/provider";

const log = createLogger("post-search-coordinator");

/**
 * Soft safety limit — only triggers if the loop somehow runs forever
 * without the agent finalizing AND without budget exhaustion. Set high
 * so it's effectively never the binding constraint; budget is.
 */
const SAFETY_TURN_LIMIT = 100;

/**
 * Hard cap on total re_search_category calls per coordinator run.
 * Each re_search invokes a full mini-pipeline (search + extract + score)
 * for a category and takes 3-5 minutes. With agentic latitude, the
 * coordinator can chain several of these and burn 15+ minutes for marginal
 * quality gains. The prompt warns about diminishing returns but the agent
 * doesn't always heed it; this is the enforcement layer.
 */
const MAX_RE_SEARCH_CALLS = 2;

/**
 * Wall-clock budget for the coordinator loop. If exceeded, the coordinator
 * is force-finalized regardless of pending work — search runs that take
 * more than this should converge or accept current state.
 */
const COORDINATOR_WALL_CLOCK_MS = 10 * 60 * 1000;

/** Coordinator decisions — always operational, never subjective design judgments. */
export type CoordinatorTool =
  | "run_validation"
  | "run_audit"
  | "re_search_category"
  | "drop_category"
  | "run_backfill"
  | "run_bundle_generation"
  | "fill_empty_tiers"
  | "finalize";

const COORDINATOR_TOOLS: FunctionDeclaration[] = [
  {
    name: "run_validation",
    description:
      "Run harmony validation on the current product set. Drops products that actively clash (harmony <= 3) and penalizes weak fits. Returns count of flagged products and overall confidence. Cheap (~50K tokens). Run once before bundling — running twice rarely helps.",
    parametersJsonSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "run_audit",
    description:
      "Run the LLM requirement audit. Grades coverage (every category covered), spec adherence (top picks match what_it_needs specs), and diagnosis-solving (set addresses what_is_not_working). Returns alignment 0-10 + concrete gap list. Set with_grounding=true to verify against live retailer data via Google Search (more accurate but ~2x cost). Required before any correction action so you know what to fix.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        with_grounding: {
          type: "boolean",
          description: "Use Google Search to verify spec matches against live retailer data. Default false. Set true on the LAST audit before finalizing to ground decisions in reality.",
        },
      },
    },
  },
  {
    name: "re_search_category",
    description:
      "Run a targeted re-search for one category with NEW queries that you generate. Use when the audit flagged a concrete gap (wrong size, wrong material, missing) AND new queries with specific spec language could plausibly find a better product. Costs 50-100K tokens per call. Don't repeat queries already tried — check the state summary's 'tried_queries'.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        category: { type: "string", description: "category slug to re-search" },
        queries_budget: {
          type: "array",
          items: { type: "string" },
          description: "2-4 new queries for the budget tier. Lead with exact specs from the assessment.",
        },
        queries_balanced: {
          type: "array",
          items: { type: "string" },
          description: "2-4 new queries for the balanced tier.",
        },
        queries_high_end: {
          type: "array",
          items: { type: "string" },
          description: "2-4 new queries for the high-end tier.",
        },
        reason: { type: "string", description: "What gap this re-search addresses (cite the audit issue)" },
      },
      required: ["category", "reason"],
    },
  },
  {
    name: "drop_category",
    description:
      "Remove a category entirely from the result set. Use when the audit shows the category is unreachable within constraints (e.g., no retailer sells the required item in this budget after multiple attempts).",
    parametersJsonSchema: {
      type: "object",
      properties: {
        category: { type: "string" },
        reason: { type: "string" },
      },
      required: ["category", "reason"],
    },
  },
  {
    name: "run_backfill",
    description:
      "Run targeted backfill for ALL weak (category, tier) cells (cells with < 2 strong products). Generates new queries internally and re-extracts/scores. Costs 100-300K tokens. Use when the state summary shows multiple tiers under-covered and you want to fix them in one batch.",
    parametersJsonSchema: { type: "object", properties: {} },
  },
  {
    name: "run_bundle_generation",
    description:
      "Generate per-tier bundles from the current candidate set. Required before finalize — without bundles the user sees no recommendations. Cost depends on candidate count (~150-400K tokens). Run once after validation + corrections are done.",
    parametersJsonSchema: { type: "object", properties: {} },
  },
  {
    name: "fill_empty_tiers",
    description:
      "Fill empty (category, tier) cells in the picks grid by borrowing from also-considered or adjacent tiers. Zero LLM cost. Always safe to run before finalize so the UI grid is complete.",
    parametersJsonSchema: { type: "object", properties: {} },
  },
  {
    name: "finalize",
    description:
      "Stop the coordinator loop and return the current state as the final result. Call this when alignment >= 8 OR when no further action would improve outcomes given remaining budget.",
    parametersJsonSchema: {
      type: "object",
      properties: { reason: { type: "string" } },
      required: ["reason"],
    },
  },
];

/** Objective state summary the coordinator sees each turn. */
export interface CoordinatorState {
  /** Token budget — used / cap / remaining. */
  budgetUsed: number;
  budgetCap: number;
  budgetRemainingPct: number;

  /** Per-category state derived from candidatesByCategory + evaluations. */
  categories: Record<string, {
    productCount: number;
    tiersCovered: string[]; // ["budget", "balanced", "high_end"]
    scoreMedian?: number;
    scoreMin?: number;
    scoreMax?: number;
    topPickTitle?: string;
    topPickPrice?: number;
  }>;

  /** Categories the planner decided we should have. */
  requiredCategories: string[];
  /** Categories that are completely missing from results. */
  missingCategories: string[];
  /** Categories that have been re-searched (and how many times). */
  reSearchCount: Record<string, number>;
  /** Queries already tried per category (so the agent doesn't repeat). */
  triedQueries: Record<string, string[]>;
  /** Categories the agent has dropped. */
  droppedCategories: string[];

  /** Phase completion flags — what's been run already. */
  validationRun: boolean;
  bundlesGenerated: boolean;
  backfillRun: boolean;
  tiersFilledRun: boolean;

  /** Most recent audit result if run. */
  lastAuditAlignment?: number;
  lastAuditCoverage?: number;
  lastAuditDiagnosisSolving?: number;
  lastAuditIssues?: string[];
  lastAuditUsedGrounding?: boolean;
  auditRunCount: number;

  /**
   * Audit alignment over time. Each entry is one audit run.
   * Lets the agent see trends: "stalled at 6.1 for 2 rounds → finalize"
   * vs. "5.2 → 6.4 → 7.1 (improving, keep going)".
   */
  auditHistory?: Array<{ alignment: number; coverage: number; diagnosisSolving: number }>;
}

/** Tool handler — receives args, returns structured result for the agent to reason over. */
export type CoordinatorToolHandler = (
  toolName: CoordinatorTool,
  args: Record<string, unknown>,
) => Promise<{
  status: "ok" | "skipped" | "error";
  message: string;
  metrics?: Record<string, unknown>;
}>;

export interface CoordinatorRunInput {
  roomType: string;
  budgetMode: string;
  state: () => CoordinatorState;
  handle: CoordinatorToolHandler;
  /** Called on each turn so the orchestrator can stream progress. */
  /**
   * Called on each turn so the orchestrator can stream progress.
   * `thoughtSummary` is the agent's reasoning for this turn (when
   * thinking summaries are enabled), useful for showing the user
   * WHY the agent picked this action.
   */
  onTurn?: (turn: number, action: string, status: string, thoughtSummary?: string) => void;
}

export interface CoordinatorRunResult {
  finalized: boolean;
  finalizeReason?: string;
  turns: number;
  tokensUsed: number;
  history: Array<{ turn: number; tool: string; status: string }>;
}

function formatStateForAgent(state: CoordinatorState): string {
  const lines: string[] = [];
  lines.push(`Token budget: ${state.budgetUsed.toLocaleString()}/${state.budgetCap.toLocaleString()} used (${state.budgetRemainingPct.toFixed(0)}% remaining)`);
  lines.push("");

  if (state.lastAuditAlignment !== undefined) {
    lines.push(`Last audit: alignment=${state.lastAuditAlignment.toFixed(1)}/10, coverage=${(state.lastAuditCoverage ?? 0).toFixed(1)}/10, diagnosis_solving=${(state.lastAuditDiagnosisSolving ?? 0).toFixed(1)}/10${state.lastAuditUsedGrounding ? " (grounded)" : ""}`);

    // Audit trend — makes stalled convergence obvious.
    if (state.auditHistory && state.auditHistory.length >= 2) {
      const trend = state.auditHistory.map((a) => a.alignment.toFixed(1)).join(" → ");
      const last = state.auditHistory.length - 1;
      const delta = state.auditHistory[last].alignment - state.auditHistory[last - 1].alignment;
      let verdict: string;
      if (Math.abs(delta) < 0.3) {
        verdict = "STALLED — further re-searches unlikely to help. Finalize unless critical gap remains.";
      } else if (delta < 0) {
        verdict = "REGRESSING — re-searches are making it worse. Finalize with current state.";
      } else if (delta >= 1.0) {
        verdict = "improving strongly — one more round may help";
      } else {
        verdict = "improving — one more round may help";
      }
      lines.push(`Alignment trend: ${trend} (${verdict})`);
    }

    if (state.lastAuditIssues?.length) {
      lines.push("Audit issues:");
      for (const issue of state.lastAuditIssues.slice(0, 8)) {
        lines.push(`  - ${issue}`);
      }
    }
    lines.push("");
  } else {
    lines.push("No audit run yet.");
    lines.push("");
  }

  lines.push("Phases run:");
  lines.push(`  validation: ${state.validationRun ? "yes" : "no"}`);
  lines.push(`  bundles: ${state.bundlesGenerated ? "yes" : "no"}`);
  lines.push(`  backfill: ${state.backfillRun ? "yes" : "no"}`);
  lines.push(`  tiers_filled: ${state.tiersFilledRun ? "yes" : "no"}`);
  lines.push(`  audits run: ${state.auditRunCount}`);
  lines.push("");

  lines.push(`Required categories: ${state.requiredCategories.join(", ") || "(none)"}`);
  if (state.missingCategories.length > 0) {
    lines.push(`MISSING (zero products): ${state.missingCategories.join(", ")}`);
  }
  if (state.droppedCategories.length > 0) {
    lines.push(`Dropped this session: ${state.droppedCategories.join(", ")}`);
  }
  lines.push("");

  // Mark saturated categories (plenty of strong picks) so the agent
  // doesn't waste a re-search on them.
  const SATURATED_COUNT = 3;
  const SATURATED_SCORE = 7.0;
  lines.push("Per-category state (only categories with products):");
  for (const [cat, s] of Object.entries(state.categories)) {
    const parts = [`  [${cat}] count=${s.productCount}`];
    if (s.tiersCovered.length) parts.push(`tiers=${s.tiersCovered.join("/")}`);
    if (s.scoreMedian !== undefined) parts.push(`score median=${s.scoreMedian.toFixed(1)} (range ${s.scoreMin?.toFixed(1)}-${s.scoreMax?.toFixed(1)})`);
    if (s.topPickTitle) parts.push(`top="${s.topPickTitle}"`);
    if (s.topPickPrice) parts.push(`$${s.topPickPrice}`);
    if (state.reSearchCount[cat]) {
      const rs = state.reSearchCount[cat];
      parts.push(rs >= 2 ? `re-searched ${rs}x (diminishing returns — DO NOT re-search again)` : `re-searched ${rs}x`);
    }
    if (s.productCount >= SATURATED_COUNT && (s.scoreMax ?? 0) >= SATURATED_SCORE) {
      parts.push("SATURATED (do not re-search)");
    }
    lines.push(parts.join(" | "));
  }

  if (Object.values(state.triedQueries).some((q) => q.length > 0)) {
    lines.push("");
    lines.push("Queries ALREADY TRIED — using any of these again is wasteful and forbidden:");
    for (const [cat, qs] of Object.entries(state.triedQueries)) {
      if (qs.length > 0) {
        lines.push(`  [${cat}]: ${qs.slice(-8).map((q) => `"${q}"`).join(", ")}`);
      }
    }
  }

  return lines.join("\n");
}

const COORDINATOR_SYSTEM = `You are the post-search coordinator for an interior-design product search pipeline. The pipeline has already completed initial search/extract/score for the requested categories. Your job: decide what to do next based on the OBJECTIVE state signals you observe.

This is a subjective domain (interior design). You do NOT judge "good design" — that's the validators' job. You make OPERATIONAL decisions: which tool to call next, given the data.

Plan around objective signals only:
- Token budget — don't burn budget on actions with diminishing returns
- Audit alignment scores — concrete 0-10 grades
- Coverage gaps — categories with zero or weak products
- Score distributions — median + range per category
- Phase completion — don't re-run phases without a reason

Required outputs before finalize:
1. Bundles must be generated (otherwise user sees nothing)
2. Tiers should be filled (so the picks grid has no empty cells)

Recommended sequence on a typical run:
  audit → (if alignment < 8) re_search_category for top 1-3 weak categories → audit again → run_validation → run_bundle_generation → fill_empty_tiers → finalize

Stop conditions — if ANY of these are true, call finalize:
- alignment >= 8 AND bundles generated AND tiers filled
- budget < 15% remaining
- Alignment trend is STALLED (the state summary labels it explicitly)
- Alignment is REGRESSING (getting worse — stop making it worse)
- Every remaining issue is in a SATURATED or "do not re-search again" category

Re-search guardrails — refuse to re_search_category if ANY of these apply:
- The category is marked SATURATED in the state
- The category has already been re-searched 2+ times (diminishing returns)
- Your planned queries overlap with queries already in "Queries ALREADY TRIED"
- Alignment trend is stalled — re-searching will not help

Avoid:
- Running validation more than once (rare value)
- Calling re_search_category without first running an audit (you have no signal of what's broken)
- Calling finalize before bundles/tiers — the user sees nothing useful
- Running an audit when the trend is already stalled — just finalize

Parallel function calling: when multiple INDEPENDENT actions are needed in the same turn (e.g., re-searching THREE different categories that don't depend on each other), call all of them in parallel in the same turn. Gemini supports parallel function calling — use it when actions are independent, since it cuts iteration latency. Serialize when actions DO depend on each other (e.g., re-search category A → audit → re-search category B based on new audit).

Reason briefly before each call. Be decisive — if the state is good enough, finalize.`;

export async function runPostSearchCoordinator(
  input: CoordinatorRunInput
): Promise<AgentResult<CoordinatorRunResult>> {
  const model = selectModel("validation");
  const system = getSystemPrompt() + "\n\n" + COORDINATOR_SYSTEM;

  let totalTokens = 0;
  const history: Array<{ turn: number; tool: string; status: string }> = [];
  const messages: AIMessage[] = [];

  // Initial user prompt — describe the room + give state summary
  const initialState = input.state();
  const initialPrompt = `Room: ${input.roomType}, budget: ${input.budgetMode}.

## CURRENT PIPELINE STATE
${formatStateForAgent(initialState)}

Decide the next tool to call. Reason briefly first, then call exactly one function.`;

  messages.push({ role: "user", content: initialPrompt });

  let finalized = false;
  let finalizeReason: string | undefined;
  let turn = 0;
  let reSearchCalls = 0;
  const startedAt = Date.now();

  try {
    while (turn < SAFETY_TURN_LIMIT && !finalized) {
      turn++;
      if (Date.now() - startedAt > COORDINATOR_WALL_CLOCK_MS) {
        log.warn("Coordinator hit wall-clock budget — force-finalizing", {
          turn,
          elapsedMs: Date.now() - startedAt,
          budgetMs: COORDINATOR_WALL_CLOCK_MS,
        });
        finalized = true;
        finalizeReason = "Wall-clock budget exceeded — finalizing with current state";
        break;
      }
      let response;
      try {
        const coordinatorTools = [
          { functionDeclarations: COORDINATOR_TOOLS },
        ];
        response = await getProvider("validation", coordinatorTools).chat({
          model,
          system,
          messages,
          max_tokens: 16000,
          seed: DETERMINISTIC_SEED,
          thinkingConfig: { thinkingLevel: "low", includeThoughts: true },
          tools: coordinatorTools,
        });
      } catch (err) {
        log.warn("Coordinator chat call failed — falling back to default flow", {
          turn,
          error: err instanceof Error ? err.message : String(err),
        });
        return { success: false, error: "Coordinator chat failed" };
      }

      const turnTokens =
        (response.usage?.input_tokens ?? 0) +
        (response.usage?.output_tokens ?? 0) +
        (response.usage?.thinking_tokens ?? 0);
      totalTokens += turnTokens;

      const calls = response.functionCalls || [];
      if (calls.length === 0) {
        // Model returned text without calling any tool — treat as implicit finalize
        log.info("Coordinator returned text without function call — finalizing", { turn, content: response.content.slice(0, 200) });
        finalized = true;
        finalizeReason = "No tool call from model — assuming done";
        history.push({ turn, tool: "implicit_finalize", status: "ok" });
        break;
      }

      // Echo the model's response verbatim to preserve thought parts and
      // thoughtSignature values that Gemini 3 mandates on continuations.
      if (response.modelContentParts) {
        messages.push({
          role: "assistant",
          content: [],
          _rawGeminiParts: response.modelContentParts,
        });
      } else {
        const modelParts: AIContentBlock[] = [];
        if (response.content) modelParts.push({ type: "text", text: response.content });
        for (const call of calls) {
          modelParts.push({
            type: "function_call",
            functionCall: {
              id: call.id,
              name: call.name,
              args: call.args,
              thoughtSignature: call.thoughtSignature,
            },
          });
        }
        messages.push({ role: "assistant", content: modelParts });
      }

      // Concatenated thought summary for this turn — surfaced via onTurn
      // so the SSE stream can show the user the agent's reasoning.
      const turnThoughts = response.thoughtSummaries?.join("\n\n");

      // Dispatch each call (Gemini may return parallel calls; we serialize)
      const responseParts: AIContentBlock[] = [];
      for (const call of calls) {
        if (call.name === "finalize") {
          finalized = true;
          finalizeReason = (call.args.reason as string) || "Agent finalized";
          history.push({ turn, tool: "finalize", status: "ok" });
          input.onTurn?.(turn, "finalize", "ok", turnThoughts);
          // Still need to echo a function_response for the call — Gemini
          // expects every functionCall to be paired with a functionResponse.
          responseParts.push({
            type: "function_response",
            functionResponse: {
              id: call.id,
              name: call.name,
              response: { acknowledged: true },
            },
          });
          continue;
        }

        // Enforce re_search_category budget: each call runs a full mini-
        // pipeline (search+extract+score) and takes 3-5 minutes. Cap total
        // calls per run to keep wall-clock bounded.
        if (call.name === "re_search_category" && reSearchCalls >= MAX_RE_SEARCH_CALLS) {
          log.warn("Coordinator blocked re_search_category — budget exhausted", {
            turn,
            reSearchCalls,
            cap: MAX_RE_SEARCH_CALLS,
            category: String(call.args.category ?? ""),
          });
          history.push({ turn, tool: call.name, status: "blocked" });
          responseParts.push({
            type: "function_response",
            functionResponse: {
              id: call.id,
              name: call.name,
              response: {
                status: "blocked",
                message: `re_search_category budget exhausted (${MAX_RE_SEARCH_CALLS} calls already used). No more re-searches allowed this run — finalize with current state or call drop_category for unfillable gaps.`,
              },
            },
          });
          continue;
        }
        if (call.name === "re_search_category") reSearchCalls++;

        input.onTurn?.(turn, call.name, "running", turnThoughts);
        const result = await input.handle(call.name as CoordinatorTool, call.args);
        history.push({ turn, tool: call.name, status: result.status });
        input.onTurn?.(turn, call.name, result.status, turnThoughts);

        responseParts.push({
          type: "function_response",
          functionResponse: {
            id: call.id,
            name: call.name,
            response: {
              status: result.status,
              message: result.message,
              ...(result.metrics || {}),
            },
          },
        });
      }

      // Add user message containing the function responses + a fresh state summary
      const updatedState = input.state();
      const stateBlock: AIContentBlock = {
        type: "text",
        text: `\nUpdated state after this turn:\n${formatStateForAgent(updatedState)}\n\nDecide the next tool. If the work is done, call finalize.`,
      };

      messages.push({ role: "user", content: [...responseParts, stateBlock] });

      if (finalized) break;
    }

    if (turn >= SAFETY_TURN_LIMIT && !finalized) {
      log.warn("Coordinator hit SAFETY_TURN_LIMIT without finalize — likely indicates a tool-loop bug", { turn });
      finalizeReason = "Safety turn limit reached (this should not happen in normal operation)";
    }

    log.info("Coordinator complete", {
      turns: turn,
      finalized,
      reason: finalizeReason,
      totalTokens,
      historyLength: history.length,
    });

    return {
      success: true,
      data: {
        finalized,
        finalizeReason,
        turns: turn,
        tokensUsed: totalTokens,
        history,
      },
      tokensUsed: totalTokens,
      model,
    };
  } catch (err) {
    log.error("Coordinator loop crashed", {
      turn,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      success: false,
      error: err instanceof Error ? err.message : "Coordinator failed",
    };
  }
}

export { COORDINATOR_TOOLS };
