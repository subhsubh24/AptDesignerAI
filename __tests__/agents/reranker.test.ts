import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SearchCandidate } from "@/lib/agents/shopping-researcher";

vi.mock("@/lib/ai/gemini", () => ({
  geminiProvider: { chat: vi.fn() },
}));

import { rerankCandidates } from "@/lib/agents/reranker";
import { geminiProvider } from "@/lib/ai/gemini";

const mockChat = geminiProvider.chat as unknown as ReturnType<typeof vi.fn>;

function makeCandidate(i: number, overrides: Partial<SearchCandidate> = {}): SearchCandidate {
  return {
    title: `Product ${i}`,
    url: `https://example.com/item-${i}`,
    snippet: `Snippet for product ${i}`,
    source: "example.com",
    ...overrides,
  };
}

describe("rerankCandidates", () => {
  beforeEach(() => {
    mockChat.mockReset();
  });

  it("returns all candidates untouched when at or below topK", async () => {
    const candidates = [makeCandidate(1), makeCandidate(2)];
    const result = await rerankCandidates({
      category: "sofa",
      tier: "balanced",
      requirements: [],
      candidates,
      topK: 5,
    });
    expect(result.kept).toEqual(candidates);
    expect(result.dropped).toEqual([]);
    expect(mockChat).not.toHaveBeenCalled();
  });

  it("returns empty for empty input without calling the model", async () => {
    const result = await rerankCandidates({
      category: "sofa",
      tier: "balanced",
      requirements: [],
      candidates: [],
    });
    expect(result.kept).toEqual([]);
    expect(result.dropped).toEqual([]);
    expect(mockChat).not.toHaveBeenCalled();
  });

  it("keeps the top-K highest-scored candidates and drops the rest", async () => {
    const candidates = Array.from({ length: 5 }, (_, i) => makeCandidate(i + 1));
    mockChat.mockResolvedValueOnce({
      content: JSON.stringify({
        scores: [
          { url: "https://example.com/item-1", score: 0.9 },
          { url: "https://example.com/item-2", score: 0.3 },
          { url: "https://example.com/item-3", score: 0.85 },
          { url: "https://example.com/item-4", score: 0.1 },
          { url: "https://example.com/item-5", score: 0.75 },
        ],
      }),
      model: "test",
      usage: { input_tokens: 100, output_tokens: 100, thinking_tokens: 0 },
    });

    const result = await rerankCandidates({
      category: "sofa",
      tier: "balanced",
      requirements: ["walnut", "3-seat"],
      candidates,
      topK: 2,
      minScore: 0.25,
    });

    expect(result.kept).toHaveLength(2);
    expect(result.kept.map((c) => c.url)).toEqual([
      "https://example.com/item-1",
      "https://example.com/item-3",
    ]);
    expect(result.dropped).toHaveLength(3);
  });

  it("fails open: returns all candidates on model error", async () => {
    const candidates = Array.from({ length: 5 }, (_, i) => makeCandidate(i + 1));
    mockChat.mockRejectedValueOnce(new Error("network down"));

    const result = await rerankCandidates({
      category: "sofa",
      tier: "balanced",
      requirements: [],
      candidates,
      topK: 2,
    });

    expect(result.kept).toEqual(candidates);
    expect(result.dropped).toEqual([]);
    expect(result.tokensUsed).toBe(0);
  });

  it("filters out candidates below minScore even if within topK", async () => {
    // Need more than topK candidates so the reranker actually makes the call.
    const candidates = Array.from({ length: 5 }, (_, i) => makeCandidate(i + 1));
    mockChat.mockResolvedValueOnce({
      content: JSON.stringify({
        scores: [
          { url: "https://example.com/item-1", score: 0.9 },
          { url: "https://example.com/item-2", score: 0.05 },
          { url: "https://example.com/item-3", score: 0.1 },
          { url: "https://example.com/item-4", score: 0.15 },
          { url: "https://example.com/item-5", score: 0.2 },
        ],
      }),
      model: "test",
      usage: { input_tokens: 50, output_tokens: 50, thinking_tokens: 0 },
    });

    const result = await rerankCandidates({
      category: "sofa",
      tier: "balanced",
      requirements: [],
      candidates,
      topK: 4,
      minScore: 0.5,
    });

    expect(result.kept.map((c) => c.url)).toEqual(["https://example.com/item-1"]);
  });
});
