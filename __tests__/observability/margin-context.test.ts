import { describe, expect, it } from "vitest";
import {
  getMarginContext,
  withMarginContext,
  runWithMarginSession,
  withMarginOperation,
  withMarginRetry,
} from "@/lib/observability/margin-context";

/**
 * The journey context is what lets Margin's supply-chain graph reconstruct the
 * REAL multi-step chain: a SHARED sessionId links every call of one design run,
 * and a per-scope `operation` labels each supply-chain node. These tests pin the
 * two behaviors the instrumentation relies on: nested operations inherit the
 * session, and refine turns keep a stable operation under one session.
 */
describe("margin-context (journey linking)", () => {
  it("returns an empty context outside any run (fail-safe, never throws)", () => {
    expect(getMarginContext()).toEqual({});
  });

  it("exposes sessionId + operation to everything inside runWithMarginSession", () => {
    runWithMarginSession("room-1", "search", () => {
      expect(getMarginContext()).toMatchObject({
        sessionId: "room-1",
        operation: "search",
      });
    });
    // Context is torn down after the run.
    expect(getMarginContext()).toEqual({});
  });

  it("nested withMarginOperation overrides operation but INHERITS the session", () => {
    runWithMarginSession("room-1", "search", () => {
      withMarginOperation("fit-scoring", () => {
        const ctx = getMarginContext();
        expect(ctx.sessionId).toBe("room-1"); // still the same journey run
        expect(ctx.operation).toBe("fit-scoring"); // decomposed node
      });
      // The parent operation is restored after the nested scope.
      expect(getMarginContext().operation).toBe("search");
    });
  });

  it("links multiple refine turns under ONE shared session (the loop)", () => {
    const seen: Array<{ sessionId?: string; operation?: string }> = [];
    // Three refine turns of the same room — each opens its own scope, but all
    // share the room session and the "refine-turn" operation, so the graph
    // shows one node whose call count grows per turn.
    for (let turn = 0; turn < 3; turn++) {
      runWithMarginSession("room-42", "refine-turn", () => {
        seen.push({ ...getMarginContext() });
      });
    }
    expect(seen).toHaveLength(3);
    expect(seen.every((c) => c.sessionId === "room-42")).toBe(true);
    expect(seen.every((c) => c.operation === "refine-turn")).toBe(true);
  });

  it("withMarginRetry marks the scope as a retry, inheriting session + operation", () => {
    runWithMarginSession("room-1", "product-research", () => {
      withMarginRetry(() => {
        const ctx = getMarginContext();
        expect(ctx.isRetry).toBe(true);
        expect(ctx.sessionId).toBe("room-1");
        expect(ctx.operation).toBe("product-research");
      });
    });
  });

  it("propagates context across awaits within a run", async () => {
    await runWithMarginSession("room-async", "diagnosis", async () => {
      await Promise.resolve();
      expect(getMarginContext()).toMatchObject({
        sessionId: "room-async",
        operation: "diagnosis",
      });
    });
  });

  it("merges over a parent context without dropping unrelated fields", () => {
    withMarginContext({ sessionId: "s", operation: "a", isRetry: true }, () => {
      withMarginContext({ operation: "b" }, () => {
        expect(getMarginContext()).toEqual({
          sessionId: "s",
          operation: "b",
          isRetry: true,
        });
      });
    });
  });
});
