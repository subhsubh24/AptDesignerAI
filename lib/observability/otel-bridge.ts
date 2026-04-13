/**
 * Optional OpenTelemetry bridge.
 *
 * Dynamically imports `@opentelemetry/api` if it's installed and
 * `OTEL_EXPORTER_OTLP_ENDPOINT` is set. Forwards our lightweight
 * TraceContext objects into real OTel spans so they can be exported to a
 * collector (Tempo, Honeycomb, Jaeger, Datadog, etc.).
 *
 * Keep this thin — the goal is to let users add OTel by installing the
 * package, without this repo requiring it as a dep.
 */

import type { TraceContext } from "./tracing";

type EndSpan = (error?: unknown) => void;

interface Bridge {
  startSpan(ctx: TraceContext): EndSpan;
}

export async function createBridge(): Promise<Bridge | null> {
  try {
    // Dynamic import keeps @opentelemetry/api as an optional peer.
    // Resolved via a variable so TypeScript doesn't try to type-check the
    // missing package at compile time. When the package isn't present,
    // the catch below returns null and the tracing module falls back to
    // its log-only path.
    const moduleName = "@opentelemetry/api";
    const otel = (await import(/* webpackIgnore: true */ moduleName)) as unknown as {
      trace: {
        getTracer: (name: string) => {
          startSpan: (name: string, options?: unknown) => {
            end: () => void;
            setAttribute: (k: string, v: unknown) => void;
            setStatus: (s: { code: number; message?: string }) => void;
            recordException: (e: unknown) => void;
          };
        };
      };
      SpanStatusCode: { OK: number; ERROR: number };
    };

    const tracer = otel.trace.getTracer("apt-designer-ai");

    return {
      startSpan(ctx: TraceContext): EndSpan {
        const span = tracer.startSpan(ctx.name);
        for (const [k, v] of Object.entries(ctx.attributes)) {
          try {
            span.setAttribute(k, v as string | number | boolean);
          } catch {
            /* ignore unsupported attr types */
          }
        }
        span.setAttribute("trace.id", ctx.traceId);
        span.setAttribute("span.id", ctx.spanId);
        if (ctx.parentSpanId) span.setAttribute("parent.span.id", ctx.parentSpanId);

        return (error?: unknown) => {
          if (error) {
            span.recordException(error);
            span.setStatus({
              code: otel.SpanStatusCode.ERROR,
              message: error instanceof Error ? error.message : String(error),
            });
          } else {
            span.setStatus({ code: otel.SpanStatusCode.OK });
          }
          span.end();
        };
      },
    };
  } catch {
    // Package not installed — fall back to log-only tracing.
    return null;
  }
}
