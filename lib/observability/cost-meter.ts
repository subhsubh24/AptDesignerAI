/**
 * Per-request cost ledger — the harness "observability: cost and latency
 * metering" primitive.
 *
 * Osmani's harness post lists observability (logs, traces, cost and latency
 * metering) as a first-class harness component. We already have logs +
 * traces; this adds a cheap, structured token/cost ledger so a pipeline run
 * can answer: "what did this room cost?", "which stages burned the most
 * tokens?", and "how often did the escalation ladder fire?".
 *
 * Design: a ledger lives in AsyncLocalStorage for the duration of a request
 * (established by `withCostLedger`). `recordStageCost` appends to whatever
 * ledger is active, and is a no-op when none is — so call sites can adopt it
 * incrementally without ordering constraints or crashes. This mirrors the
 * tracing module's "observe, never throw" contract.
 */

import { AsyncLocalStorage } from "async_hooks";

export type ThinkingLevel = "minimal" | "low" | "medium" | "high";

export interface StageCost {
  /** Stage label, e.g. "pass-a", "harmony-round-3", "deep-score". */
  stage: string;
  /** Model id actually used (tier resolves to a model name). */
  model: string;
  /** Thinking level requested for this stage. */
  thinkingLevel?: ThinkingLevel;
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  /** Escalation-ladder tier reached (0 = cheap path), when applicable. */
  tierReached?: number;
  /** True when this stage cost more than its cheap default (escalated). */
  escalated?: boolean;
  /** Wall-clock duration in ms, when measured. */
  durationMs?: number;
}

export interface CostSummary {
  stages: StageCost[];
  totalInputTokens: number;
  totalOutputTokens: number;
  totalThinkingTokens: number;
  totalTokens: number;
  escalationCount: number;
  stageCount: number;
}

const storage = new AsyncLocalStorage<StageCost[]>();

/**
 * Establish a fresh cost ledger for the duration of `fn`. Nested calls reuse
 * the outer ledger so the whole pipeline accumulates into one summary.
 */
export async function withCostLedger<T>(
  fn: (summary: () => CostSummary) => Promise<T>,
): Promise<T> {
  const existing = storage.getStore();
  if (existing) return fn(() => summarize(existing));
  const ledger: StageCost[] = [];
  return storage.run(ledger, () => fn(() => summarize(ledger)));
}

/**
 * Record one stage's cost into the active ledger. No-op when no ledger is
 * active, so it is always safe to call.
 */
export function recordStageCost(entry: StageCost): void {
  const ledger = storage.getStore();
  if (!ledger) return;
  ledger.push(entry);
}

/**
 * Convenience: record from a provider response's `usage` block. Returns the
 * summed tokens for the caller's own bookkeeping (e.g. token-budget checks).
 */
export function recordUsage(
  stage: string,
  model: string,
  usage: { input_tokens?: number; output_tokens?: number; thinking_tokens?: number },
  opts: { thinkingLevel?: ThinkingLevel; tierReached?: number; escalated?: boolean; durationMs?: number } = {},
): number {
  const inputTokens = usage.input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  const thinkingTokens = usage.thinking_tokens ?? 0;
  recordStageCost({ stage, model, inputTokens, outputTokens, thinkingTokens, ...opts });
  return inputTokens + outputTokens + thinkingTokens;
}

/** Read the current ledger's summary without ending it. */
export function getCostSummary(): CostSummary | undefined {
  const ledger = storage.getStore();
  return ledger ? summarize(ledger) : undefined;
}

function summarize(ledger: StageCost[]): CostSummary {
  let ti = 0;
  let to = 0;
  let tt = 0;
  let esc = 0;
  for (const s of ledger) {
    ti += s.inputTokens;
    to += s.outputTokens;
    tt += s.thinkingTokens;
    if (s.escalated) esc++;
  }
  return {
    stages: ledger.slice(),
    totalInputTokens: ti,
    totalOutputTokens: to,
    totalThinkingTokens: tt,
    totalTokens: ti + to + tt,
    escalationCount: esc,
    stageCount: ledger.length,
  };
}
