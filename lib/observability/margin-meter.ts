/**
 * Margin economics meter — emits cost-per-outcome telemetry to Margin.
 *
 * Wraps the dependency-free `@margin/meter` SDK (github.com/subhsubh24/Margin.ai,
 * subdir sdk/ts, vendored under vendor/margin-meter). The SDK POSTs each measured
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
 * Call sites MUST invoke it non-blocking, e.g.:
 *   void getMeter()?.recordCall({ ... })?.catch(() => {});
 */

import { MarginMeter } from "@margin/meter";

// undefined = not yet resolved; null = disabled (no key / offline / error).
let cached: MarginMeter | null | undefined;

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
    });
  } catch {
    cached = null;
  }
  return cached;
}
