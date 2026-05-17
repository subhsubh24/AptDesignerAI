/**
 * DesignCoordinator — native function-calling agent loop for the
 * design assessment/generation pipeline.
 *
 * Replaces the hardcoded Pass A → Pass B → enrich → harmony loop in
 * area-analysis with an agentic flow where the LLM decides what to do
 * next based on objective state signals.
 *
 * Tools available:
 *   - run_pass_a           — room understanding (self-consistent sampling)
 *   - run_pass_b           — furnishing list generation
 *   - run_enrichment       — enrich vague what_it_needs items
 *   - run_harmony_round    — one round of harmony validation + revision
 *   - run_final_assessment — final 3-pass assessment
 *   - search_design_trends — Google Search for current trends/pricing
 *   - rerun_pass_b         — re-generate furnishing list with feedback
 *   - finalize             — stop the loop
 *
 * The agent sees objective state on each turn: item counts, scores,
 * convergence signals, enrichment stats. It decides ordering, whether
 * to re-run passes, and when convergence is reached.
 *
 * Behind feature flag ENABLE_DESIGN_COORDINATOR (default ON).
 * When off, area-analysis falls back to the hardcoded pipeline.
 */

import { geminiProvider } from "@/lib/ai/gemini";
import { selectModel } from "@/lib/ai/models";
import { getSystemPrompt } from "@/lib/prompts/system";
import { DETERMINISTIC_SEED } from "@/lib/ai/determinism";
import { createLogger } from "@/lib/logging/logger";
import type { AgentResult } from "./types";
import type { AIMessage, AIContentBlock, FunctionDeclaration } from "@/lib/ai/provider";

const log = createLogger("design-coordinator");

const SAFETY_TURN_LIMIT = 15;

export type DesignCoordinatorTool =
  | "run_pass_a"
  | "run_pass_b"
  | "run_enrichment"
  | "run_harmony_round"
  | "run_final_assessment"
  | "search_design_trends"
  | "rerun_pass_b"
  | "finalize";

const COORDINATOR_TOOLS: FunctionDeclaration[] = [
  {
    name: "run_pass_a",
    description:
      "Run Pass A: room understanding. Self-consistent sampling (N parallel analyses + judge picks best). Produces design direction, palette, materials, spatial layout, what_works, what_should_go. MUST run first — everything depends on this. Returns understanding object + token cost.",
    parametersJsonSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "run_pass_b",
    description:
      "Run Pass B: furnishing list generation. Consumes Pass A's understanding to produce a tiered what_it_needs list with specs, materials, placement. Requires Pass A to have completed. Returns item count + categories.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        feedback: {
          type: "string",
          description: "Optional feedback to include in the Pass B prompt (e.g., 'focus more on lighting' or 'include more storage options'). Used when re-running Pass B after reviewing initial results.",
        },
      },
    },
  },
  {
    name: "run_enrichment",
    description:
      "Enrich vague what_it_needs items that lack specific dimensions or materials. Runs one batch LLM call to fill in missing search_title/specs. Returns count of items enriched vs still vague. Requires Pass B to have completed.",
    parametersJsonSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "run_harmony_round",
    description:
      "Run one round of harmony validation. Scores every item on 6 dimensions (color, spatial, material, style, cross-room, functional), applies math caps, revises items below target. Returns per-item scores, convergence velocity, and stabilization status. Run iteratively until convergence. Each round costs ~50-100K tokens.",
    parametersJsonSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "run_final_assessment",
    description:
      "Run the final comprehensive 3-pass assessment (per-item scoring + holistic + convergence). This is the definitive evaluation. Run AFTER harmony rounds converge. Returns final scores, whether more rounds are warranted, and round budget.",
    parametersJsonSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "search_design_trends",
    description:
      "Search for current design trends, material availability, or pricing using Google Search. Use to ground design decisions in real-world data. Returns search results summary.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query — e.g., '2026 living room design trends walnut furniture' or 'boucle accent chair average price 2026'",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "rerun_pass_b",
    description:
      "Re-generate the furnishing list with specific feedback. Use when harmony rounds reveal systemic issues (e.g., too many wood species, missing functional categories, budget misalignment). Cheaper than many harmony rounds for fundamental issues. Requires Pass A to have completed.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        feedback: {
          type: "string",
          description: "Specific feedback for the re-run — e.g., 'Limit to 2 wood species: walnut and oak. Add a floor lamp for the reading corner. Remove the second plant.'",
        },
      },
      required: ["feedback"],
    },
  },
  {
    name: "finalize",
    description:
      "Finalize the design. Call when: (a) all items scored 8.5+/10, (b) convergence velocity < 0.2, or (c) harmony rounds have stabilized. Returns the final analysis + validation objects.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "Why you're finalizing — reference objective signals (scores, convergence velocity, round count).",
        },
      },
      required: ["reason"],
    },
  },
];

