import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// product-extractor's image path calls geminiProvider.chat directly; mock it so
// we exercise the parse/validate/error branches without a real model call.
vi.mock("@/lib/ai/gemini", () => ({
  geminiProvider: { chat: vi.fn() },
}));

// The URL-batch path's first external dependency is Tavily; mock it so the
// short-circuit test can assert that an empty list never reaches extraction.
vi.mock("@/lib/ai/tavily", () => ({
  tavilyExtract: vi.fn(),
}));

import { extractFromImage, extractFromUrlBatch, extractFromUrl } from "@/lib/agents/product-extractor";
import { geminiProvider } from "@/lib/ai/gemini";
import { tavilyExtract } from "@/lib/ai/tavily";
import { DETERMINISTIC_SEED } from "@/lib/ai/determinism";

const mockChat = geminiProvider.chat as unknown as ReturnType<typeof vi.fn>;
const mockTavily = tavilyExtract as unknown as ReturnType<typeof vi.fn>;

function chatResponse(content: string) {
  return {
    content,
    usage: { input_tokens: 10, output_tokens: 20, thinking_tokens: 5 },
    model: "gemini-test",
  };
}

const VALID_PRODUCT = JSON.stringify({
  title: "Solid Walnut Round Coffee Table",
  retailer: "Article",
  price: 499,
  dimensions: { diameter: 36, height: 17, unit: "inches" },
  materials: ["solid walnut"],
  colors: ["warm walnut brown"],
  category: "coffee_table",
  description: "Mid-century round coffee table.",
  image_url: "https://cdn.example.com/walnut.jpg",
});

describe("extractFromImage", () => {
  beforeEach(() => {
    mockChat.mockReset();
  });

  it("parses and validates a well-formed product response", async () => {
    mockChat.mockResolvedValue(chatResponse(VALID_PRODUCT));

    const result = await extractFromImage("https://cdn.example.com/product.jpg");

    expect(result.success).toBe(true);
    if (!result.success || !result.data) throw new Error("expected success with data");
    expect(result.data.title).toBe("Solid Walnut Round Coffee Table");
    expect(result.data.category).toBe("coffee_table");
    expect(result.data.price).toBe(499);
    expect(result.data.materials).toContain("solid walnut");
    // Tokens are summed across input + output + thinking.
    expect(result.tokensUsed).toBe(35);
    expect(result.model).toBe("gemini-test");
    // Determinism contract: the image-extraction call must pass the seed, like
    // its sibling extractFromUrlBatch calls do (otherwise runs aren't reproducible).
    expect(mockChat.mock.calls[0][0]).toHaveProperty("seed");
    expect(mockChat.mock.calls[0][0].seed).toBe(DETERMINISTIC_SEED);
  });

  it("strips markdown fences before validating (extractJsonObject)", async () => {
    mockChat.mockResolvedValue(chatResponse("```json\n" + VALID_PRODUCT + "\n```"));

    const result = await extractFromImage("https://cdn.example.com/product.jpg");

    expect(result.success).toBe(true);
    if (!result.success || !result.data) throw new Error("expected success with data");
    expect(result.data.title).toBe("Solid Walnut Round Coffee Table");
  });

  it("attaches the product image and any room reference photos to the prompt", async () => {
    mockChat.mockResolvedValue(chatResponse(VALID_PRODUCT));

    await extractFromImage("https://cdn.example.com/product.jpg", undefined, [
      "https://cdn.example.com/room-1.jpg",
      "https://cdn.example.com/room-2.jpg",
    ]);

    expect(mockChat).toHaveBeenCalledTimes(1);
    const content = mockChat.mock.calls[0][0].messages[0].content as Array<{
      type: string;
      source?: { url: string };
    }>;
    const imageUrls = content.filter((b) => b.type === "image").map((b) => b.source?.url);
    // Room photos precede the product image so style fields can reference context.
    expect(imageUrls).toEqual([
      "https://cdn.example.com/room-1.jpg",
      "https://cdn.example.com/room-2.jpg",
      "https://cdn.example.com/product.jpg",
    ]);
  });

  it("caps room reference photos at three", async () => {
    mockChat.mockResolvedValue(chatResponse(VALID_PRODUCT));

    await extractFromImage("https://cdn.example.com/product.jpg", undefined, [
      "https://cdn.example.com/r1.jpg",
      "https://cdn.example.com/r2.jpg",
      "https://cdn.example.com/r3.jpg",
      "https://cdn.example.com/r4.jpg",
    ]);

    const content = mockChat.mock.calls[0][0].messages[0].content as Array<{
      type: string;
      source?: { url: string };
    }>;
    const roomImages = content
      .filter((b) => b.type === "image" && b.source?.url.includes("/r"))
      .map((b) => b.source?.url);
    expect(roomImages).toEqual([
      "https://cdn.example.com/r1.jpg",
      "https://cdn.example.com/r2.jpg",
      "https://cdn.example.com/r3.jpg",
    ]);
  });

  it("returns a failure result (never throws) when the model call rejects", async () => {
    mockChat.mockRejectedValue(new Error("model timeout"));

    const result = await extractFromImage("https://cdn.example.com/product.jpg");

    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");
    expect(result.error).toBe("model timeout");
  });

  it("returns a failure result when the response is not parseable JSON", async () => {
    mockChat.mockResolvedValue(chatResponse("the product appears to be a sofa"));

    const result = await extractFromImage("https://cdn.example.com/product.jpg");

    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");
    expect(typeof result.error).toBe("string");
  });
});

