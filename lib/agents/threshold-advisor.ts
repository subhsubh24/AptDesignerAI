/**
 * ThresholdAdvisor — optional LLM layer that wraps the deterministic
 * dynamic thresholds.
 *
 * Subjective-domain note: the deterministic helpers in
 * `lib/scoring/dynamic-thresholds.ts` are the workhorse — they derive
 * thresholds purely from observed score distributions. This advisor
 * exists ONLY to adjust the deterministic baseline within bounded
 * limits when there's a JUSTIFIABLE objective reason (sparse
 * distribution, all-clustered scores, conservative-model-run signals).
 *
 * The advisor's output is constrained to ±0.75 from the deterministic
 * baseline. It cannot pick arbitrary thresholds. If the agent has no
 * good reason to adjust, it must return `delta: 0` and the deterministic
 * value passes through unchanged. This keeps the system grounded in
 * data, with the LLM acting only as a context-sensitive nudge.
 *
 * Use only when context warrants it. Most callers should use the
 * deterministic helpers directly.
 */

import { geminiProvider } from "@/lib/ai/gemini";
import { selectModel } from "@/lib/ai/models";
import { getSystemPrompt } from "@/lib/prompts/system";
import { zodToGeminiSchema } from "@/lib/ai/schema";
import { extractJsonObject } from "@/lib/ai/extract-json";
import { withRetry, isRetryableError } from "@/lib/ai/retry";
import { DETERMINISTIC_SEED } from "@/lib/ai/determinism";
import { createLogger } from "@/lib/logging/logger";
import { z } from "zod";
import type { AgentResult } from "./types";
import type { DistributionSummary } from "@/lib/scoring/dynamic-thresholds";

const log = createLogger("threshold-advisor");

const ThresholdAdvisorSchema = z.object({
  /** Adjustment to apply to the deterministic baseline. Bounded ±0.75. */
  delta: z.coerce.number().min(-0.75).max(0.75),
  /** Reason for the adjustment — must reference an objective signal. */
  reason: z.string(),
  /** Confidence in the adjustment (0-10). Below 5 means the agent is unsure. */
  confidence: z.coerce.number().min(0).max(10),
});

export type ThresholdAdjustment = z.infer<typeof ThresholdAdvisorSchema>;

const THRESHOLD_ADVISOR_GEMINI_SCHEMA = zodToGeminiSchema(ThresholdAdvisorSchema);

export interface ThresholdAdvisorInput {
  /** What threshold are we advising? Used in the prompt for context. */
  thresholdName:
    | "strong_product"
    | "quick_score_gate"
    | "deep_score_keep_floor"
    | "backfill_required";
  /** The deterministic baseline derived from the distribution. */
  deterministicValue: number;
  /** Summary statistics of the underlying distribution. */
  distribution: DistributionSummary;
  /** Context that might justify an adjustment. */
  context: {
    category?: string;
    tier?: string;
    budgetMode?: string;
    productCount?: number;
    /** Did the deep-score model show signs of conservatism this run? */
    drift?: { mean: number; medianAcrossRuns?: number; deviationFromHistorical?: number };
  };
}

const PROMPT_TEMPLATES: Record<ThresholdAdvisorInput["thresholdName"], string> = {
  strong_product: `Threshold "strong_product" decides which products count as STRONG enough that backfill isn't needed. Higher = pickier. Lower = more permissive.`,
  quick_score_gate: `Threshold "quick_score_gate" decides which products survive quick-score and get expensive deep-scoring. Higher = drop more, save tokens. Lower = keep more, more accurate.`,
  deep_score_keep_floor: `Threshold "deep_score_keep_floor" decides which deep-scored products are KEPT in the final candidate set. Higher = stricter, fewer candidates. Lower = keep more.`,
  backfill_required: `Threshold "backfill_required" is a count, not a score — minimum strong products per category before backfill triggers. Higher = backfill more aggressively. Lower = trust initial picks.`,
};

