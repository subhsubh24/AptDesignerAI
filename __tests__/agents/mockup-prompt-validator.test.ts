import { describe, it, expect, vi, beforeEach } from "vitest";

// validateMockupPrompt reaches the LLM through getProvider("mockup_prompt").chat
// (wrapped in withRetry), then schema-validates the audit. Mock the provider
// factory so we drive the success / schema-fail / throw branches and check the
// prompt construction + determinism contract without a real model call.
const mockChat = vi.fn();
vi.mock("@/lib/ai/provider-factory", () => ({
  getProvider: () => ({ chat: mockChat }),
}));

import { validateMockupPrompt, type MockupPromptValidatorInput } from "@/lib/agents/mockup-prompt-validator";
import { DETERMINISTIC_SEED } from "@/lib/ai/determinism";

function chatResponse(content: string) {
  return {
    content,
    usage: { input_tokens: 60, output_tokens: 25, thinking_tokens: 5 },
    model: "gemini-test",
  };
}

const VALID_AUDIT = JSON.stringify({
  prompt_score: 8,
  completeness: { score: 9, missing_products: [] },
  spec_fidelity: { score: 8, vague_descriptions: [] },
  placement: { score: 7, missing_placements: [] },
  architectural_grounding: { score: 8, notes: "walls + window referenced" },
  issues: [],
});

function baseInput(overrides: Partial<MockupPromptValidatorInput> = {}): MockupPromptValidatorInput {
  return {
    prompt: "A cozy living room with a sofa.",
    products: [
      {
        category: "sofa",
        title: "Cognac Leather Sofa",
        materials: ["leather"],
        colors: ["cognac"],
        dimensions: "84x36x33in",
      },
    ],
    placementMap: { sofa: "against the north wall" },
    roomType: "living_room",
    designDirection: "warm mid-century",
    ...overrides,
  };
}

/** Pull the text block out of the first chat call's user message. */
function promptText(): string {
  const arg = mockChat.mock.calls[0][0] as {
    messages: Array<{ content: Array<{ type: string; text?: string }> }>;
  };
  return arg.messages[0].content
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("\n");
}

describe("validateMockupPrompt", () => {
  beforeEach(() => {
    mockChat.mockReset();
  });

  it("parses a well-formed audit and returns success with token usage + model", async () => {
    mockChat.mockResolvedValue(chatResponse(VALID_AUDIT));

    const result = await validateMockupPrompt(baseInput());

    expect(result.success).toBe(true);
    if (!result.success || !result.data) throw new Error("expected success with data");
    expect(result.data.prompt_score).toBe(8);
    expect(result.data.completeness.score).toBe(9);
    expect(result.tokensUsed).toBe(90); // 60 + 25 + 5
    expect(typeof result.model).toBe("string");
    expect(result.model && result.model.length).toBeGreaterThan(0);
  });

  it("passes the deterministic seed, cheap thinking, and a response schema", async () => {
    mockChat.mockResolvedValue(chatResponse(VALID_AUDIT));

    await validateMockupPrompt(baseInput());

    expect(mockChat).toHaveBeenCalledTimes(1);
    const arg = mockChat.mock.calls[0][0] as {
      seed?: number;
      thinkingConfig?: { thinkingLevel?: string };
      responseSchema?: unknown;
    };
    expect(arg.seed).toBe(DETERMINISTIC_SEED);
    expect(arg.thinkingConfig?.thinkingLevel).toBe("low");
    expect(arg.responseSchema).toBeTruthy();
  });

  it("formats the product specs, placement map, and design direction into the prompt", async () => {
    mockChat.mockResolvedValue(chatResponse(VALID_AUDIT));

    await validateMockupPrompt(baseInput());

    const prompt = promptText();
    expect(prompt).toContain("[sofa]");
    expect(prompt).toContain("Cognac Leather Sofa");
    expect(prompt).toContain("materials: leather");
    expect(prompt).toContain("colors: cognac");
    expect(prompt).toContain("dims: 84x36x33in");
    expect(prompt).toContain("against the north wall");
    expect(prompt).toContain("warm mid-century");
  });

  it("renders the empty-state fallbacks when there are no products or placement map", async () => {
    mockChat.mockResolvedValue(chatResponse(VALID_AUDIT));

    await validateMockupPrompt(baseInput({ products: [], placementMap: undefined, designDirection: undefined }));

    const prompt = promptText();
    expect(prompt).toContain("(none)"); // empty product list
    expect(prompt).toContain("(no explicit placement map)");
    expect(prompt).toContain("(none provided)"); // missing design direction
  });

  it("fails (not throws) when the response does not match the schema", async () => {
    // Missing the required nested score objects.
    mockChat.mockResolvedValue(chatResponse(JSON.stringify({ prompt_score: 5 })));

    const result = await validateMockupPrompt(baseInput());

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/schema/i);
  });

  it("fails open (success=false, no throw) when the LLM call errors", async () => {
    mockChat.mockRejectedValue(new Error("model unavailable"));

    const result = await validateMockupPrompt(baseInput());

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(mockChat).toHaveBeenCalled();
  });
});