export interface DesignCoordinatorState {
  passAComplete: boolean;
  passBComplete: boolean;
  enrichmentComplete: boolean;
  harmonyRoundsCompleted: number;
  finalAssessmentComplete: boolean;
  itemCount: number;
  categories: string[];
  enrichmentStats?: { enriched: number; stillVague: number; total: number };
  latestScores?: Array<{ category: string; score: number; stabilized: boolean }>;
  convergenceVelocity?: number;
  stabilizedCount?: number;
  totalItems?: number;
  overallCohesion?: number;
  confidence?: number;
  finalAssessmentResult?: { needsMoreRounds: boolean; roundBudget: number };
  designTrendSearches?: string[];
}

export type DesignToolHandler = (
  toolName: DesignCoordinatorTool,
  args: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

function formatState(state: DesignCoordinatorState): string {
  const lines: string[] = [
    `## CURRENT STATE (objective signals — base your decisions on these)`,
    `Pass A (understanding): ${state.passAComplete ? "COMPLETE" : "NOT RUN"}`,
    `Pass B (furnishing): ${state.passBComplete ? `COMPLETE — ${state.itemCount} items across [${state.categories.join(", ")}]` : "NOT RUN"}`,
    `Enrichment: ${state.enrichmentComplete ? `COMPLETE — ${state.enrichmentStats?.enriched ?? 0}/${state.enrichmentStats?.total ?? 0} items enriched, ${state.enrichmentStats?.stillVague ?? 0} still vague` : "NOT RUN"}`,
    `Harmony rounds: ${state.harmonyRoundsCompleted}`,
  ];

  if (state.latestScores && state.latestScores.length > 0) {
    const avgScore = state.latestScores.reduce((s, i) => s + i.score, 0) / state.latestScores.length;
    const belowTarget = state.latestScores.filter((s) => s.score < 8.5 && !s.stabilized);
    lines.push(`Latest scores: avg=${avgScore.toFixed(1)}, below 8.5=${belowTarget.length}, stabilized=${state.stabilizedCount ?? 0}/${state.totalItems ?? state.latestScores.length}`);
    lines.push(`Per-item: ${state.latestScores.map((s) => `${s.category}=${s.score}${s.stabilized ? "✓" : ""}`).join(", ")}`);
  }

  if (state.convergenceVelocity !== undefined) {
    lines.push(`Convergence velocity: ${state.convergenceVelocity.toFixed(2)} (< 0.2 = diminishing returns)`);
  }

  if (state.overallCohesion !== undefined) {
    lines.push(`Overall cohesion: ${state.overallCohesion}/10`);
  }

  if (state.confidence !== undefined) {
    lines.push(`Confidence: ${state.confidence}/10`);
  }

  if (state.finalAssessmentComplete && state.finalAssessmentResult) {
    lines.push(`Final assessment: needsMoreRounds=${state.finalAssessmentResult.needsMoreRounds}, roundBudget=${state.finalAssessmentResult.roundBudget}`);
  }

  if (state.designTrendSearches && state.designTrendSearches.length > 0) {
    lines.push(`Design trend searches completed: ${state.designTrendSearches.length}`);
  }

  return lines.join("\n");
}

export async function runDesignCoordinator(
  getState: () => DesignCoordinatorState,
  handleTool: DesignToolHandler,
  roomContext: { roomName: string; roomType: string; budgetMode?: string },
): Promise<AgentResult<{ finalized: boolean; reason?: string }>> {
  const model = selectModel("validation");
  const system = getSystemPrompt();

  const messages: AIMessage[] = [];

  const initialPrompt = `You are the Design Coordinator — an autonomous agent that orchestrates the design assessment pipeline for the ${roomContext.roomName} (${roomContext.roomType})${roomContext.budgetMode ? `, budget mode: ${roomContext.budgetMode}` : ""}.

## YOUR ROLE
You decide WHICH design pipeline steps to run, in WHAT ORDER, and WHEN TO STOP. You make operational decisions based on objective signals (scores, item counts, convergence velocity) — you do NOT make subjective design judgments (that's delegated to the tools you invoke).

## AVAILABLE TOOLS
- run_pass_a: Room understanding (self-consistent, ~3 parallel samples). MUST run first.
- run_pass_b: Furnishing list from Pass A's brief. Requires Pass A.
- run_enrichment: Fill in vague specs/dimensions. Requires Pass B.
- run_harmony_round: One validation + revision round. Run iteratively.
- run_final_assessment: Definitive 3-pass evaluation. Run after harmony converges.
- search_design_trends: Google Search for current trends/pricing. Use to ground decisions.
- rerun_pass_b: Re-generate furnishing list with feedback. Use for fundamental issues.
- finalize: Stop the loop when quality is sufficient.

## STANDARD FLOW (adjust as needed based on signals)
1. run_pass_a → get room understanding
2. Optionally search_design_trends for the style direction to verify it's current
3. run_pass_b → generate furnishing list
4. run_enrichment → fill vague specs
5. run_harmony_round → iterate until scores converge (avg >= 8.5 or velocity < 0.2)
6. If harmony reveals fundamental issues (3+ items with same root cause), rerun_pass_b with targeted feedback instead of more harmony rounds
7. run_final_assessment → definitive evaluation
8. finalize

## DECISION PRINCIPLES
- Run harmony rounds until convergence — don't stop early if items are still improving
- If convergence velocity drops below 0.2, stop harmony and run final assessment
- If all items are stabilized or above 8.5, proceed to final assessment
- After final assessment, if needsMoreRounds=true AND roundBudget > 0, run more harmony rounds
- Use search_design_trends when the style direction references specific trends you want to verify (e.g., "japandi" → search for current japandi trends 2026)
- Call multiple tools in parallel when they're independent (e.g., enrichment + search)

## FEW-SHOT EXAMPLES

### Example 1: Clean convergence
State: Pass A complete, Pass B complete (12 items), enrichment done
Action: run_harmony_round
Result: avg=7.2, 4 items below 8.5, velocity=N/A (first round)
Action: run_harmony_round
Result: avg=8.1, 2 items below 8.5, velocity=0.9
Action: run_harmony_round
Result: avg=8.6, 0 items below 8.5, velocity=0.5
Action: run_final_assessment → finalize

### Example 2: Fundamental issue detected
State: Harmony round 3, avg=6.5, root_cause on 5/12 items: "material_fit: 4 wood species"
Action: rerun_pass_b(feedback="Limit to 2 wood species: walnut and oak. The original list had ash, maple, walnut, and teak — consolidate to walnut + oak only.")
Then: run_enrichment → run_harmony_round → ...

### Example 3: Using trend search
State: Pass A complete, style_name="Japandi Warmth"
Action: search_design_trends(query="japandi interior design trends 2026 furniture materials")
Then: run_pass_b (incorporating trend context)

${formatState(getState())}

Begin. Call your first tool.`;

  messages.push({ role: "user", content: [{ type: "text", text: initialPrompt }] });

  let totalTokens = 0;

  for (let turn = 0; turn < SAFETY_TURN_LIMIT; turn++) {
    const stateText = turn > 0 ? `\n\n${formatState(getState())}` : "";

    const response = await geminiProvider.chat({
      model,
      system,
      messages: turn > 0 ? messages : messages,
      max_tokens: 8192,
      seed: DETERMINISTIC_SEED,
      tools: [
        { functionDeclarations: COORDINATOR_TOOLS },
        { googleSearch: {} as Record<string, never> },
        { codeExecution: {} as Record<string, never> },
      ],
      thinkingConfig: { thinkingLevel: "low", includeThoughts: true },
    });

    totalTokens +=
      (response.usage?.input_tokens ?? 0) +
      (response.usage?.output_tokens ?? 0) +
      (response.usage?.thinking_tokens ?? 0);

    // Log thought summaries for transparency
    if (response.thoughtSummaries?.length) {
      log.info("Coordinator reasoning", {
        turn,
        thoughts: response.thoughtSummaries.slice(0, 2),
      });
    }

    const functionCalls = response.functionCalls || [];

    if (functionCalls.length === 0) {
      log.info("Coordinator returned text without tool call — implicit finalize", {
        turn,
        text: response.content.slice(0, 200),
      });

      return {
        success: true,
        data: { finalized: true, reason: response.content || "Implicit finalize (no tool call)" },
        tokensUsed: totalTokens,
        model,
      };
    }

    // Echo the model's response verbatim to preserve thought parts and
    // thoughtSignature values that Gemini 3 mandates on continuations.
    // Falling back to manual reconstruction if raw parts are unavailable.
    if (response.modelContentParts) {
      messages.push({
        role: "assistant",
        content: [],
        _rawGeminiParts: response.modelContentParts,
      });
    } else {
      const assistantParts: AIContentBlock[] = [];
      if (response.content) {
        assistantParts.push({ type: "text", text: response.content });
      }
      for (const fc of functionCalls) {
        assistantParts.push({
          type: "function_call",
          functionCall: {
            id: fc.id,
            name: fc.name,
            args: fc.args,
            thoughtSignature: fc.thoughtSignature,
          },
        });
      }
      messages.push({ role: "assistant", content: assistantParts });
    }

    // Execute all function calls (parallel if multiple)
    const results = await Promise.all(
      functionCalls.map(async (fc) => {
        const toolName = fc.name as DesignCoordinatorTool;
        log.info(`Executing tool: ${toolName}`, { turn, args: fc.args });

        try {
          const result = await handleTool(toolName, fc.args);
          return { id: fc.id, name: fc.name, result };
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          log.warn(`Tool ${toolName} failed`, { error: errMsg });
          return { id: fc.id, name: fc.name, result: { error: errMsg } };
        }
      }),
    );

    // Check if finalize was called
    const finalizeCall = results.find((r) => r.name === "finalize");
    if (finalizeCall) {
      log.info("Coordinator finalized", {
        turn,
        reason: (finalizeCall.result as Record<string, unknown>).reason,
        totalTokens,
      });

      // Still send the function response so the conversation is well-formed,
      // but return immediately after.
      return {
        success: true,
        data: {
          finalized: true,
          reason: (finalizeCall.result as Record<string, unknown>).reason as string,
        },
        tokensUsed: totalTokens,
        model,
      };
    }

    // Build function response message
    const responseParts: AIContentBlock[] = results.map((r) => ({
      type: "function_response" as const,
      functionResponse: {
        id: r.id,
        name: r.name,
        response: r.result,
      },
    }));

    // Append current state after tool results so the agent sees fresh signals
    if (stateText) {
      responseParts.push({ type: "text", text: stateText });
    }

    messages.push({ role: "user", content: responseParts });

    // Auto-finalize guard: if state shows convergence, stop early to save tokens
    const st = getState();
    const allAboveTarget = st.latestScores && st.latestScores.length > 0 &&
      st.latestScores.every(s => s.score >= 8.5 || s.stabilized);
    const velocityExhausted = st.convergenceVelocity !== undefined && st.convergenceVelocity < 0.2;
    const allStabilized = st.stabilizedCount !== undefined && st.totalItems !== undefined &&
      st.stabilizedCount >= st.totalItems;
    // Once the final assessment has run and reports no more rounds are
    // warranted, the finalize decision is already made — skip the extra LLM
    // turn that would just rubber-stamp it.
    const finalAssessmentSettled = st.finalAssessmentComplete &&
      !!st.finalAssessmentResult && !st.finalAssessmentResult.needsMoreRounds;
    const harmonyConverged = st.harmonyRoundsCompleted >= 1 &&
      (allAboveTarget || velocityExhausted || allStabilized);
    if (finalAssessmentSettled || harmonyConverged) {
      log.info("Auto-finalize: convergence detected", {
        turn, allAboveTarget, velocityExhausted, allStabilized,
        finalAssessmentSettled, rounds: st.harmonyRoundsCompleted,
      });
      return {
        success: true,
        data: { finalized: true, reason: finalAssessmentSettled
          ? "Auto-finalize: final assessment complete, no more rounds warranted"
          : `Auto-finalize: ${allAboveTarget ? "all items ≥ 8.5" : velocityExhausted ? "velocity < 0.2" : "all stabilized"} after ${st.harmonyRoundsCompleted} round(s)` },
        tokensUsed: totalTokens,
        model,
      };
    }
  }

  log.warn("Design coordinator hit safety turn limit", {
    turns: SAFETY_TURN_LIMIT,
    totalTokens,
  });

  return {
    success: true,
    data: { finalized: true, reason: `Safety turn limit (${SAFETY_TURN_LIMIT}) reached` },
    tokensUsed: totalTokens,
    model,
  };
}