export async function adviseThreshold(
  input: ThresholdAdvisorInput,
): Promise<AgentResult<ThresholdAdjustment>> {
  const model = selectModel("validation");
  const system = getSystemPrompt();

  const distSummary = `count=${input.distribution.count}, min=${input.distribution.min.toFixed(2)}, max=${input.distribution.max.toFixed(2)}, median=${input.distribution.median.toFixed(2)}, mean=${input.distribution.mean.toFixed(2)}, stdev=${input.distribution.stdev.toFixed(2)}, p25=${input.distribution.p25.toFixed(2)}, p60=${input.distribution.p60.toFixed(2)}, p75=${input.distribution.p75.toFixed(2)}`;

  const driftBlock = input.context.drift
    ? `Drift signal: mean this run=${input.context.drift.mean.toFixed(2)}${input.context.drift.medianAcrossRuns !== undefined ? `, historical median=${input.context.drift.medianAcrossRuns.toFixed(2)}` : ""}${input.context.drift.deviationFromHistorical !== undefined ? `, deviation=${input.context.drift.deviationFromHistorical.toFixed(2)}` : ""}`
    : "";

  const prompt = `You are a threshold advisor. The system computed a deterministic threshold from the observed score distribution. Your job: decide whether to adjust it (within ±0.75) based on objective signals.

## THE THRESHOLD
${PROMPT_TEMPLATES[input.thresholdName]}

## DETERMINISTIC BASELINE
${input.deterministicValue.toFixed(2)}

## DISTRIBUTION SUMMARY (objective)
${distSummary}

## CONTEXT
${input.context.category ? `Category: ${input.context.category}` : ""}
${input.context.tier ? `Tier: ${input.context.tier}` : ""}
${input.context.budgetMode ? `Budget mode: ${input.context.budgetMode}` : ""}
${input.context.productCount !== undefined ? `Product count: ${input.context.productCount}` : ""}
${driftBlock}

## RULES
1. Default action: return \`delta: 0\` (no adjustment). Most of the time the deterministic value is correct.
2. Adjust ONLY when an objective signal in the distribution or context warrants it. Never adjust based on vibes about "what good design needs."
3. Justifiable reasons to adjust:
   - Distribution is degenerate (all values clustered within 0.5) → may need to lower threshold to avoid dropping everything
   - Stdev is very high (> 1.5) suggesting the model was inconsistent → consider being more permissive
   - Drift signal shows this run's mean is far below historical → the deep-score model was conservative this run; lower threshold to compensate
   - Product count is very low (< 5) → may need to lower threshold so any product survives
   - Product count is very high (> 30) → can be stricter without losing coverage
4. Hard rule: \`|delta| <= 0.75\`. If you'd want a larger adjustment than that, return delta clamped to ±0.75 with a flag in reason.
5. Confidence: 8+ = strong objective reason; 5-7 = some evidence; <5 = not sure (return delta 0).

Return JSON. Be conservative — when in doubt, delta: 0.`;

  try {
    const response = await withRetry(
      () =>
        geminiProvider.chat({
          model,
          system,
          messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
          max_tokens: 64000,
          seed: DETERMINISTIC_SEED,
          responseSchema: THRESHOLD_ADVISOR_GEMINI_SCHEMA,
          responseMimeType: "application/json",
          // Code Execution lets the advisor compute precise statistics
          // (percentiles, z-scores, MAD) over the distribution rather
          // than estimating. The math here is the agent's whole job.
          tools: [{ codeExecution: {} as Record<string, never> }],
        }),
      { isRetryable: isRetryableError, maxAttempts: 2 },
    );

    const parsed = extractJsonObject(response.content);
    const validated = ThresholdAdvisorSchema.safeParse(parsed);
    if (!validated.success) {
      log.warn("ThresholdAdvisor schema mismatch — returning delta=0", {
        issues: validated.error.issues.slice(0, 3),
      });
      return {
        success: true,
        data: { delta: 0, reason: "Schema mismatch — defaulted", confidence: 0 },
      };
    }

    // Belt-and-suspenders bounds enforcement (schema already enforces but
    // reject obvious model-confusion cases here too).
    const delta = Math.max(-0.75, Math.min(0.75, validated.data.delta));
    const tokensUsed =
      (response.usage?.input_tokens ?? 0) +
      (response.usage?.output_tokens ?? 0) +
      (response.usage?.thinking_tokens ?? 0);

    log.info("Threshold advice", {
      threshold: input.thresholdName,
      baseline: input.deterministicValue,
      delta,
      finalValue: input.deterministicValue + delta,
      confidence: validated.data.confidence,
      reason: validated.data.reason,
      tokensUsed,
    });

    return {
      success: true,
      data: { ...validated.data, delta },
      tokensUsed,
      model,
    };
  } catch (err) {
    log.warn("ThresholdAdvisor failed — returning delta=0", {
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      success: true,
      data: { delta: 0, reason: "Advisor failed; defaulting to baseline", confidence: 0 },
    };
  }
}

/**
 * Compute the final threshold by combining the deterministic baseline
 * with the optional advisor's adjustment. Confidence-gated: low-confidence
 * adjustments are suppressed to keep the system anchored on the
 * deterministic value.
 */
export function applyAdvisorAdjustment(
  baseline: number,
  adjustment: ThresholdAdjustment | undefined,
  minConfidenceToApply = 6,
): number {
  if (!adjustment) return baseline;
  if (adjustment.confidence < minConfidenceToApply) return baseline;
  return baseline + adjustment.delta;
}
