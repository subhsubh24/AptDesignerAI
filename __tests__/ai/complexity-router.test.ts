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
