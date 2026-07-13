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
  CALLS_PATH,
  DEFAULT_INGEST_URL,
  type RecordCallInput,
  type RecordOutcomeInput,
  type IngestResult,
  type Transport,
} from "margin-meter";
import { waitUntil } from "@vercel/functions";

/** A recorded call plus `operation` — the supply-chain STEP label (the graph
 *  NODE). The ingest API accepts it, but the pinned `margin-meter@0.1.0` build's
 *  `recordCall` predates the field and drops it; {@link getMeter} bridges that
 *  by injecting it into the outbound payload (see the operation-injecting
 *  transport below), so callers pass it here exactly like a native field. */
export type MeterCallInput = RecordCallInput & { operation?: string };

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
    // OPERATION BRIDGE: the pinned margin-meter@0.1.0 `recordCall` builds a
    // fixed payload and silently drops unknown fields, so an `operation` passed
    // to it never reaches the ingest API (which DOES accept it). Rather than
    // fork the SDK, we stash each call's operation and inject it into the
    // outbound /api/ingest/calls payload through a wrapping transport. This is
    // race-free: `recordCall → emit → transport.post` runs synchronously with
    // no `await` between the stash and the read, so a single slot holds exactly
    // the current call's operation even under concurrent emits. Injection is
    // skipped when the payload already carries `operation` (forward-compatible
    // with a future SDK that forwards it natively).
    let pendingOperation: string | undefined;
    const inner = new FetchTransport(
      process.env.MARGIN_INGEST_URL || DEFAULT_INGEST_URL,
      EMIT_TIMEOUT_MS,
    );
    const transport: Transport = {
      post: (path, opts) => {
        const op = pendingOperation;
        pendingOperation = undefined;
        if (
          path === CALLS_PATH &&
          op !== undefined &&
          opts.json !== null &&
          typeof opts.json === "object" &&
          (opts.json as Record<string, unknown>).operation === undefined
        ) {
          return inner.post(path, {
            ...opts,
            json: { ...(opts.json as Record<string, unknown>), operation: op },
          });
        }
        return inner.post(path, opts);
      },
    };
    const real = new MarginMeter({
      apiKey: process.env.MARGIN_INGEST_KEY,
      transport,
    });
    const evalMode = Boolean(process.env.MARGIN_SESSION_ID);
    cached = {
      recordCall: (input) => {
        // Stash for the operation-injecting transport (read synchronously below).
        pendingOperation = input.operation;
        const base: MeterCallInput = evalMode
          ? {
              ...input,
              // Explicit per-call values still win over the eval-batch defaults.
              sessionId: input.sessionId ?? process.env.MARGIN_SESSION_ID,
              workflowId: process.env.MARGIN_WORKFLOW_ID || input.workflowId,
            }
          : input;
        // `operation` is not on RecordCallInput in this SDK build; the cast keeps
        // it on the runtime object (harmless to the SDK) for the transport bridge.
        return real.recordCall(base as RecordCallInput);
      },
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
