/**
 * Lightweight distributed tracing for the AI pipeline.
 *
 * Provides a trace/span context via AsyncLocalStorage so every log line,
 * pipeline-trace event, and downstream LLM call can be correlated back to
 * one user request. Callers opt in by wrapping a request in `withTrace`.
 *
 * The module is deliberately self-contained — no runtime dependency on
 * any OpenTelemetry SDK. When `OTEL_EXPORTER_OTLP_ENDPOINT` is set, the
 * otel-bridge module is loaded lazily (via dynamic import) and forwards
 * spans to a real OTel collector. In its absence, traces still flow
 * through the JSON logs and the custom PipelineTracer, so observability
 * degrades gracefully rather than blowing up.
 */

import { AsyncLocalStorage } from "async_hooks";
import crypto from "crypto";

export interface TraceContext {
  /** Hex-encoded 16-byte trace identifier — shared across all spans in the request. */
  traceId: string;
  /** Hex-encoded 8-byte span identifier for the currently active span. */
  spanId: string;
  /** Parent span id (null at the root of the trace). */
  parentSpanId: string | null;
  /** When the current span started (ms since epoch). */
  startedAt: number;
  /** Human-readable label for the span (e.g., "diagnosis-pipeline"). */
  name: string;
  /** Free-form attributes to propagate with every emitted event. */
  attributes: Record<string, unknown>;
}

const storage = new AsyncLocalStorage<TraceContext>();

function newTraceId(): string {
  return crypto.randomBytes(16).toString("hex");
}

function newSpanId(): string {
  return crypto.randomBytes(8).toString("hex");
}

export function getCurrentTrace(): TraceContext | undefined {
  return storage.getStore();
}

/**
 * Run `fn` inside a new root trace span. Any nested `withSpan` calls
 * reuse the same trace id but get their own span id.
 *
 * We intentionally don't throw on errors here — the caller's error
 * handling is unchanged; we only observe.
 */
export async function withTrace<T>(
  name: string,
  fn: () => Promise<T>,
  attributes: Record<string, unknown> = {}
): Promise<T> {
  const existing = storage.getStore();
  const ctx: TraceContext = existing
    ? {
        traceId: existing.traceId,
        spanId: newSpanId(),
        parentSpanId: existing.spanId,
        startedAt: Date.now(),
        name,
        attributes: { ...existing.attributes, ...attributes },
      }
    : {
        traceId: newTraceId(),
        spanId: newSpanId(),
        parentSpanId: null,
        startedAt: Date.now(),
        name,
        attributes,
      };

  const bridge = await getOtelBridge();
  const endSpan = bridge ? bridge.startSpan(ctx) : null;

  try {
    return await storage.run(ctx, fn);
  } catch (err) {
    endSpan?.(err);
    throw err;
  } finally {
    if (endSpan) endSpan();
  }
}

/**
 * Run `fn` inside a child span. Creates a new trace if no parent is active,
 * preserving call-site instrumentation that may or may not be wrapped.
 */
export async function withSpan<T>(
  name: string,
  fn: () => Promise<T>,
  attributes: Record<string, unknown> = {}
): Promise<T> {
  return withTrace(name, fn, attributes);
}

// ─── OpenTelemetry Bridge (lazy) ────────────────────────────────
// We avoid a hard import of @opentelemetry/* so the dependency stays
// optional. When the env is configured, otel-bridge attempts the dynamic
// import; when the package is not installed the bridge returns null and
// we fall back to log-based tracing.

type EndSpan = (error?: unknown) => void;

interface OtelBridge {
  startSpan(ctx: TraceContext): EndSpan;
}

let bridgePromise: Promise<OtelBridge | null> | null = null;

async function getOtelBridge(): Promise<OtelBridge | null> {
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return null;
  if (!bridgePromise) {
    bridgePromise = import("./otel-bridge")
      .then((m) => m.createBridge())
      .catch(() => null);
  }
  return bridgePromise;
}
