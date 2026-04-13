import { describe, it, expect } from "vitest";
import { withTrace, withSpan, getCurrentTrace } from "@/lib/observability/tracing";

describe("observability/tracing", () => {
  it("returns undefined outside a trace", () => {
    expect(getCurrentTrace()).toBeUndefined();
  });

  it("creates a new trace id at the root", async () => {
    await withTrace("root", async () => {
      const trace = getCurrentTrace();
      expect(trace).toBeTruthy();
      expect(trace?.traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(trace?.spanId).toMatch(/^[0-9a-f]{16}$/);
      expect(trace?.parentSpanId).toBeNull();
      expect(trace?.name).toBe("root");
    });
  });

  it("propagates trace id across child spans and replaces the span id", async () => {
    await withTrace("outer", async () => {
      const outer = getCurrentTrace()!;
      await withSpan("inner", async () => {
        const inner = getCurrentTrace()!;
        expect(inner.traceId).toBe(outer.traceId);
        expect(inner.spanId).not.toBe(outer.spanId);
        expect(inner.parentSpanId).toBe(outer.spanId);
      });
    });
  });

  it("merges attributes with the parent trace", async () => {
    await withTrace("outer", async () => {
      await withSpan("inner", async () => {
        const inner = getCurrentTrace()!;
        expect(inner.attributes.role).toBe("admin");
        expect(inner.attributes.op).toBe("fetch");
      }, { op: "fetch" });
    }, { role: "admin" });
  });

  it("passes the return value through", async () => {
    const result = await withTrace("trace", async () => 42);
    expect(result).toBe(42);
  });

  it("clears the trace context after the callback resolves", async () => {
    await withTrace("trace", async () => {});
    expect(getCurrentTrace()).toBeUndefined();
  });
});
