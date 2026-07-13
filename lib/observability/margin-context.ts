/**
 * Margin journey context — the per-request thread that lets Margin's
 * supply-chain graph reconstruct the REAL multi-step chain of a design run.
 *
 * Every LLM call in this app funnels through the two provider modules
 * (`lib/ai/gemini.ts` + `lib/ai/deepseek.ts`), which emit one Margin call each
 * (see margin-meter.ts). On their own those emits are anonymous — Margin can't
 * tell WHICH step (search vs diagnosis vs a refine turn vs the final design)
 * produced a call, nor which calls belong to the SAME journey run. This module
 * carries that missing context down to the emit via `AsyncLocalStorage` (the
 * same mechanism the app already uses for tracing.ts / cost-meter.ts):
 *
 *   - `sessionId` — a SHARED id for one journey run (this app uses the room id).
 *     Every call made anywhere under `runWithMarginSession` inherits it, so the
 *     graph links search → diagnosis → refine turns → design into one chain.
 *   - `operation` — the descriptive STEP label (the supply-chain NODE). Set at a
 *     route boundary for the whole step, and overridden by `withMarginOperation`
 *     around a sub-agent so a multi-call workflow DECOMPOSES into its nodes
 *     (e.g. "search" → "fit-scoring" / "rerank" / "product-verify").
 *   - `isRetry` — marks calls made under a retry so the graph can separate a
 *     first attempt from a retried one.
 *
 * FAIL-SAFE, ADDITIVE, ZERO product impact: reads never throw (a missing store
 * yields `{}`), and `run*`/`with*` only wrap execution to set the store — they
 * never alter what `fn` returns or throws. When a call runs outside any context
 * (e.g. a background job), the emit simply carries no operation/session and the
 * app behaves exactly as before.
 */

import { AsyncLocalStorage } from "async_hooks";

export interface MarginJourneyContext {
  /** Shared across one journey run so its steps link into a chain (room id). */
  sessionId?: string;
  /** The supply-chain STEP label for the calls made under this context. */
  operation?: string;
  /** True when the surrounding code is a retry of a failed attempt. */
  isRetry?: boolean;
}

const storage = new AsyncLocalStorage<MarginJourneyContext>();

/** The active journey context, or `{}` when running outside one. Never throws. */
export function getMarginContext(): MarginJourneyContext {
  try {
    return storage.getStore() ?? {};
  } catch {
    return {};
  }
}

/**
 * Run `fn` under a journey context, MERGED over any parent context so a nested
 * scope inherits the parent's `sessionId` while overriding `operation`. The
 * return value / thrown error of `fn` is passed through untouched — this only
 * sets the ambient context, never changes behavior.
 */
export function withMarginContext<T>(
  ctx: MarginJourneyContext,
  fn: () => T,
): T {
  const parent = storage.getStore() ?? {};
  return storage.run({ ...parent, ...ctx }, fn);
}

/**
 * Open a journey run: set the SHARED `sessionId` (+ an initial step operation)
 * for everything `fn` does. Use at a route boundary where the room id is known.
 */
export function runWithMarginSession<T>(
  sessionId: string,
  operation: string | undefined,
  fn: () => T,
): T {
  return withMarginContext({ sessionId, operation }, fn);
}

/**
 * Override just the `operation` (the supply-chain node) for the duration of
 * `fn`, inheriting the surrounding `sessionId`. Wrap a sub-agent with this so a
 * multi-call step decomposes into its own nodes.
 */
export function withMarginOperation<T>(operation: string, fn: () => T): T {
  return withMarginContext({ operation }, fn);
}

/** Mark everything `fn` does as a retry (sets `isRetry`), inheriting the rest. */
export function withMarginRetry<T>(fn: () => T): T {
  return withMarginContext({ isRetry: true }, fn);
}
