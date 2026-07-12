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

import { MarginMeter } from "margin-meter";
import { waitUntil } from "@vercel/functions";

// undefined = not yet resolved; null = disabled (no key / offline / error).
let cached: MarginMeter | null | undefined;

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
 */
export function getMeter(): MarginMeter | null {
  if (cached !== undefined) return cached;
  try {
    if (isOffline() || !process.env.MARGIN_INGEST_KEY) {
      cached = null;
      return cached;
    }
    cached = new MarginMeter({
      ingestUrl: process.env.MARGIN_INGEST_URL,
      apiKey: process.env.MARGIN_INGEST_KEY,
      timeoutMs: EMIT_TIMEOUT_MS,
    });
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
