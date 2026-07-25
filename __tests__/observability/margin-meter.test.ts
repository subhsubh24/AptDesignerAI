import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Margin meter is the ONLY thing that egresses per-call LLM economics to an
 * external ingest API. Its three fail-safe guarantees (no key => disabled;
 * hermetic CI/E2E => never construct; construction error => null) are what keep
 * telemetry from leaking during the cassette-based journey suite or crashing the
 * host. These tests pin that gate so a mutation can't silently re-enable egress.
 *
 * getMeter() memoises at module scope, so each case resets the module registry
 * and re-imports after stubbing the env.
 */

async function freshGetMeter() {
  vi.resetModules();
  const mod = await import("@/lib/observability/margin-meter");
  return mod.getMeter;
}

beforeEach(() => {
  // Force the "online" baseline: no CI/E2E context. Individual cases override.
  vi.stubEnv("CI", "");
  vi.stubEnv("E2E_AUTH_STACK", "");
  vi.stubEnv("MARGIN_INGEST_KEY", "");
  vi.stubEnv("MARGIN_INGEST_URL", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getMeter (Margin egress gate)", () => {
  it("is disabled (null) when no ingest key is set", async () => {
    const getMeter = await freshGetMeter();
    expect(getMeter()).toBeNull();
  });

  it("refuses to construct under CI even when a key is present", async () => {
    vi.stubEnv("MARGIN_INGEST_KEY", "test-key");
    vi.stubEnv("CI", "1");
    const getMeter = await freshGetMeter();
    expect(getMeter()).toBeNull();
  });

  it("refuses to construct under the hermetic E2E auth stack even with a key", async () => {
    vi.stubEnv("MARGIN_INGEST_KEY", "test-key");
    vi.stubEnv("E2E_AUTH_STACK", "1");
    const getMeter = await freshGetMeter();
    expect(getMeter()).toBeNull();
  });

  it("returns a working meter when a key is set and not in a hermetic context", async () => {
    vi.stubEnv("MARGIN_INGEST_KEY", "test-key");
    const getMeter = await freshGetMeter();
    const meter = getMeter();
    expect(meter).not.toBeNull();
    // A real meter, not a stub — but constructing it opens NO socket (recordCall
    // does), so this asserts the surface without any network egress.
    expect(typeof meter?.recordCall).toBe("function");
    expect(typeof meter?.recordOutcome).toBe("function");
  });

  it("memoises the resolved meter (same instance across calls, resolved once)", async () => {
    vi.stubEnv("MARGIN_INGEST_KEY", "test-key");
    const getMeter = await freshGetMeter();
    expect(getMeter()).toBe(getMeter());
  });

  it("never throws — returns null rather than propagating a construction error", async () => {
    // No key => the guarded path returns null; the call itself must be safe.
    const getMeter = await freshGetMeter();
    expect(() => getMeter()).not.toThrow();
  });
});

/**
 * WIRE FORMAT: `operation` (the supply-chain STEP label the graph groups on),
 * `reasoning_tokens` and `substrate` are what make an emit decomposable — without
 * them Margin sees an undifferentiated blob of spend. They are native SDK fields
 * as of margin-meter@0.2.0; the 0.1.0 build dropped them, which is exactly the
 * silent under-reporting the version bump fixed. These tests capture the actual
 * POSTed payload (by stubbing fetch) so a dependency regression that stops
 * forwarding a field fails HERE rather than quietly corrupting the economics.
 */
describe("getMeter operation + session (supply-chain wire format)", () => {
  async function meterWithCapturedPosts() {
    vi.stubEnv("MARGIN_INGEST_KEY", "test-key");
    vi.stubEnv("MARGIN_INGEST_URL", "http://ingest.test");
    const posts: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: { body: string }) => {
      posts.push({ url: String(url), body: JSON.parse(init.body) });
      return { status: 200, json: async () => ({ call_id: "c", source: "aptdesigner" }) } as unknown as Response;
    }));
    const getMeter = await freshGetMeter();
    const meter = getMeter();
    expect(meter).not.toBeNull();
    return { meter: meter!, posts };
  }

  it("injects `operation` and `session_id` into the outbound /calls payload", async () => {
    const { meter, posts } = await meterWithCapturedPosts();
    await meter.recordCall({
      workflowId: "aptdesigner-search",
      provider: "google",
      model: "gemini-x",
      operation: "fit-scoring",
      sessionId: "room-1",
    });
    expect(posts).toHaveLength(1);
    expect(posts[0].url).toBe("http://ingest.test/api/ingest/calls");
    expect(posts[0].body).toMatchObject({
      workflow_id: "aptdesigner-search",
      operation: "fit-scoring",
      session_id: "room-1",
    });
  });

  it("carries the reasoning-token split and the routing substrate onto the wire", async () => {
    const { meter, posts } = await meterWithCapturedPosts();
    // A HIGH-thinking Gemini call: 900 output tokens of which 700 were hidden
    // thinking. Without `reasoning_tokens` the emit looks identical to a call
    // that did no thinking at all, so the thinking-budget lever — the single
    // biggest cost knob under the LLM cost contract — cannot be measured.
    await meter.recordCall({
      workflowId: "aptdesigner-search",
      provider: "google",
      model: "gemini-x",
      inputTokens: 100,
      outputTokens: 900,
      reasoningTokens: 700,
      substrate: "direct",
    });
    expect(posts[0].body).toMatchObject({
      output_tokens: 900,
      reasoning_tokens: 700,
      substrate: "direct",
    });
  });

  it("omits the reasoning split on a non-reasoning call rather than sending a zero", async () => {
    const { meter, posts } = await meterWithCapturedPosts();
    await meter.recordCall({
      workflowId: "w",
      provider: "p",
      model: "m",
      outputTokens: 40,
      reasoningTokens: 0,
    });
    // A cheap flash-lite call did no thinking; an explicit 0 and an absent field
    // mean the same thing, and the SDK sends neither.
    expect(posts[0].body).not.toHaveProperty("reasoning_tokens");
  });

  it("omits `operation` when the caller didn't set one", async () => {
    const { meter, posts } = await meterWithCapturedPosts();
    await meter.recordCall({ workflowId: "w", provider: "p", model: "m", sessionId: "room-1" });
    expect(posts[0].body).not.toHaveProperty("operation");
  });

  it("links N refine turns under ONE session and keeps each call's own operation", async () => {
    const { meter, posts } = await meterWithCapturedPosts();
    // A realistic journey slice: one search + three refine turns, all one room.
    await meter.recordCall({ workflowId: "w", provider: "p", model: "m", operation: "search", sessionId: "room-42" });
    for (let t = 0; t < 3; t++) {
      await meter.recordCall({ workflowId: "w", provider: "p", model: "m", operation: "refine-turn", sessionId: "room-42" });
    }
    // Every emit carries the SHARED session, so the graph links them into a chain.
    expect(posts.every((p) => p.body.session_id === "room-42")).toBe(true);
    // The operations are the supply-chain nodes: one "search", three "refine-turn".
    const ops = posts.map((p) => p.body.operation);
    expect(ops).toEqual(["search", "refine-turn", "refine-turn", "refine-turn"]);
  });

  it("keeps each concurrent emit's operation correct (no cross-talk)", async () => {
    const { meter, posts } = await meterWithCapturedPosts();
    // Fire back-to-back without awaiting between — the operation slot must not
    // bleed between calls (recordCall -> transport.post runs synchronously).
    await Promise.all([
      meter.recordCall({ workflowId: "w", provider: "p", model: "m", operation: "search", sessionId: "s" }),
      meter.recordCall({ workflowId: "w", provider: "p", model: "m", operation: "rerank", sessionId: "s" }),
      meter.recordCall({ workflowId: "w", provider: "p", model: "m", operation: "design-render", sessionId: "s" }),
    ]);
    const ops = posts.map((p) => p.body.operation).sort();
    expect(ops).toEqual(["design-render", "rerank", "search"]);
  });
});
