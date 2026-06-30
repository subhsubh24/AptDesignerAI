import { describe, it, expect, vi, beforeEach } from "vitest";

// validateRequirements makes a single geminiProvider.chat call and then parses /
// schema-validates the response. Mock the provider so we exercise the
// success / schema-fail / throw branches without a real model call.
vi.mock("@/lib/ai/gemini", () => ({
  geminiProvider: { chat: vi.fn() },
}));

// Tavily is only reached when enableGoogleSearch is set; mock it so an
// accidental call would be observable rather than hitting the network.
vi.mock("@/lib/ai/tavily", () => ({
  tavilySearch: vi.fn(),
}));

import { validateRequirements, type RequirementValidatorInput } from "@/lib/agents/requirement-validator";
import { geminiProvider } from "@/lib/ai/gemini";
import { tavilySearch } from "@/lib/ai/tavily";
import { DETERMINISTIC_SEED } from "@/lib/ai/determinism";
import type { CandidateProduct } from "@/lib/types/database";

const mockChat = geminiProvider.chat as unknown as ReturnType<typeof vi.fn>;
const mockTavily = tavilySearch as unknown as ReturnType<typeof vi.fn>;

function chatResponse(content: string) {
  return {
    content,
    usage: { input_tokens: 10, output_tokens: 20, thinking_tokens: 5 },
    model: "gemini-test",
  };
}

const VALID_RESULT = JSON.stringify({
  overall_alignment: 8.5,
  coverage: { score: 9, missing_categories: [], uncovered_requirements: [] },
  spec_matches: [{ category: "sofa", matches: true, match_score: 9, gaps: [], reasoning: "good fit" }],
  diagnosis_solving: { score: 7, problems_addressed: ["dark corner"], problems_unaddressed: [], explanation: "ok" },
  issues: [],
  suggestions: [],
});

const sofaPick = {
  id: "p1",
  title: "Emerald Velvet Sofa",
  price: 1200,
  materials: ["velvet"],
  colors: ["emerald"],
  dimensions: { width: 84, depth: 36, height: 33, unit: "in" },
  description: "A deep three-seat lounge sofa.",
} as unknown as CandidateProduct;

function baseInput(overrides: Partial<RequirementValidatorInput> = {}): RequirementValidatorInput {
  return {
    roomType: "living_room",
    missingCategories: ["sofa"],
    topPicksByCategory: { sofa: sofaPick },
    ...overrides,
  };
}

/** Pull the text block out of the chat call's user message. */
function lastPromptText(): string {
  const arg = mockChat.mock.calls[0][0] as {
    messages: Array<{ content: Array<{ type: string; text?: string }> }>;
  };
  const content = arg.messages[0].content;
  return content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
}

describe("validateRequirements", () => {
  beforeEach(() => {
    mockChat.mockReset();
    mockTavily.mockReset();
  });

  it("parses a well-formed audit and returns success with token usage", async () => {
    mockChat.mockResolvedValue(chatResponse(VALID_RESULT));

    const result = await validateRequirements(baseInput());

    expect(result.success).toBe(true);
    if (!result.success || !result.data) throw new Error("expected success with data");
    expect(result.data.overall_alignment).toBe(8.5);
    expect(result.data.coverage.score).toBe(9);
    expect(result.data.diagnosis_solving.score).toBe(7);
    expect(result.tokensUsed).toBe(35); // 10 + 20 + 5
    expect(result.model).toBeTruthy();
  });

  it("passes the deterministic seed and cheap thinking on the LLM call", async () => {
    mockChat.mockResolvedValue(chatResponse(VALID_RESULT));

    await validateRequirements(baseInput());

    expect(mockChat).toHaveBeenCalledTimes(1);
    const arg = mockChat.mock.calls[0][0] as {
      seed?: number;
      thinkingConfig?: { thinkingLevel?: string };
    };
    expect(arg.seed).toBe(DETERMINISTIC_SEED);
    expect(arg.thinkingConfig?.thinkingLevel).toBe("low");
  });

  it("formats the top pick (price/materials/colors/dims) into the audit prompt", async () => {
    mockChat.mockResolvedValue(chatResponse(VALID_RESULT));

    await validateRequirements(baseInput());

    const prompt = lastPromptText();
    expect(prompt).toContain("Emerald Velvet Sofa");
    expect(prompt).toContain("$1200");
    expect(prompt).toContain("velvet");
    expect(prompt).toContain("emerald");
    // dimensions are rendered as widthxdepthxheight+unit
    expect(prompt).toContain("84x36x33in");
  });

  it("renders NONE for a category with no pick", async () => {
    mockChat.mockResolvedValue(chatResponse(VALID_RESULT));

    await validateRequirements(
      baseInput({ missingCategories: ["sofa", "rug"], topPicksByCategory: { sofa: sofaPick } }),
    );

    const prompt = lastPromptText();
    expect(prompt).toContain("[rug] → NONE");
  });

  it("fails (not throws) when the response does not match the schema", async () => {
    // Missing the required coverage / diagnosis_solving objects.
    mockChat.mockResolvedValue(chatResponse(JSON.stringify({ overall_alignment: 8 })));

    const result = await validateRequirements(baseInput());

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/schema/i);
  });

  it("fails open (success=false, no throw) when the LLM call errors", async () => {
    mockChat.mockRejectedValue(new Error("model unavailable"));

    const result = await validateRequirements(baseInput());

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("does not reach Tavily when grounding is disabled (default)", async () => {
    mockChat.mockResolvedValue(chatResponse(VALID_RESULT));

    await validateRequirements(baseInput());

    expect(mockTavily).not.toHaveBeenCalled();
  });
});
