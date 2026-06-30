import { describe, it, expect, vi, beforeEach } from "vitest";

// planCategories makes a geminiProvider.chat call (structured + tools), with an
// in-call fallback to a tools-only chat if the structured variant is rejected,
// then schema-validates the result. Mock the provider to drive each branch.
vi.mock("@/lib/ai/gemini", () => ({
  geminiProvider: { chat: vi.fn() },
}));

import { planCategories, type CategoryPlannerInput } from "@/lib/agents/category-planner";
import { geminiProvider } from "@/lib/ai/gemini";
import { DETERMINISTIC_SEED } from "@/lib/ai/determinism";

const mockChat = geminiProvider.chat as unknown as ReturnType<typeof vi.fn>;

function chatResponse(content: string) {
  return {
    content,
    usage: { input_tokens: 100, output_tokens: 40, thinking_tokens: 10 },
    model: "gemini-test",
  };
}

const VALID_PLAN = JSON.stringify({
  reasoning: "Room is dark and cold; baseline missed lighting and soft texture.",
  categories: [
    { category: "area_rug", priority: "high", reason: "cold and one-note → soft texture", agent_added: true },
    { category: "sofa", priority: "medium", reason: "baseline seating need", agent_added: false },
  ],
  dropped_from_missing: [{ category: "dining_table", reason: "user is keeping their farmhouse table" }],
});

function baseInput(overrides: Partial<CategoryPlannerInput> = {}): CategoryPlannerInput {
  return {
    roomType: "living_room",
    budgetMode: "balanced",
    missingCategories: ["sofa", "dining_table"],
    keepItems: [],
    replaceItems: [],
    priorities: [],
    ...overrides,
  };
}

describe("planCategories", () => {
  beforeEach(() => {
    mockChat.mockReset();
  });

  it("returns the validated plan with token usage on a well-formed response", async () => {
    mockChat.mockResolvedValue(chatResponse(VALID_PLAN));

    const result = await planCategories(baseInput());

    expect(result.success).toBe(true);
    if (!result.success || !result.data) throw new Error("expected success with data");
    expect(result.data.categories).toHaveLength(2);
    expect(result.data.categories.find((c) => c.category === "area_rug")?.agent_added).toBe(true);
    expect(result.data.dropped_from_missing[0].category).toBe("dining_table");
    expect(result.tokensUsed).toBe(150); // 100 + 40 + 10
    expect(result.model).toBeTruthy();
  });

  it("passes the deterministic seed + cheap thinking and requests structured output first", async () => {
    mockChat.mockResolvedValue(chatResponse(VALID_PLAN));

    await planCategories(baseInput());

    expect(mockChat).toHaveBeenCalledTimes(1);
    const arg = mockChat.mock.calls[0][0] as {
      seed?: number;
      thinkingConfig?: { thinkingLevel?: string };
      responseSchema?: unknown;
    };
    expect(arg.seed).toBe(DETERMINISTIC_SEED);
    expect(arg.thinkingConfig?.thinkingLevel).toBe("low");
    expect(arg.responseSchema).toBeDefined();
  });

  it("falls back to a tools-only (no schema) call when structured output is rejected", async () => {
    mockChat
      .mockRejectedValueOnce(new Error("model snapshot rejects responseSchema with tools"))
      .mockResolvedValueOnce(chatResponse(VALID_PLAN));

    const result = await planCategories(baseInput());

    expect(result.success).toBe(true);
    expect(mockChat).toHaveBeenCalledTimes(2);
    // The fallback call must drop responseSchema (tools-only), still keeping the seed.
    const fallbackArg = mockChat.mock.calls[1][0] as { responseSchema?: unknown; seed?: number };
    expect(fallbackArg.responseSchema).toBeUndefined();
    expect(fallbackArg.seed).toBe(DETERMINISTIC_SEED);
  });

  it("fails (not throws) when the response does not match the schema", async () => {
    mockChat.mockResolvedValue(chatResponse(JSON.stringify({ reasoning: "x" }))); // missing categories

    const result = await planCategories(baseInput());

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/schema/i);
  });

  it("fails open (success=false) when both the structured and fallback calls error", async () => {
    mockChat.mockRejectedValue(new Error("model unavailable"));

    const result = await planCategories(baseInput());

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