describe("extractFromUrlBatch", () => {
  beforeEach(() => {
    mockChat.mockReset();
    mockTavily.mockReset();
  });

  it("short-circuits on an empty URL list — returns empty, never reaches Tavily extraction", async () => {
    const results = await extractFromUrlBatch([], "sofa");

    // Assert the real observable contract: empty input → empty result map, and
    // the batch never touches its first external dependency (Tavily). The batch
    // path uses getProvider("extraction").chat — not geminiProvider — so we
    // assert against the collaborator the function actually calls.
    expect(results.size).toBe(0);
    expect(mockTavily).not.toHaveBeenCalled();
  });
});

describe("extractFromUrl — scrape-fallback abort timer cleanup", () => {
  // Regression coverage for the leak this fix closes: scrapePageContext (a
  // private helper reached only through this exported path) creates a
  // setTimeout-driven AbortController per fetch attempt. Before the fix,
  // clearTimeout ran only on the success branch inside the try block, so a
  // rejected fetch (network error, not the abort itself) left the timer
  // running for up to 10s. This URL is a STRUCTURED_SCRAPE_FIRST domain with
  // no pre-extracted content and a failed Tavily lookup, so it is scraped
  // TWICE (the parallel "supplement" pass, then the no-content fallback pass)
  // — both real fetch attempts must clean up their own timer.
  const originalFetch = global.fetch;

  beforeEach(() => {
    mockTavily.mockReset();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("clears every abort timer even when every scrape fetch attempt rejects", async () => {
    const url = "https://www.westelm.com/product/test-item";
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    global.fetch = fetchMock as unknown as typeof fetch;
    mockTavily.mockResolvedValue({ results: [], failed_results: [{ url }] });

    const setTimeoutSpy = vi.spyOn(global, "setTimeout");
    const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");

    const result = await extractFromUrl(url);

    // scrapePageContext gave up both times (fetch always rejects), so this
    // URL never gets extractable content and the batch reports failure —
    // never the LLM fallback path, since that only runs on non-empty scraped
    // content.
    expect(result.success).toBe(false);
    expect(fetchMock).toHaveBeenCalled();

    // The actual regression guard: every AbortController timer this code path
    // created was cleared. Before the fix, a rejected fetch skipped
    // clearTimeout entirely, so this assertion would fail against the old code.
    const createdTimerIds = setTimeoutSpy.mock.results.map((r) => r.value);
    expect(createdTimerIds.length).toBeGreaterThan(0);
    const clearedTimerIds = new Set(clearTimeoutSpy.mock.calls.map((c) => c[0]));
    for (const id of createdTimerIds) {
      expect(clearedTimerIds.has(id)).toBe(true);
    }

    setTimeoutSpy.mockRestore();
    clearTimeoutSpy.mockRestore();
  });
});
