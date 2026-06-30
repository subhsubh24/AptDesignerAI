import { describe, it, expect, vi, beforeEach } from "vitest";

// planCorrections reaches the LLM through getProvider("validation").chat, then
// schema-validates the result. Mock the provider factory so we drive the
// success / schema-fail / throw branches without a real model call.
const mockChat = vi.fn();
vi.mock("@/lib/ai/provider-factory", () => ({
  getProvider: () => ({ chat: mockChat }),
}));

import { planCorrections, type CorrectionPlannerInput } from "@/lib/agents/correction-planner";
import { DETERMINISTIC_SEED } from "@/lib/ai/determinism";
import type { RequirementValidationResult } from "@/lib/agents/requirement-validator";

function chatResponse(content: string) {
  return {
    content,
    usage: { input_tokens: 80, output_tokens: 30, thinking_tokens: 10 },
    model: "gemini-test",
  };
}

const AUDIT: RequirementValidationResult = {
  overall_alignment: 6.5,
  coverage: { score: 7, missing_categories: ["pendant_light"], uncovered_requirements: [] },
  spec_matches: [
    { category: "area_rug", matches: false, match_score: 4, gaps: ["size 6x9 vs spec 8x10"], reasoning: "too small" },
  ],
  diagnosis_solving: { score: 6, problems_addressed: [], problems_unaddressed: ["underlit dining area"], explanation: "" },
  issues: ["The rug is 6x9 but should be 8x10"],
  suggestions: ["Search for a larger rug"],
};

const VALID_PLAN = JSON.stringify({
  diagnosis: "Rug is undersized and the dining area lacks a pendant.",
  actions: [
    {
      type: "re_search_category",
      category: "area_rug",
      reason: "Top pick is 6x9; spec requires 8x10",
      queries_by_tier: { budget: [], balanced: ["8x10 wool area rug ivory"], high_end: [] },
      priority: "high",
    },
  ],
  iterate_again: true,
  expected_gain: 2,
});

function baseInput(overrides: Partial<CorrectionPlannerInput> = {}): CorrectionPlannerInput {
  return {
    roomType: "living_room",
    budgetMode: "balanced",
    audit: AUDIT,
    categoryState: {
      area_rug: { topPickTitle: "Small Jute Rug", topPickPrice: 180, topPickScore: 4.2, productCount: 3, tiersCovered: ["balanced"] },
    },
    iteration: 0,
    maxIterations: 3,
    ...overrides,
  };
}

function lastPromptText(): string {
  const arg = mockChat.mock.calls[0][0] as {
    messages: Array<{ content: Array<{ type: string; text?: string }> }>;
  };
  return arg.messages[0].content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
}

describe("planCorrections", () => {
  beforeEach(() => {
    mockChat.mockReset();
  });

  it("returns the validated correction plan with token usage", async () => {
    mockChat.mockResolvedValue(chatResponse(VALID_PLAN));

    const result = await planCorrections(baseInput());

    expect(result.success).toBe(true);
    if (!result.success || !result.data) throw new Error("expected success with data");
    expect(result.data.actions).toHaveLength(1);
    expect(result.data.actions[0].type).toBe("re_search_category");
    expect(result.data.iterate_again).toBe(true);
    expect(result.data.expected_gain).toBe(2);
    expect(result.tokensUsed).toBe(120); // 80 + 30 + 10
    expect(result.model).toBeTruthy();
  });

  it("passes the deterministic seed + cheap thinking on the LLM call", async () => {
    mockChat.mockResolvedValue(chatResponse(VALID_PLAN));

    await planCorrections(baseInput());

    const arg = mockChat.mock.calls[0][0] as {
      seed?: number;
      thinkingConfig?: { thinkingLevel?: string };
    };
    expect(arg.seed).toBe(DETERMINISTIC_SEED);
    expect(arg.thinkingConfig?.thinkingLevel).toBe("low");
  });

  it("includes the grounding/tools section by default but omits it when tools are disabled", async () => {
    mockChat.mockResolvedValue(chatResponse(VALID_PLAN));

    await planCorrections(baseInput());
    expect(lastPromptText()).toContain("GROUNDING — YOU HAVE GOOGLE SEARCH");

    mockChat.mockReset();
    mockChat.mockResolvedValue(chatResponse(VALID_PLAN));
    await planCorrections(baseInput({ enableTools: false }));
    expect(lastPromptText()).not.toContain("GROUNDING — YOU HAVE GOOGLE SEARCH");
  });

  it("accepts an 'accept' action plan (no re-search)", async () => {
    mockChat.mockResolvedValue(
      chatResponse(
        JSON.stringify({
          diagnosis: "Alignment already strong.",
          actions: [{ type: "accept", reason: "Alignment 8.7 exceeds target" }],
          iterate_again: false,
          expected_gain: 0,
        }),
      ),
    );

    const result = await planCorrections(baseInput());

    expect(result.success).toBe(true);
    if (!result.success || !result.data) throw new Error("expected success with data");
    expect(result.data.actions[0].type).toBe("accept");
  });

  it("fails (not throws) when the response does not match the schema", async () => {
    mockChat.mockResolvedValue(chatResponse(JSON.stringify({ diagnosis: "x" }))); // missing actions

    const result = await planCorrections(baseInput());

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/schema/i);
  });

  it("fails open (success=false) when the LLM call errors", async () => {
    mockChat.mockRejectedValue(new Error("model unavailable"));

    const result = await planCorrections(baseInput());

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
