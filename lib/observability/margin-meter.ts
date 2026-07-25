/**
 * Margin economics meter — emits cost-per-outcome telemetry to Margin.
 *
 * Wraps the dependency-free `margin-meter` SDK (npm; source at
 * github.com/subhsubh24/Margin.ai, subdir sdk/ts). The SDK POSTs each measured
 * LLM call + outcome to Margin's ingest API so Margin can compute this app's
 * productivity ÷ AI spend. It sits ALONGSIDE the in-request cost ledger
 * (cost-meter.ts): the ledger answers "what did THIS room cost?" locally; the
 * meter exports the same economics OUT to Margin for cross-run analysis.
 *
 * THREE fail-safe guarantees so telemetry can NEVER crash or slow the host, and
 * NEVER egresses in CI/tests:
 *   1. Construction is wrapped in try/catch → `null` on any error.
 *   2. The meter is built ONLY when `MARGIN_INGEST_KEY` is set. The SDK is a
 *      no-op without a key (it never opens a socket), so an unset key = disabled.
 *   3. We additionally refuse to construct under the hermetic CI/journeys context
 *      (`E2E_AUTH_STACK=1` or `CI`) — mirroring gemini.ts's `assertCassetteSafe()`
 *      fail-closed convention — so a stray key can never cause network egress
 *      from the hermetic cassette run.
 *
 * DELIVERY (Vercel serverless): a bare floating promise is DROPPED — the instance
 * freezes the instant the HTTP response is sent, before the emit's fetch resolves.
 * So emits must NOT float. Use {@link emit} to hand the promise to Vercel's
 * `waitUntil`, which extends the function's lifetime until the emit settles
 * (off-Vercel it is a harmless no-op — there's no freeze, so the promise completes
 * on its own). The bounded `timeoutMs` below caps how long a stuck ingest can keep
 * the function alive (or block an `await`ed emit).
 */

import {
  MarginMeter,
  FetchTransport,
  DEFAULT_INGEST_URL,
  type RecordCallInput,
  type RecordOutcomeInput,
  type IngestResult,
} from "margin-meter";
import { waitUntil } from "@vercel/functions";

/** A recorded call. `operation` — the supply-chain STEP label (the graph NODE) —
 *  is a NATIVE field of `RecordCallInput` since `margin-meter@0.2.0`, so this is
 *  a plain alias kept for the call sites that already import it. */
export type MeterCallInput = RecordCallInput;

/** The meter surface the app + eval runner use (recordCall / recordOutcome). */
export interface Meter {
  recordCall(input: MeterCallInput): Promise<IngestResult>;
  recordOutcome(input: RecordOutcomeInput): Promise<IngestResult>;
}

// undefined = not yet resolved; null = disabled (no key / offline / error).
let cached: Meter | null | undefined;

// Cap a stuck ingest: bounds waitUntil lifetime + any awaited emit (SDK default 10s).
const EMIT_TIMEOUT_MS = 4000;

/** True in the hermetic CI / E2E journeys context, where NO network egress is
 *  allowed (the AI pipeline runs against a canned cassette with dummy keys). */
function isOffline(): boolean {
  return process.env.E2E_AUTH_STACK === "1" || !!process.env.CI;
}

/**
 * The process-wide Margin meter, or `null` when telemetry is disabled. Resolved
 * once and cached. Never throws.
 *
 * EVAL MODE (set ONLY by the on-demand eval runner, never in prod/CI): when
 * `MARGIN_SESSION_ID` is present the meter is wrapped so every recorded call is
 * tagged with:
 *   - that session id (`eval:<runid>`) — separates an eval batch from prod, and
 *   - `MARGIN_WORKFLOW_ID` when set — overrides the call's workflow so a run-all
 *     eval can attribute each suite's calls to its own workflow (the provider
 *     call sites hardcode `aptdesigner-search`). Read LIVE per call so a single
 *     run can retag across suites.
 * Unset (the default everywhere else, including the pinned egress-gate test)
 * returns the raw meter untouched.
 */
export function getMeter(): Meter | null {
  if (cached !== undefined) return cached;
  try {
    if (isOffline() || !process.env.MARGIN_INGEST_KEY) {
      cached = null;
      return cached;
    }
    // `operation` (and `reasoningTokens` / `substrate`) are NATIVE fields of the
    // SDK's `recordCall` since 0.2.0, so the payload is built entirely by the
    // SDK — the transport is a plain bounded FetchTransport with no rewriting.
    // (Through 0.1.0 this wrapper stashed each call's `operation` and injected it
    // into the outbound payload, because that build dropped the field.)
    const transport = new FetchTransport(
      process.env.MARGIN_INGEST_URL || DEFAULT_INGEST_URL,
      EMIT_TIMEOUT_MS,
    );
    const real = new MarginMeter({
      apiKey: process.env.MARGIN_INGEST_KEY,
      transport,
    });
    const evalMode = Boolean(process.env.MARGIN_SESSION_ID);
    cached = {
      recordCall: (input) =>
        real.recordCall(
          evalMode
            ? {
                ...input,
                // Explicit per-call values still win over the eval-batch defaults.
                sessionId: input.sessionId ?? process.env.MARGIN_SESSION_ID,
                workflowId: process.env.MARGIN_WORKFLOW_ID || input.workflowId,
              }
            : input,
        ),
      recordOutcome: (input) => real.recordOutcome(input),
    };
  } catch {
    cached = null;
  }
  return cached;
}

/**
 * Fire a meter emit so it RELIABLY completes on Vercel serverless (which freezes
 * the instance the moment the response is sent, dropping bare floating promises).
 * Pass the promise from `getMeter()?.recordCall(...)` / `recordOutcome(...)`;
 * `undefined` (meter disabled) is a no-op. The promise is caught (telemetry never
 * surfaces an error) and handed to Vercel `waitUntil`, which keeps the function
 * alive until it settles. Off-Vercel `waitUntil` is a no-op and there is no freeze,
 * so the emit still completes on its own. Never throws.
 */
export function emit(p: Promise<unknown> | undefined): void {
  if (!p) return;
  const settled = p.catch(() => {});
  try {
    waitUntil(settled);
  } catch {
    // Not in a Vercel request context (local/dev) — no freeze risk; `settled`
    // is already handled and runs to completion on its own.
  }
}
