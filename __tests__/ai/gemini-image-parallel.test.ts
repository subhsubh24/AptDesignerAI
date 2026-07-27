import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * Image parts on a vision call used to be fetched one at a time, inside the
 * part-builder loop, on the path in front of EVERY vision call in the app. They
 * are now fetched together.
 *
 * The risk that buys is ORDER: parts must reach the model in authored order, so
 * a photo still lines up with the "Photo 2:" label written next to it. These
 * tests pin that order against fetches that deliberately resolve backwards, and
 * pin that the fetches genuinely overlap — otherwise the change is a no-op that
 * still passes an order assertion.
 */

const generateContentMock = vi.fn();
const fetchMock = vi.fn();

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: (...args: unknown[]) => generateContentMock(...args) };
  },
  Type: { OBJECT: "OBJECT", STRING: "STRING", ARRAY: "ARRAY", NUMBER: "NUMBER" },
}));

const ORIGINAL_FETCH = globalThis.fetch;

/** Fetch double that holds each response open for `delayMs` and tracks overlap. */
function imageFetchesWithDelays(delays: Record<string, number>) {
  let inFlight = 0;
  let peakInFlight = 0;
  const completionOrder: string[] = [];

  fetchMock.mockImplementation(async (url: string) => {
    const key = String(url);
    inFlight++;
    peakInFlight = Math.max(peakInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, delays[key] ?? 0));
    inFlight--;
    completionOrder.push(key);
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({ "content-type": "image/png" }),
      // Distinct bytes per URL so a part can be traced back to its source.
      arrayBuffer: async () => new Uint8Array([key.length]).buffer,
    } as unknown as Response;
  });

  return {
    peak: () => peakInFlight,
    completionOrder,
  };
}

/** The parts the provider actually handed to the SDK. */
function sentParts(): Array<Record<string, unknown>> {
  const request = generateContentMock.mock.calls[0][0] as {
    contents: Array<{ parts: Array<Record<string, unknown>> }>;
  };
  return request.contents[0].parts;
}

async function chatWithImages(urls: string[]) {
  const { geminiProvider } = await import("@/lib/ai/gemini");
  const content: Array<Record<string, unknown>> = [];
  urls.forEach((url, i) => {
    content.push({ type: "text", text: `Photo ${i + 1}:` });
    content.push({ type: "image", source: { type: "url", url } });
  });

  return geminiProvider.chat({
    model: "gemini-2.5-flash-lite",
    system: "test",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    messages: [{ role: "user", content: content as any }],
    thinkingConfig: { thinkingLevel: "LOW" as never },
  });
}

describe("gemini converts URL image parts in parallel without reordering them", () => {
  beforeEach(() => {
    vi.resetModules();
    generateContentMock.mockReset();
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    process.env.GEMINI_API_KEY = "test-key";
    generateContentMock.mockResolvedValue({ text: "ok", candidates: [], usageMetadata: {} });
  });

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
  });

  it("keeps authored part order when the fetches finish in reverse", async () => {
    const urls = [
      "https://cdn.example.com/first.png",
      "https://cdn.example.com/second.png",
      "https://cdn.example.com/third.png",
    ];
    // First image is slowest, last is fastest — so completion order is the
    // exact reverse of authored order.
    const tracker = imageFetchesWithDelays({
      [urls[0]]: 30,
      [urls[1]]: 15,
      [urls[2]]: 1,
    });

    await chatWithImages(urls);

    expect(tracker.completionOrder).toEqual([urls[2], urls[1], urls[0]]);

    // Text label, image, text label, image, ... in the order they were written.
    const parts = sentParts();
    expect(parts.map((p) => ("text" in p ? p.text : "<image>"))).toEqual([
      "Photo 1:",
      "<image>",
      "Photo 2:",
      "<image>",
      "Photo 3:",
      "<image>",
    ]);
    // No placeholder ever reaches the model.
    expect(parts.some((p) => "__pendingImage" in p)).toBe(false);
  });

  it("actually overlaps the fetches rather than awaiting them one by one", async () => {
    const urls = [
      "https://cdn.example.com/a.png",
      "https://cdn.example.com/b.png",
      "https://cdn.example.com/c.png",
    ];
    const tracker = imageFetchesWithDelays({ [urls[0]]: 20, [urls[1]]: 20, [urls[2]]: 20 });

    await chatWithImages(urls);

    // Serial fetching pins this at 1. This is the assertion that fails if the
    // batching is ever undone.
    expect(tracker.peak()).toBeGreaterThan(1);
  });

  it("drops only the failed image's slot, leaving the others in place", async () => {
    const urls = [
      "https://cdn.example.com/ok1.png",
      "https://cdn.example.com/broken.png",
      "https://cdn.example.com/ok2.png",
    ];
    imageFetchesWithDelays({ [urls[0]]: 5, [urls[1]]: 1, [urls[2]]: 10 });
    fetchMock.mockImplementationOnce(async () => {
      throw new Error("connection reset");
    });

    await chatWithImages(urls);

    // The first fetch call is the one that throws, so image 1 goes missing and
    // images 2 and 3 keep their positions relative to their labels.
    const parts = sentParts();
    expect(parts.map((p) => ("text" in p ? p.text : "<image>"))).toEqual([
      "Photo 1:",
      "Photo 2:",
      "<image>",
      "Photo 3:",
      "<image>",
    ]);
  });

  it("still throws when every image fails, rather than silently going blind", async () => {
    fetchMock.mockImplementation(async () => {
      throw new Error("connection reset");
    });

    await expect(
      chatWithImages(["https://cdn.example.com/x.png", "https://cdn.example.com/y.png"]),
    ).rejects.toThrow(/image\(s\) failed to load/i);
    expect(generateContentMock).not.toHaveBeenCalled();
  });
});
