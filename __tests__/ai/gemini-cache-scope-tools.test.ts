import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * `cacheScope` content (e.g. room photos) was silently DROPPED whenever the
 * same call also passed `tools` (googleSearch/codeExecution) — the entire
 * cache-or-fallback-inline block in gemini.ts's chat() lived behind a
 * `!tools?.length` guard, so a tools call never reached the documented
 * "transparently falls back to inlining `cacheScope.content`" behavior
 * (see the JSDoc on `cacheScope` in lib/ai/provider.ts). The room-diagnostician
 * pipeline always combines cacheScope images with `tools: [googleSearch,
 * codeExecution]`, so every diagnosis call was running blind on the room
 * photos — see APT-36. This pins the fallback so it can't regress silently.
 */

const generateContentMock = vi.fn();
const cachesCreateMock = vi.fn();
const fetchMock = vi.fn();
const ORIGINAL_FETCH = globalThis.fetch;

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: (...args: unknown[]) => generateContentMock(...args) };
    caches = { create: (...args: unknown[]) => cachesCreateMock(...args) };
  },
  Type: { OBJECT: "OBJECT", STRING: "STRING", ARRAY: "ARRAY", NUMBER: "NUMBER" },
}));

describe("gemini cacheScope + tools: images must still reach the model", () => {
  beforeEach(() => {
    vi.resetModules();
    generateContentMock.mockReset();
    cachesCreateMock.mockReset();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({ "content-type": "image/png" }),
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    } as unknown as Response);
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    process.env.GEMINI_API_KEY = "test-key";
    generateContentMock.mockResolvedValue({ text: "ok", candidates: [], usageMetadata: {} });
  });

  afterEach(() => {
    delete process.env.GEMINI_API_KEY;
    globalThis.fetch = ORIGINAL_FETCH;
  });

  it("inlines cacheScope image content into the request when tools are present, rather than dropping it", async () => {
    const { geminiProvider } = await import("@/lib/ai/gemini");

    await geminiProvider.chat({
      model: "gemini-2.5-flash-lite",
      system: "test",
      messages: [{ role: "user", content: [{ type: "text", text: "Diagnose this room." }] }],
      thinkingConfig: { thinkingLevel: "LOW" as never },
      tools: [{ googleSearch: {} as Record<string, never> }],
      cacheScope: {
        sessionKey: "room-session-1",
        content: [{ type: "image", source: { type: "url", url: "https://cdn.example.com/room.png" } }],
      },
    });

    expect(generateContentMock).toHaveBeenCalledTimes(1);
    const request = generateContentMock.mock.calls[0][0] as {
      contents: Array<{ parts: Array<Record<string, unknown>> }>;
      config?: Record<string, unknown>;
    };

    // Gemini rejects cachedContent alongside tools, so no cache attempt.
    expect(cachesCreateMock).not.toHaveBeenCalled();
    expect(request.config?.cachedContent).toBeUndefined();

    // The image from cacheScope must be inlined ahead of the real message —
    // NOT silently dropped.
    const firstMessageParts = request.contents[0].parts;
    const hasImagePart = firstMessageParts.some((p) => "inlineData" in p || "fileData" in p);
    expect(hasImagePart).toBe(true);
    expect(firstMessageParts.some((p) => p.text === "Diagnose this room.")).toBe(true);
  });

  it("still uses combined caching (no tools) so the no-tools path is unchanged", async () => {
    cachesCreateMock.mockResolvedValue({ name: "cachedContents/abc123" });
    const { geminiProvider } = await import("@/lib/ai/gemini");

    await geminiProvider.chat({
      model: "gemini-2.5-flash-lite",
      system: "test",
      messages: [{ role: "user", content: [{ type: "text", text: "Diagnose this room." }] }],
      thinkingConfig: { thinkingLevel: "LOW" as never },
      cacheScope: {
        sessionKey: "room-session-2",
        content: [{ type: "image", source: { type: "url", url: "https://cdn.example.com/room.png" } }],
      },
    });

    expect(cachesCreateMock).toHaveBeenCalledTimes(1);
    const request = generateContentMock.mock.calls[0][0] as {
      contents: Array<{ parts: Array<Record<string, unknown>> }>;
      config?: Record<string, unknown>;
    };
    expect(request.config?.cachedContent).toBe("cachedContents/abc123");
    // Cached image content is NOT re-inlined once the cache holds it.
    const hasImagePart = request.contents[0].parts.some((p) => "inlineData" in p || "fileData" in p);
    expect(hasImagePart).toBe(false);
  });
});
