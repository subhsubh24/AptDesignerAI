import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/ai/provider-factory", () => ({
  getProvider: () => ({
    chat: vi.fn().mockResolvedValue({
      text: JSON.stringify({ reasoning: "test", verdict: "standard" }),
      content: [],
      usage: { input_tokens: 10, output_tokens: 5, thinking_tokens: 0 },
    }),
  }),
}));

vi.mock("@/lib/logging/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe("classifyComplexity", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns a valid verdict for standard input", async () => {
    const { classifyComplexity } = await import("@/lib/ai/complexity-router");
    const result = await classifyComplexity(
      {
        roomType: "bedroom",
        itemCount: 5,
        hasFloorPlan: true,
        roomCount: 3,
        userTextLength: 100,
        budgetMode: "balanced",
      },
      "room-1",
      "session-1",
    );

    expect(result.verdict).toBe("standard");
    expect(result.modelTier).toBe("base");
    expect(result.thinkingFloor).toBe("low");
  });

  it("caches results per room+session key", async () => {
    const { classifyComplexity } = await import("@/lib/ai/complexity-router");
    const signals = {
      roomType: "bedroom",
      itemCount: 5,
      hasFloorPlan: false,
      roomCount: 2,
      userTextLength: 50,
      budgetMode: "budget",
    };

    const r1 = await classifyComplexity(signals, "room-2", "session-2");
    const r2 = await classifyComplexity(signals, "room-2", "session-2");
    expect(r1).toBe(r2);
  });

  it("maps a 'simple' verdict to the base tier with a low thinking floor", async () => {
    // The default top-level mock returns content:[] → JSON.parse throws → the
    // CATCH fallback. To exercise the SUCCESS path we must return real JSON in
    // `content` (what the code parses). Asserting reasoning is passed through
    // (not "classifier failed") proves the parse+normalize branch ran, not catch.
    vi.doMock("@/lib/ai/provider-factory", () => ({
      getProvider: () => ({
        chat: vi.fn().mockResolvedValue({
          content: JSON.stringify({ reasoning: "tiny studio, few items", verdict: "simple" }),
          usage: { input_tokens: 10, output_tokens: 5, thinking_tokens: 0 },
        }),
      }),
    }));

    const { classifyComplexity } = await import("@/lib/ai/complexity-router");
    const result = await classifyComplexity(
      { roomType: "closet", itemCount: 2, hasFloorPlan: false, roomCount: 1, userTextLength: 0, budgetMode: "budget" },
      "room-simple",
      "session-simple",
    );

    expect(result.verdict).toBe("simple");
    expect(result.modelTier).toBe("base");
    expect(result.thinkingFloor).toBe("low");
    expect(result.reasoning).toBe("tiny studio, few items");
  });

  it("maps a 'complex' verdict to the mid tier with a high thinking floor", async () => {
    vi.doMock("@/lib/ai/provider-factory", () => ({
      getProvider: () => ({
        chat: vi.fn().mockResolvedValue({
          content: JSON.stringify({ reasoning: "multi-room, floor plan, long brief", verdict: "complex" }),
          usage: { input_tokens: 10, output_tokens: 5, thinking_tokens: 0 },
        }),
      }),
    }));

    const { classifyComplexity } = await import("@/lib/ai/complexity-router");
    const result = await classifyComplexity(
      { roomType: "living_room", itemCount: 14, hasFloorPlan: true, roomCount: 4, userTextLength: 800, budgetMode: "premium" },
      "room-complex",
      "session-complex",
    );

    expect(result.verdict).toBe("complex");
    expect(result.modelTier).toBe("mid");
    expect(result.thinkingFloor).toBe("high");
    expect(result.reasoning).toBe("multi-room, floor plan, long brief");
  });

  it("normalizes an unrecognized verdict to 'standard' via the success path (not the catch fallback)", async () => {
    // A drifted/typo'd verdict ("COMPLEX" uppercase) must fall through the
    // ternary to "standard" — but WITHOUT throwing, so the model's reasoning is
    // still surfaced. The distinct reasoning proves normalization, not catch.
    vi.doMock("@/lib/ai/provider-factory", () => ({
      getProvider: () => ({
        chat: vi.fn().mockResolvedValue({
          content: JSON.stringify({ reasoning: "model drift", verdict: "COMPLEX" }),
          usage: { input_tokens: 10, output_tokens: 5, thinking_tokens: 0 },
        }),
      }),
    }));

    const { classifyComplexity } = await import("@/lib/ai/complexity-router");
    const result = await classifyComplexity(
      { roomType: "bedroom", itemCount: 6, hasFloorPlan: true, roomCount: 2, userTextLength: 120, budgetMode: "balanced" },
      "room-drift",
      "session-drift",
    );

    expect(result.verdict).toBe("standard");
    expect(result.modelTier).toBe("base");
    expect(result.thinkingFloor).toBe("low");
    expect(result.reasoning).toBe("model drift");
  });

  it("falls back to standard on parse failure", async () => {
    vi.doMock("@/lib/ai/provider-factory", () => ({
      getProvider: () => ({
        chat: vi.fn().mockRejectedValue(new Error("API error")),
      }),
    }));

    const { classifyComplexity } = await import("@/lib/ai/complexity-router");
    const result = await classifyComplexity(
      {
        roomType: "closet",
        itemCount: 2,
        hasFloorPlan: false,
        roomCount: 1,
        userTextLength: 0,
        budgetMode: "budget",
      },
      "room-3",
      "session-3",
    );

    expect(result.verdict).toBe("standard");
    expect(result.reasoning).toBe("classifier failed");
  });
});
