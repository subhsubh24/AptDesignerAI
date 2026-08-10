import { afterEach, describe, expect, it, vi } from "vitest";
import { convertMessages, convertTools } from "@/lib/ai/gemini";
import type { AIMessage } from "@/lib/ai/provider";

// Direct coverage for gemini.ts's two load-bearing, previously-untested
// conversion functions (APT-13, item 2 — the AIMessage/AIResponse
// abstraction every .chat() call goes through). Both were private; exported
// with no behavior change specifically so they can be driven directly
// instead of through the full chat() → SDK → cache → retry stack.

describe("convertTools", () => {
  it("returns undefined tools/toolConfig for no tools", () => {
    expect(convertTools(undefined)).toEqual({ tools: undefined, toolConfig: undefined });
    expect(convertTools([])).toEqual({ tools: undefined, toolConfig: undefined });
  });

  it("merges a plain built-in tool with no toolConfig", () => {
    const { tools, toolConfig } = convertTools([{ googleSearch: {} }]);
    expect(tools).toEqual([{ googleSearch: {} }]);
    expect(toolConfig).toBeUndefined();
  });

  it("sets includeServerSideToolInvocations when function declarations mix with a built-in tool", () => {
    const { toolConfig } = convertTools([
      { functionDeclarations: [{ name: "lookup" }] },
      { urlContext: {} },
    ]);
    expect(toolConfig).toEqual({ includeServerSideToolInvocations: true });
  });

  it("does NOT set includeServerSideToolInvocations for function declarations alone", () => {
    const { toolConfig } = convertTools([{ functionDeclarations: [{ name: "lookup" }] }]);
    expect(toolConfig).toBeUndefined();
  });

  it("extracts googleMaps latLng into toolConfig.retrievalConfig, not the tool entry", () => {
    const { tools, toolConfig } = convertTools([
      { googleMaps: { latLng: { latitude: 40.7, longitude: -74.0 } } },
    ]);
    expect(tools).toEqual([{ googleMaps: {} }]);
    expect(toolConfig).toEqual({ retrievalConfig: { latLng: { latitude: 40.7, longitude: -74.0 } } });
  });

  it("converts googleMaps enableWidget:true to the WIDGET_CONFIG_INLINE enum string", () => {
    const { tools } = convertTools([{ googleMaps: { enableWidget: true } }]);
    expect(tools).toEqual([{ googleMaps: { enableWidget: "WIDGET_CONFIG_INLINE" } }]);
  });

  it("silently drops the deprecated googleMaps placeId field", () => {
    const { tools, toolConfig } = convertTools([{ googleMaps: { placeId: "ChIJ123" } }]);
    expect(tools).toEqual([{ googleMaps: {} }]);
    expect(toolConfig).toBeUndefined();
    expect(JSON.stringify(tools)).not.toContain("placeId");
  });

  it("merges multiple non-Maps tool entries into a single object (Gemini SDK shape)", () => {
    const { tools } = convertTools([{ codeExecution: {} }, { urlContext: {} }]);
    expect(tools).toEqual([{ codeExecution: {}, urlContext: {} }]);
  });
});

