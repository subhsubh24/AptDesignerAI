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
 * agent uses to plan its next step. Caps at MAX_TURNS to prevent runaway.
 *
 * Behind feature flag ENABLE_POST_SEARCH_COORDINATOR. When off, the
 * orchestrator's existing hardcoded post-search flow runs instead.
 */

import { geminiProvider } from "@/lib/ai/gemini";
import { selectModel } from "@/lib/ai/models";
import { getSystemPrompt } from "@/lib/prompts/system";
import { DETERMINISTIC_SEED } from "@/lib/ai/determinism";
import { createLogger } from "@/lib/logging/logger";
import type { AgentResult } from "./types";
import type { AIMessage, AIContentBlock, FunctionDeclaration } from "@/lib/ai/provider";

const log = createLogger("post-search-coordinator");

const MAX_TURNS = 12;

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
  onTurn?: (turn: number, action: string, status: string) => void;
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

  lines.push("Per-category state (only categories with products):");
  for (const [cat, s] of Object.entries(state.categories)) {
    const parts = [`  [${cat}] count=${s.productCount}`];
    if (s.tiersCovered.length) parts.push(`tiers=${s.tiersCovered.join("/")}`);
    if (s.scoreMedian !== undefined) parts.push(`score median=${s.scoreMedian.toFixed(1)} (range ${s.scoreMin?.toFixed(1)}-${s.scoreMax?.toFixed(1)})`);
    if (s.topPickTitle) parts.push(`top="${s.topPickTitle}"`);
    if (s.topPickPrice) parts.push(`$${s.topPickPrice}`);
    if (state.reSearchCount[cat]) parts.push(`re-searched ${state.reSearchCount[cat]}x`);
    lines.push(parts.join(" | "));
  }

  if (Object.values(state.triedQueries).some((q) => q.length > 0)) {
    lines.push("");
    lines.push("Queries already tried (do not repeat):");
    for (const [cat, qs] of Object.entries(state.triedQueries)) {
      if (qs.length > 0) {
        lines.push(`  [${cat}]: ${qs.slice(-6).map((q) => `"${q}"`).join(", ")}`);
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

Stop conditions:
- alignment >= 8 AND bundles generated AND tiers filled → finalize
- budget < 15% remaining → finalize with what you have
- Same audit alignment for 2 consecutive audits → no point iterating, finalize
- 12 turns reached → loop will hard-stop

Avoid:
- Re-searching the same category twice without intermediate audit (wasteful)
- Running validation more than once (rare value)
- Calling re_search_category without first running an audit (you have no signal of what's broken)
- Calling finalize before bundles/tiers — the user sees nothing useful

Only call ONE function per turn. Reason briefly before each call. Be decisive — if the state is good enough, finalize.`;

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

  try {
    while (turn < MAX_TURNS && !finalized) {
      turn++;
      let response;
      try {
        response = await geminiProvider.chat({
          model,
          system,
          messages,
          max_tokens: 4000,
          seed: DETERMINISTIC_SEED,
          tools: [{ functionDeclarations: COORDINATOR_TOOLS }],
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

      // Echo the model's call back into history (with thoughtSignature) so
      // Gemini 3 doesn't 400 on the next call.
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

      // Dispatch each call (Gemini may return parallel calls; we serialize)
      const responseParts: AIContentBlock[] = [];
      for (const call of calls) {
        if (call.name === "finalize") {
          finalized = true;
          finalizeReason = (call.args.reason as string) || "Agent finalized";
          history.push({ turn, tool: "finalize", status: "ok" });
          input.onTurn?.(turn, "finalize", "ok");
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

        input.onTurn?.(turn, call.name, "running");
        const result = await input.handle(call.name as CoordinatorTool, call.args);
        history.push({ turn, tool: call.name, status: result.status });
        input.onTurn?.(turn, call.name, result.status);

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

    if (turn >= MAX_TURNS && !finalized) {
      log.warn("Coordinator hit MAX_TURNS without finalize — stopping", { turn });
      finalizeReason = "Max turns reached";
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
