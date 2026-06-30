import { describe, it, expect, vi, beforeEach } from "vitest";

// runProductIdentifier makes a single geminiProvider.chat call, parses the
// response, then enforces tiered confidence floors. Mock the provider to drive
// the happy path, the floor filtering, schema-fail + LLM-error fail-open, and
// the determinism contract. The brand allow-list + prompt builder are real.
vi.mock("@/lib/ai/gemini", () => ({
  geminiProvider: { chat: vi.fn() },
}));

import { runProductIdentifier, type IdentifyInput } from "@/lib/agents/product-identifier";
import { geminiProvider } from "@/lib/ai/gemini";
import { DETERMINISTIC_SEED } from "@/lib/ai/determinism";
import { isAllowListedBrand } from "@/lib/constants/identifiable-brands";
import type { RetrievalPrior } from "@/lib/types/schemas";

const mockChat = geminiProvider.chat as unknown as ReturnType<typeof vi.fn>;

type Cand = { brand: string; model: string; confidence: number; category?: string };

function chatResponse(candidates: Cand[]) {
  return {
    content: JSON.stringify({ candidates }),
    usage: { input_tokens: 100, output_tokens: 40, thinking_tokens: 10 },
    model: "gemini-identifier",
  };
}

const priors: RetrievalPrior[] = [{ brand: "IKEA", model: "EKTORP", similarity: 0.8 }];

function baseInput(overrides: Partial<IdentifyInput> = {}): IdentifyInput {
  return {
    roomImageUrl: "https://cdn/room.jpg",
    box: { x: 0.1, y: 0.1, w: 0.3, h: 0.3 },
    label: "sofa",
    priors,
    roomType: "living_room",
    ...overrides,
  };
}

describe("runProductIdentifier", () => {
  beforeEach(() => {
    mockChat.mockReset();
  });

  it("returns candidates above the floors, echoes priors, sums tokens, keeps the response model", async () => {
    mockChat.mockResolvedValue(
      chatResponse([{ brand: "IKEA", model: "EKTORP", confidence: 0.9, category: "sofa" }]),
    );

    const result = await runProductIdentifier(baseInput());

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].brand).toBe("IKEA");
    expect(result.priors).toBe(priors);
    expect(result.tokensUsed).toBe(150); // 100 + 40 + 10
    expect(result.model).toBe("gemini-identifier");
  });

  it("passes the deterministic seed, cheap thinking, schema, and ultra-high media", async () => {
    mockChat.mockResolvedValue(chatResponse([]));

    await runProductIdentifier(baseInput());

    const arg = mockChat.mock.calls[0][0] as {
      seed?: number;
      thinkingConfig?: { thinkingLevel?: string };
      responseSchema?: unknown;
      mediaResolution?: string;
    };
    expect(arg.seed).toBe(DETERMINISTIC_SEED);
    expect(arg.thinkingConfig?.thinkingLevel).toBe("low");
    expect(arg.responseSchema).toBeTruthy();
    expect(arg.mediaResolution).toBe("ultra_high");
  });

  it("drops any candidate below the absolute user-prompt floor (0.40)", async () => {
    // IKEA is allow-listed but still must clear the absolute 0.40 floor.
    expect(isAllowListedBrand("IKEA")).toBe(true);
    mockChat.mockResolvedValue(
      chatResponse([{ brand: "IKEA", model: "EKTORP", confidence: 0.3 }]),
    );

    const result = await runProductIdentifier(baseInput());

    expect(result.candidates).toHaveLength(0);
  });

  it("keeps an in-list brand between the absolute floor and the in-list floor (soft enforcement)", async () => {
    // 0.55 is above USER_PROMPT_FLOOR (0.40) but below MIN_CONFIDENCE_IN_LIST
    // (0.70) — the UI routes it through a confirmation pill, so it must survive.
    mockChat.mockResolvedValue(
      chatResponse([{ brand: "IKEA", model: "STRANDMON", confidence: 0.55 }]),
    );

    const result = await runProductIdentifier(baseInput());

    expect(result.candidates.map((c) => c.model)).toEqual(["STRANDMON"]);
  });

  it("guards out-of-list brands: drops them under 0.50, keeps them at/above it", async () => {
    const unknownBrand = "Generic Unbranded Co";
    expect(isAllowListedBrand(unknownBrand)).toBe(false);
    mockChat.mockResolvedValue(
      chatResponse([
        { brand: unknownBrand, model: "Mystery Sofa", confidence: 0.45 }, // dropped (< 0.50, out of list)
        { brand: unknownBrand, model: "Other Sofa", confidence: 0.6 }, // kept (>= 0.50)
      ]),
    );

    const result = await runProductIdentifier(baseInput());

    expect(result.candidates.map((c) => c.model)).toEqual(["Other Sofa"]);
  });

  it("fails open (empty candidates, priors echoed) when the response fails the schema", async () => {
    // Missing required model field → schema parse throws → caught.
    mockChat.mockResolvedValue({
      content: JSON.stringify({ candidates: [{ brand: "IKEA", confidence: 0.9 }] }),
      usage: { input_tokens: 5, output_tokens: 5, thinking_tokens: 0 },
      model: "gemini-identifier",
    });

    const result = await runProductIdentifier(baseInput());

    expect(result.candidates).toEqual([]);
    expect(result.priors).toBe(priors);
    expect(result.tokensUsed).toBe(0);
    expect(typeof result.model).toBe("string");
    expect(result.model.length).toBeGreaterThan(0);
  });

  it("fails open when the LLM call throws", async () => {
    mockChat.mockRejectedValue(new Error("model unavailable"));

    const result = await runProductIdentifier(baseInput());

    expect(result.candidates).toEqual([]);
    expect(result.priors).toBe(priors);
    expect(result.tokensUsed).toBe(0);
  });
});