describe("convertMessages", () => {
  // Stub cleanup lives here rather than at each stubbing test's end, so a
  // thrown assertion earlier in a test can't leak its fetch stub into later
  // tests.
  afterEach(() => vi.unstubAllGlobals());

  it("converts a simple text message and maps assistant → model role", async () => {
    const messages: AIMessage[] = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
    ];
    const result = await convertMessages(messages);
    expect(result).toEqual([
      { role: "user", parts: [{ text: "hello" }] },
      { role: "model", parts: [{ text: "hi there" }] },
    ]);
  });

  it("converts a base64 image block with its declared media type", async () => {
    const messages: AIMessage[] = [
      {
        role: "user",
        content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } }],
      },
    ];
    const result = await convertMessages(messages);
    expect(result[0].parts).toEqual([{ inlineData: { mimeType: "image/png", data: "AAAA" } }]);
  });

  it("echoes function calls with thoughtSignature preserved (Gemini 3 continuation requirement)", async () => {
    const messages: AIMessage[] = [
      {
        role: "assistant",
        content: [
          {
            type: "function_call",
            functionCall: { id: "call-1", name: "search", args: { q: "sofa" }, thoughtSignature: "sig-abc" },
          },
        ],
      },
    ];
    const result = await convertMessages(messages);
    expect(result[0].parts[0]).toEqual({
      functionCall: { id: "call-1", name: "search", args: { q: "sofa" } },
      thoughtSignature: "sig-abc",
    });
  });

  it("omits thoughtSignature from the part when the function call didn't carry one", async () => {
    const messages: AIMessage[] = [
      {
        role: "assistant",
        content: [{ type: "function_call", functionCall: { id: "call-1", name: "search", args: {} } }],
      },
    ];
    const result = await convertMessages(messages);
    expect(result[0].parts[0]).toEqual({ functionCall: { id: "call-1", name: "search", args: {} } });
  });

  it("converts function_response blocks", async () => {
    const messages: AIMessage[] = [
      {
        role: "user",
        content: [
          { type: "function_response", functionResponse: { id: "call-1", name: "search", response: { ok: true } } },
        ],
      },
    ];
    const result = await convertMessages(messages);
    expect(result[0].parts).toEqual([
      { functionResponse: { id: "call-1", name: "search", response: { ok: true } } },
    ]);
  });

  it("echoes _rawGeminiParts verbatim on an assistant message, ignoring content", async () => {
    const rawParts = [{ text: "reasoning", thought: true }, { thoughtSignature: "sig-xyz" }];
    const messages: AIMessage[] = [
      { role: "assistant", content: "ignored", _rawGeminiParts: rawParts },
    ];
    const result = await convertMessages(messages);
    expect(result).toEqual([{ role: "model", parts: rawParts }]);
  });

  it("skips an image URL that isn't http(s) or /uploads/ without fetching it, alongside a valid image", async () => {
    const bytes = new Uint8Array([1]).buffer;
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      headers: { get: () => "image/jpeg" },
      arrayBuffer: async () => bytes,
    }));
    vi.stubGlobal("fetch", fetchSpy);
    const messages: AIMessage[] = [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "url", url: "ftp://evil.example/x.jpg" } },
          { type: "image", source: { type: "url", url: "https://cdn.example/valid.jpg" } },
        ],
      },
    ];
    const result = await convertMessages(messages);
    // The invalid-scheme URL never reaches fetch at all — only the valid one does.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith("https://cdn.example/valid.jpg", expect.anything());
    // Its slot is dropped entirely — only the valid image's part remains.
    expect(result[0].parts).toEqual([{ inlineData: { mimeType: "image/jpeg", data: Buffer.from(bytes).toString("base64") } }]);
  });

  it("throws when EVERY image fails to load — never proceeds blind", async () => {
    const messages: AIMessage[] = [
      { role: "user", content: [{ type: "image", source: { type: "url", url: "ftp://evil.example/x.jpg" } }] },
    ];
    await expect(convertMessages(messages)).rejects.toThrow(/Cannot proceed with analysis without visual input/);
  });

  it("fetches an http(s) image URL and inlines the result as base64", async () => {
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        headers: { get: () => "image/jpeg" },
        arrayBuffer: async () => bytes,
      })),
    );
    const messages: AIMessage[] = [
      { role: "user", content: [{ type: "image", source: { type: "url", url: "https://cdn.example/room.jpg" } }] },
    ];
    const result = await convertMessages(messages);
    expect(result[0].parts).toEqual([
      { inlineData: { mimeType: "image/jpeg", data: Buffer.from(bytes).toString("base64") } },
    ]);
  });

  it("proceeds with partial visual context when only SOME images fail (not all)", async () => {
    let call = 0;
    const bytes = new Uint8Array([9]).buffer;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call++;
        if (call === 1) throw new Error("network down");
        return { ok: true, headers: { get: () => "image/png" }, arrayBuffer: async () => bytes };
      }),
    );
    const messages: AIMessage[] = [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "url", url: "https://cdn.example/a.jpg" } },
          { type: "image", source: { type: "url", url: "https://cdn.example/b.jpg" } },
        ],
      },
    ];
    const result = await convertMessages(messages);
    // One slot resolved, the failed one dropped — not left as a placeholder.
    expect(result[0].parts).toEqual([{ inlineData: { mimeType: "image/png", data: Buffer.from(bytes).toString("base64") } }]);
  });

  it("applies mediaResolution extras only to image/* types, not file_uri PDFs", async () => {
    const messages: AIMessage[] = [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
          { type: "file", source: { type: "file_uri", media_type: "application/pdf", uri: "gs://bucket/plan.pdf" } },
        ],
      },
    ];
    const result = await convertMessages(messages, "MEDIA_RESOLUTION_HIGH");
    expect(result[0].parts[0]).toEqual({
      mediaResolution: { level: "MEDIA_RESOLUTION_HIGH" },
      inlineData: { mimeType: "image/png", data: "AAAA" },
    });
    expect(result[0].parts[1]).toEqual({
      fileData: { mimeType: "application/pdf", fileUri: "gs://bucket/plan.pdf" },
    });
  });

  it("preserves message order when multiple image fetches resolve out of order", async () => {
    const order = ["https://cdn.example/slow.jpg", "https://cdn.example/fast.jpg"];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const delay = url.includes("slow") ? 20 : 0;
        await new Promise((r) => setTimeout(r, delay));
        return {
          ok: true,
          headers: { get: () => "image/jpeg" },
          arrayBuffer: async () => new TextEncoder().encode(url).buffer,
        };
      }),
    );
    const messages: AIMessage[] = order.map((url) => ({
      role: "user" as const,
      content: [{ type: "image" as const, source: { type: "url" as const, url } }],
    }));
    const result = await convertMessages(messages);
    const decode = (b64: string) => Buffer.from(b64, "base64").toString();
    expect(decode((result[0].parts[0].inlineData as { data: string }).data)).toBe(order[0]);
    expect(decode((result[1].parts[0].inlineData as { data: string }).data)).toBe(order[1]);
  });
});
