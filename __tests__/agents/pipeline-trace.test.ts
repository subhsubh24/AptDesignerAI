import { describe, it, expect } from "vitest";
import { PipelineTracer } from "@/lib/agents/pipeline-trace";

/**
 * PipelineTracer is a pure observability helper — no LLM/DB/network — so these
 * tests exercise the real class directly. The only non-determinism is the
 * automatic `Date.now()` timestamp, which we assert on shape (a number), never
 * on value.
 */
describe("PipelineTracer", () => {
  it("records session/room identity and starts with an empty event list", () => {
    const t = new PipelineTracer("sess-1", "room-1");
    const trace = t.getTrace();
    expect(trace.sessionId).toBe("sess-1");
    expect(trace.roomId).toBe("room-1");
    expect(trace.events).toEqual([]);
    expect(typeof trace.startedAt).toBe("number");
  });

  it("trace() stamps every event with a numeric timestamp", () => {
    const t = new PipelineTracer("s", "r");
    t.trace({ phase: "search", action: "query" });
    const [e] = t.getTrace().events;
    expect(e.phase).toBe("search");
    expect(e.action).toBe("query");
    expect(typeof e.timestamp).toBe("number");
  });

  it("traceFilter() records a filtered event with product/url/reason", () => {
    const t = new PipelineTracer("s", "r");
    t.traceFilter("quick_score", "p1", "http://x/1", "too-expensive");
    const [e] = t.getTrace().events;
    expect(e).toMatchObject({
      phase: "quick_score",
      action: "filtered",
      productId: "p1",
      url: "http://x/1",
      reason: "too-expensive",
    });
  });

  it("traceScore() records a scored event and preserves metadata", () => {
    const t = new PipelineTracer("s", "r");
    t.traceScore("deep_score", "p2", 0.87, { model: "flash" });
    const [e] = t.getTrace().events;
    expect(e).toMatchObject({
      phase: "deep_score",
      action: "scored",
      productId: "p2",
      score: 0.87,
    });
    expect(e.metadata).toEqual({ model: "flash" });
  });

  it("traceError() extracts the message from an Error and stringifies non-Errors", () => {
    const t = new PipelineTracer("s", "r");
    t.traceError("extract", "http://x/a", new Error("boom"));
    t.traceError("extract", "http://x/b", "plain-string");
    const events = t.getTrace().events;
    expect(events[0]).toMatchObject({
      phase: "extract",
      action: "failed",
      url: "http://x/a",
      reason: "boom",
    });
    expect(events[1].reason).toBe("plain-string");
  });

  it("getSummary() aggregates counts across every phase/action pair", () => {
    const t = new PipelineTracer("s", "r");
    t.trace({ phase: "search", action: "query" });
    t.trace({ phase: "search", action: "query" });
    t.trace({ phase: "search", action: "found" });
    t.trace({ phase: "search", action: "found" });
    t.trace({ phase: "search", action: "found" });
    t.trace({ phase: "screen", action: "passed" });
    t.trace({ phase: "extract", action: "success" });
    t.trace({ phase: "quick_score", action: "filtered" });
    t.trace({ phase: "deep_score", action: "scored" });
    t.trace({ phase: "bundle", action: "evaluated" });
    t.trace({ phase: "bundle", action: "selected" });

    const s = t.getSummary();
    expect(s.searchQueries).toBe(2);
    expect(s.rawUrls).toBe(3);
    expect(s.afterScreen).toBe(1);
    expect(s.extractionSuccesses).toBe(1);
    expect(s.quickScoreFiltered).toBe(1);
    expect(s.deepScored).toBe(1);
    expect(s.bundlesEvaluated).toBe(1);
    expect(s.finalProducts).toBe(1);
  });

  it("getSummary() tallies extraction failure reasons, defaulting a missing reason to 'unknown'", () => {
    const t = new PipelineTracer("s", "r");
    t.trace({ phase: "extract", action: "failed", reason: "timeout" });
    t.trace({ phase: "extract", action: "failed", reason: "timeout" });
    t.trace({ phase: "extract", action: "failed", reason: "404" });
    t.trace({ phase: "extract", action: "failed" }); // no reason -> "unknown"

    const s = t.getSummary();
    expect(s.extractionFailures).toBe(4);
    expect(s.extractionFailureReasons).toEqual({
      timeout: 2,
      "404": 1,
      unknown: 1,
    });
  });

  it("getSummary() returns all-zero counts for an empty trace", () => {
    const s = new PipelineTracer("s", "r").getSummary();
    expect(s).toEqual({
      searchQueries: 0,
      rawUrls: 0,
      afterScreen: 0,
      extractionSuccesses: 0,
      extractionFailures: 0,
      extractionFailureReasons: {},
      quickScoreFiltered: 0,
      deepScored: 0,
      finalProducts: 0,
      bundlesEvaluated: 0,
    });
  });

  it("getTrace() returns a COPY of the events array (mutating it does not corrupt the tracer)", () => {
    const t = new PipelineTracer("s", "r");
    t.trace({ phase: "search", action: "query" });
    const snapshot = t.getTrace();
    snapshot.events.push({ phase: "x", action: "y", timestamp: 0 });
    // The tracer's own event list is unchanged.
    expect(t.getTrace().events).toHaveLength(1);
  });

  it("getProductJourney() returns only events referencing the given productId", () => {
    const t = new PipelineTracer("s", "r");
    t.traceScore("deep_score", "p1", 0.5);
    t.traceFilter("quick_score", "p2", "u", "r");
    t.traceScore("deep_score", "p1", 0.9);
    const journey = t.getProductJourney("p1");
    expect(journey).toHaveLength(2);
    expect(journey.every((e) => e.productId === "p1")).toBe(true);
  });

  it("getFailureReport() lists every failed event with defaulted url/reason", () => {
    const t = new PipelineTracer("s", "r");
    t.traceError("extract", "http://x/a", new Error("boom"));
    t.trace({ phase: "screen", action: "passed" }); // not a failure
    t.trace({ phase: "extract", action: "failed" }); // no url/reason
    const report = t.getFailureReport();
    expect(report).toEqual([
      { phase: "extract", url: "http://x/a", reason: "boom" },
      { phase: "extract", url: "", reason: "unknown" },
    ]);
  });
});
