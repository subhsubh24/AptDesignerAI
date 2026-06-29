import { describe, it, expect, vi, beforeEach } from "vitest";

const mockChat = vi.fn();
vi.mock("@/lib/ai/provider-factory", () => ({
  getProvider: () => ({ chat: mockChat }),
}));

import { summarizeRefineChanges } from "@/lib/agents/refine-summarizer";

function mockResponse(
  content: string,
  usage: { input_tokens?: number; output_tokens?: number; thinking_tokens?: number } = {},
) {
  mockChat.mockResolvedValueOnce({
    content,
    usage: { input_tokens: 0, output_tokens: 0, thinking_tokens: 0, ...usage },
  });
}

const baseInput = {
  feedback: "Make it cozier and swap the sofa for something in a warmer fabric.",
  system: "You design warm, editorial interiors.",
  priorAnalysis: {
    design_direction: "cool minimalist",
    style_name: "Scandinavian",
    recommended_palette: ["white", "grey"],
    recommended_materials: ["oak", "linen"],
    what_should_go: ["black metal stand"],
    what_it_needs: [
      { category: "sofa", description: "grey 3-seater", specs: "78in", priority: "high", noise: "drop me" },
    ],
    // a field slim() must NOT forward to the prompt
    raw_internal_debug: "SHOULD_NOT_APPEAR_IN_PROMPT",
  },
  newAnalysis: {
    design_direction: "warm editorial",
    style_name: "Modern Organic",
    recommended_palette: ["terracotta", "cream"],
    recommended_materials: ["walnut", "bouclé"],
    what_should_go: ["black metal stand"],
    what_it_needs: [
      { category: "sofa", description: "cream bouclé 3-seater", specs: "80in", priority: "high" },
    ],
  },
};

describe("summarizeRefineChanges", () => {
  beforeEach(() => {
    mockChat.mockReset();
  });

  it("returns the trimmed model summary and sums all token buckets on the happy path", async () => {
    mockResponse("  Swapped the grey sofa for a cream bouclé and warmed the palette to terracotta.  ", {
      input_tokens: 120,
      output_tokens: 30,
      thinking_tokens: 10,
    });

    const result = await summarizeRefineChanges(baseInput);

    expect(result.summary).toBe(
      "Swapped the grey sofa for a cream bouclé and warmed the palette to terracotta.",
    );
    // input + output + thinking are all counted
    expect(result.tokens).toBe(160);
    expect(mockChat).toHaveBeenCalledTimes(1);
  });

  it("sends a low-thinking request that embeds the client feedback and only the slimmed analysis fields", async () => {
    mockResponse("ok", { input_tokens: 1 });

    await summarizeRefineChanges(baseInput);

    const callArg = mockChat.mock.calls[0][0] as {
      thinkingConfig: { thinkingLevel: string };
      system: string;
      messages: Array<{ role: string; content: Array<{ type: string; text: string }> }>;
    };
    expect(callArg.thinkingConfig.thinkingLevel).toBe("low");
    expect(callArg.system).toBe(baseInput.system);

    const prompt = callArg.messages[0].content[0].text;
    // client request is embedded verbatim
    expect(prompt).toContain(baseInput.feedback);
    // slim() keeps the key design fields…
    expect(prompt).toContain("warm editorial");
    expect(prompt).toContain("Modern Organic");
    // …trims what_it_needs to category/description/specs only (priority dropped)…
    expect(prompt).toContain("cream bouclé 3-seater");
    expect(prompt).not.toContain('"priority"');
    // …and never forwards unrelated/noisy fields
    expect(prompt).not.toContain("SHOULD_NOT_APPEAR_IN_PROMPT");
  });

  it("falls back to a safe summary but still reports tokens when the model returns empty text", async () => {
    mockResponse("   ", { input_tokens: 50, output_tokens: 0, thinking_tokens: 5 });

    const result = await summarizeRefineChanges(baseInput);

    expect(result.summary).toBe("Updated the assessment based on your request.");
    expect(result.tokens).toBe(55);
  });

  it("falls back with zero tokens when the model call throws a non-retryable error", async () => {
    mockChat.mockRejectedValue(new Error("invalid request: bad input"));

    const result = await summarizeRefineChanges(baseInput);

    expect(result.summary).toBe("Updated the assessment based on your request.");
    expect(result.tokens).toBe(0);
  });
});
