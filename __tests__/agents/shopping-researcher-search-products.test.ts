import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TavilySearchResponse } from "@/lib/ai/tavily";

/**
 * Unit coverage for `searchProducts`, the shopping researcher's main entry
 * point — previously untested (only its two pure pre-processing helpers,
 * sanitizeSearchQuery + deduplicateCandidates, had coverage). Mocks the
 * Tavily boundary so this exercises real candidate-building logic: hostname
 * normalization, snippet truncation, image selection, and the
 * rawContent-length gate — without a network call.
 *
 * DETERMINISTIC_MODE defaults to true in tests (lib/ai/determinism.ts), so
 * search-cache's lruGet short-circuits to null on every read — no cache
 * pollution between cases, no need to mock ./search-cache.
 */

const tavilySearchMock = vi.fn<(opts: unknown) => Promise<TavilySearchResponse>>();

vi.mock("@/lib/ai/tavily", () => ({
  tavilySearch: (opts: unknown) => tavilySearchMock(opts),
}));

function tavilyResponse(results: TavilySearchResponse["results"]): TavilySearchResponse {
  return { query: "q", results, response_time: 0.1 };
}

describe("searchProducts", () => {
  beforeEach(() => {
    tavilySearchMock.mockReset();
  });

  it("short-circuits on an unsanitizable query without calling Tavily", async () => {
    const { searchProducts } = await import("@/lib/agents/shopping-researcher");
    const result = await searchProducts("rug", 10); // 3 chars after trim, below the 5-char floor
    expect(result).toEqual({ success: true, data: [], tokensUsed: 0 });
    expect(tavilySearchMock).not.toHaveBeenCalled();
  });

  it("builds candidates from a Tavily response: strips www, truncates snippet, picks first image", async () => {
    tavilySearchMock.mockResolvedValue(
      tavilyResponse([
        {
          title: "Walnut Dining Chair",
          url: "https://www.example.com/p/1",
          content: "x".repeat(600),
          score: 0.9,
          images: [{ url: "https://img.example.com/a.jpg" }, { url: "https://img.example.com/b.jpg" }],
        },
      ]),
    );

    const { searchProducts } = await import("@/lib/agents/shopping-researcher");
    const result = await searchProducts("walnut dining chair", 10);

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    const [candidate] = result.data!;
    expect(candidate.source).toBe("example.com"); // "www." stripped
    expect(candidate.snippet).toHaveLength(500); // truncated to 500 chars
    expect(candidate.imageUrl).toBe("https://img.example.com/a.jpg"); // first image wins
    expect(candidate.relevanceScore).toBe(0.9);
  });

  it("keeps rawContent only when it exceeds 500 chars", async () => {
    tavilySearchMock.mockResolvedValue(
      tavilyResponse([
        {
          title: "Short raw content",
          url: "https://shop.example.com/p/short",
          content: "snippet",
          score: 0.5,
          raw_content: "short", // well under 500 chars
        },
        {
          title: "Long raw content",
          url: "https://shop.example.com/p/long",
          content: "snippet",
          score: 0.5,
          raw_content: "y".repeat(600),
        },
      ]),
    );

    const { searchProducts } = await import("@/lib/agents/shopping-researcher");
    const result = await searchProducts("mid-century sofa", 10);

    expect(result.success).toBe(true);
    const [short, long] = result.data!;
    expect(short.rawContent).toBeUndefined();
    expect(long.rawContent).toBe("y".repeat(600));
  });

  it("falls back to the raw URL as source when the URL is malformed", async () => {
    tavilySearchMock.mockResolvedValue(
      tavilyResponse([
        { title: "Bad URL", url: "not-a-url", content: "c", score: 0.1 },
      ]),
    );

    const { searchProducts } = await import("@/lib/agents/shopping-researcher");
    const result = await searchProducts("brass floor lamp", 10);

    expect(result.success).toBe(true);
    expect(result.data![0].source).toBe("not-a-url");
  });

  it("returns a failure result (not a throw) when Tavily errors", async () => {
    tavilySearchMock.mockRejectedValue(new Error("Tavily 500"));

    const { searchProducts } = await import("@/lib/agents/shopping-researcher");
    const result = await searchProducts("velvet accent chair", 10);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Tavily 500");
  });

  it("caps max_results passed to Tavily at 20 even when a larger value is requested", async () => {
    tavilySearchMock.mockResolvedValue(tavilyResponse([]));

    const { searchProducts } = await import("@/lib/agents/shopping-researcher");
    await searchProducts("oak console table", 50);

    expect(tavilySearchMock).toHaveBeenCalledWith(
      expect.objectContaining({ max_results: 20 }),
    );
  });
});
