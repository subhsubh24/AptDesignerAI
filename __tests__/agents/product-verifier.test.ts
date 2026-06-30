import { describe, it, expect, vi, beforeEach } from "vitest";

// runProductVerifier runs a grounded geminiProvider.chat call (structured first,
// falling back to a text call when grounding+schema can't combine), then
// Zod-validates the enrichment. Mock the provider so we drive the verified /
// threshold / fallback / grounding-source / fail-open branches without a real
// model call. The system + verifier prompts are pure and left real.
vi.mock("@/lib/ai/gemini", () => ({
  geminiProvider: { chat: vi.fn() },
}));

import { runProductVerifier, type VerifyInput } from "@/lib/agents/product-verifier";
import { geminiProvider } from "@/lib/ai/gemini";
import { DETERMINISTIC_SEED } from "@/lib/ai/determinism";
import type { IdentifiedProductCandidate } from "@/lib/types/schemas";

const mockChat = geminiProvider.chat as unknown as ReturnType<typeof vi.fn>;

function chatResponse(content: string, groundingSources?: string[]) {
  return {
    content,
    usage: { input_tokens: 100, output_tokens: 50, thinking_tokens: 10 },
    model: "gemini-test",
    ...(groundingSources
      ? { groundingMetadata: { sources: groundingSources.map((uri) => ({ uri })) } }
      : {}),
  };
}

function candidate(overrides: Partial<IdentifiedProductCandidate> = {}): IdentifiedProductCandidate {
  return {
    brand: "West Elm",
    model: "Andes Sofa",
    variant: null,
    category: "sofa",
    confidence: 0.8,
    evidence: "matched silhouette + leg style",
    distinguishing_features: ["track arm", "boucle"],
    bounding_box: null,
    ...overrides,
  };
}

function baseInput(overrides: Partial<VerifyInput> = {}): VerifyInput {
  return {
    candidate: candidate(),
    roomImageUrl: "https://example.com/room.jpg",
    sourceImageUrl: "https://example.com/crop.jpg",
    priors: [],
    ...overrides,
  };
}

beforeEach(() => {
  mockChat.mockReset();
});

describe("runProductVerifier", () => {
  it("returns a verified, enriched entry on a strong grounded match", async () => {
    mockChat.mockResolvedValue(
      chatResponse(
        JSON.stringify({
          verified: true,
          match_score: 0.92,
          source_urls: ["https://westelm.com/andes"],
          materials: ["boucle"],
          colors: ["ivory"],
        }),
      ),
    );

    const { enriched } = await runProductVerifier(baseInput());

    expect(enriched.verified).toBe(true);
    expect(enriched.confidence).toBe(0.92);
    expect(enriched.source_urls).toContain("https://westelm.com/andes");
    expect(enriched.materials).toEqual(["boucle"]);
    expect(mockChat).toHaveBeenCalledTimes(1);
  });

  it("does NOT flip verified true when match_score is below the 0.75 threshold", async () => {
    mockChat.mockResolvedValue(
      chatResponse(JSON.stringify({ verified: true, match_score: 0.5, source_urls: [] })),
    );

    const { enriched } = await runProductVerifier(baseInput());

    // match_score < MATCH_THRESHOLD ⇒ verified false even though the model said true.
    expect(enriched.verified).toBe(false);
    expect(enriched.confidence).toBe(0.5);
  });

  it("takes the cautious min(prior, score) when the verifier disagrees", async () => {
    mockChat.mockResolvedValue(
      chatResponse(JSON.stringify({ verified: false, match_score: 0.6, source_urls: [] })),
    );

    const { enriched } = await runProductVerifier(baseInput({ candidate: candidate({ confidence: 0.8 }) }));

    expect(enriched.verified).toBe(false);
    expect(enriched.confidence).toBe(0.6); // min(0.8, 0.6)
  });

  it("falls back to a text call when the structured+grounding call throws", async () => {
    mockChat
      .mockRejectedValueOnce(new Error("schema+grounding unsupported"))
      .mockResolvedValueOnce(chatResponse(JSON.stringify({ verified: true, match_score: 0.85, source_urls: ["https://x.com/p"] })));

    const { enriched } = await runProductVerifier(baseInput());

    expect(mockChat).toHaveBeenCalledTimes(2);
    // The fallback call drops responseMimeType (can't combine with grounding).
    expect(mockChat.mock.calls[0][0]).toHaveProperty("responseMimeType");
    expect(mockChat.mock.calls[1][0].responseMimeType).toBeUndefined();
    expect(enriched.verified).toBe(true);
  });

  it("backfills source_urls from grounding metadata when the model omits them", async () => {
    mockChat.mockResolvedValue(
      chatResponse(
        JSON.stringify({ verified: true, match_score: 0.9, source_urls: [] }),
        ["https://brand.com/a", "https://retailer.com/b"],
      ),
    );

    const { enriched } = await runProductVerifier(baseInput());

    expect(enriched.source_urls).toEqual(["https://brand.com/a", "https://retailer.com/b"]);
  });

  it("passes the deterministic seed + cheap thinking to the model", async () => {
    mockChat.mockResolvedValue(chatResponse(JSON.stringify({ verified: true, match_score: 0.9, source_urls: [] })));

    await runProductVerifier(baseInput());

    const callArg = mockChat.mock.calls[0][0];
    expect(callArg).toHaveProperty("seed", DETERMINISTIC_SEED);
    expect(callArg.thinkingConfig).toEqual({ thinkingLevel: "low" });
  });

  it("fails open to an unverified candidate when the response is unparseable", async () => {
    mockChat.mockResolvedValue(chatResponse("not json at all"));

    const { enriched } = await runProductVerifier(baseInput({ candidate: candidate({ confidence: 0.7 }) }));

    expect(enriched.verified).toBe(false);
    expect(enriched.confidence).toBe(0.7); // preserves the candidate's prior
    expect(enriched.materials).toEqual([]);
    expect(enriched.source_urls).toEqual([]);
    expect(enriched.brand).toBe("West Elm");
  });

  it("fails open when both the structured and fallback calls throw", async () => {
    mockChat
      .mockRejectedValueOnce(new Error("first down"))
      .mockRejectedValueOnce(new Error("fallback down"));

    const { enriched } = await runProductVerifier(baseInput());

    expect(mockChat).toHaveBeenCalledTimes(2);
    expect(enriched.verified).toBe(false);
  });
});
