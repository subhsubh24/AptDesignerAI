import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import type { AIMessage, GeminiTool } from "@/lib/ai/provider";

// geminiSchemaToOpenAI is exercised indirectly — stub it with a marker so we can
// assert buildResponseFormat routes a responseSchema through it.
vi.mock("@/lib/ai/openai-schema", () => ({
  geminiSchemaToOpenAI: (schema: Record<string, unknown>) => ({ __converted: true, from: schema }),
}));

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock("@/lib/logging/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn, error: vi.fn(), debug: vi.fn() }),
}));

import { deepseekProvider } from "@/lib/ai/deepseek";

// A well-formed OpenAI-compatible success payload; individual tests override
// the message via `okResponse(message)`.
function okResponse(message: Record<string, unknown> = { content: "hello", finish_reason: "stop" }) {
  const { finish_reason = "stop", ...msg } = message;
  return {
    ok: true,
    status: 200,
    async json() {
      return {
        choices: [{ message: msg, finish_reason }],
        usage: { prompt_tokens: 3, completion_tokens: 4 },
      };
    },
    async text() {
      return "";
    },
  };
}

const fetchMock = vi.fn();
const ORIGINAL_KEY = process.env.DEEPSEEK_API_KEY;

/**
 * The JSON body the provider POSTed to the DeepSeek chat-completions endpoint on
 * the most recent call. Selected by URL rather than `.at(-1)` because a `.chat()`
 * can fire a *trailing* fetch to the Margin telemetry ingest endpoint (whenever
 * the meter is live — MARGIN_INGEST_KEY set and not in the offline CI context);
 * that emit must not be mistaken for the model request.
 */
function lastRequestBody(): Record<string, unknown> {
  const call = fetchMock.mock.calls
    .filter((c) => typeof c[0] === "string" && c[0].startsWith("https://api.deepseek.com"))
    .at(-1);
  return JSON.parse((call![1] as { body: string }).body);
}

const baseParams = {
  model: "gemini-2.5-flash-lite",
  thinkingConfig: undefined,
};

beforeEach(() => {
  process.env.DEEPSEEK_API_KEY = "test-key";
  warn.mockReset();
  fetchMock.mockReset().mockResolvedValue(okResponse());
  vi.stubGlobal("fetch", fetchMock);
});

afterAll(() => {
  vi.unstubAllGlobals();
  if (ORIGINAL_KEY === undefined) delete process.env.DEEPSEEK_API_KEY;
  else process.env.DEEPSEEK_API_KEY = ORIGINAL_KEY;
});

describe("deepseek convertMessages", () => {
  it("prepends the system message and passes string content through as a user message", async () => {
    await deepseekProvider.chat({
      ...baseParams,
      system: "You are a designer.",
      messages: [{ role: "user", content: "Design my room" }],
    });
    expect(lastRequestBody().messages).toEqual([
      { role: "system", content: "You are a designer." },
      { role: "user", content: "Design my room" },
    ]);
  });

  it("omits the system message when the system string is empty", async () => {
    await deepseekProvider.chat({
      ...baseParams,
      system: "",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(lastRequestBody().messages).toEqual([{ role: "user", content: "hi" }]);
  });

  it("maps an assistant function_call to tool_calls and the following function_response to a tool message", async () => {
    const messages: AIMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "Let me search." },
          { type: "function_call", functionCall: { id: "call_1", name: "search", args: { q: "sofa" } } },
          { type: "function_response", functionResponse: { id: "call_1", name: "search", response: { hits: 2 } } },
        ],
      },
    ];
    await deepseekProvider.chat({ ...baseParams, system: "", messages });
    expect(lastRequestBody().messages).toEqual([
      {
        role: "assistant",
        content: "Let me search.",
        tool_calls: [
          { id: "call_1", type: "function", function: { name: "search", arguments: JSON.stringify({ q: "sofa" }) } },
        ],
      },
      { role: "tool", tool_call_id: "call_1", content: JSON.stringify({ hits: 2 }) },
    ]);
  });

  it("maps a user-side function_response block to a tool message", async () => {
    const messages: AIMessage[] = [
      {
        role: "user",
        content: [
          { type: "function_response", functionResponse: { id: "call_9", name: "lookup", response: { ok: true } } },
        ],
      },
    ];
    await deepseekProvider.chat({ ...baseParams, system: "", messages });
    expect(lastRequestBody().messages).toEqual([
      { role: "tool", tool_call_id: "call_9", content: JSON.stringify({ ok: true }) },
    ]);
  });

  it("drops image blocks (text-only provider) and warns, keeping the text", async () => {
    const messages: AIMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "What's this?" },
          { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
        ],
      },
    ];
    await deepseekProvider.chat({ ...baseParams, system: "", messages });
    expect(lastRequestBody().messages).toEqual([{ role: "user", content: "What's this?" }]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Image content block sent to DeepSeek"));
  });
});

