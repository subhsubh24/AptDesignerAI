import { describe, it, expect, vi, beforeEach } from "vitest";

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

import { extractFromImage, extractFromUrlBatch } from "@/lib/agents/product-extractor";
import { geminiProvider } from "@/lib/ai/gemini";
import { tavilyExtract } from "@/lib/ai/tavily";

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