describe("deepseek convertTools", () => {
  it("converts functionDeclarations to OpenAI tools with strict mode and sets tool_choice", async () => {
    const tools: GeminiTool[] = [
      {
        functionDeclarations: [
          { name: "get_weather", description: "Get weather", parametersJsonSchema: { type: "object" } },
        ],
      },
    ] as GeminiTool[];
    await deepseekProvider.chat({ ...baseParams, system: "", messages: [{ role: "user", content: "hi" }], tools });
    const body = lastRequestBody();
    expect(body.tools).toEqual([
      {
        type: "function",
        function: { name: "get_weather", description: "Get weather", parameters: { type: "object" }, strict: true },
      },
    ]);
    expect(body.tool_choice).toBe("auto");
  });

  it("omits tools entirely when none are provided", async () => {
    await deepseekProvider.chat({ ...baseParams, system: "", messages: [{ role: "user", content: "hi" }] });
    const body = lastRequestBody();
    expect(body).not.toHaveProperty("tools");
    expect(body).not.toHaveProperty("tool_choice");
  });

  it("throws when a Gemini-only tool is routed to DeepSeek (a provider-factory bug)", async () => {
    const tools = [{ googleSearch: {} }] as unknown as GeminiTool[];
    await expect(
      deepseekProvider.chat({ ...baseParams, system: "", messages: [{ role: "user", content: "hi" }], tools }),
    ).rejects.toThrow("Gemini-only tool routed to DeepSeek");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("deepseek buildResponseFormat", () => {
  const msg: AIMessage[] = [{ role: "user", content: "hi" }];

  it("uses a json_schema response_format (through geminiSchemaToOpenAI) when a responseSchema is given", async () => {
    const schema = { type: "object", properties: { x: { type: "string" } } };
    await deepseekProvider.chat({ ...baseParams, system: "", messages: msg, responseSchema: schema });
    expect(lastRequestBody().response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "response", strict: true, schema: { __converted: true, from: schema } },
    });
  });

  it("uses json_object mode when responseMimeType is application/json and no schema is given", async () => {
    await deepseekProvider.chat({ ...baseParams, system: "", messages: msg, responseMimeType: "application/json" });
    expect(lastRequestBody().response_format).toEqual({ type: "json_object" });
  });

  it("omits response_format when neither a schema nor a JSON mime type is given", async () => {
    await deepseekProvider.chat({ ...baseParams, system: "", messages: msg });
    expect(lastRequestBody()).not.toHaveProperty("response_format");
  });
});

describe("deepseek response mapping", () => {
  it("throws a clearly-named error when a tool call has malformed JSON arguments", async () => {
    fetchMock.mockResolvedValue(
      okResponse({
        content: null,
        tool_calls: [{ id: "call_1", type: "function", function: { name: "search", arguments: "{not json" } }],
        finish_reason: "tool_calls",
      }),
    );
    await expect(
      deepseekProvider.chat({ ...baseParams, system: "", messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toThrow(/malformed JSON arguments for tool call "search"/);
  });

  it("throws when DeepSeek returns no choices", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      async json() {
        return { choices: [], usage: { prompt_tokens: 1, completion_tokens: 0 } };
      },
      async text() {
        return "";
      },
    });
    await expect(
      deepseekProvider.chat({ ...baseParams, system: "", messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toThrow("DeepSeek returned no choices");
  });
});
