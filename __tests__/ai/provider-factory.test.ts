import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AIResponse } from "@/lib/ai/provider";
import type { TaskType } from "@/lib/ai/models";

// Shared, mutable mock chat fns so each test can steer provider behavior.
const h = vi.hoisted(() => ({
  geminiChat: vi.fn(),
  deepseekChat: vi.fn(),
}));

vi.mock("@/lib/ai/gemini", () => ({ geminiProvider: { chat: h.geminiChat } }));
vi.mock("@/lib/ai/deepseek", () => ({ deepseekProvider: { chat: h.deepseekChat } }));
vi.mock("@/lib/logging/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

function response(marker: string): AIResponse {
  // Marker lets a test assert WHICH provider handled the call.
  return {
    content: [{ type: "text", text: marker }],
    usage: { input_tokens: 1, output_tokens: 1, thinking_tokens: 0 },
  } as unknown as AIResponse;
}

// Minimal chat params — the mocked providers ignore the payload.
const params = { system: "", messages: [], thinkingConfig: { thinkingBudget: 0 } } as never;

async function freshGetProvider() {
  vi.resetModules();
  const mod = await import("@/lib/ai/provider-factory");
  return mod.getProvider;
}

const ORIGINAL_AI_PROVIDER = process.env.AI_PROVIDER;

describe("provider-factory getProvider", () => {
  beforeEach(() => {
    h.geminiChat.mockReset().mockResolvedValue(response("gemini"));
    h.deepseekChat.mockReset().mockResolvedValue(response("deepseek"));
    delete process.env.AI_PROVIDER; // default routing = deepseek
  });

  afterEach(() => {
    if (ORIGINAL_AI_PROVIDER === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = ORIGINAL_AI_PROVIDER;
  });

  it("routes Gemini-only tasks to Gemini even when the default is DeepSeek", async () => {
    const getProvider = await freshGetProvider();
    for (const task of ["mockup_image", "mockup_image_fast", "image_generation", "computer_use"] as TaskType[]) {
      const res = await getProvider(task).chat(params);
      expect(res.content[0]).toMatchObject({ text: "gemini" });
    }
    expect(h.deepseekChat).not.toHaveBeenCalled();
  });

  it("forces every task to Gemini when AI_PROVIDER=gemini", async () => {
    process.env.AI_PROVIDER = "gemini";
    const getProvider = await freshGetProvider();
    const res = await getProvider("diagnosis" as TaskType).chat(params);
    expect(res.content[0]).toMatchObject({ text: "gemini" });
    expect(h.deepseekChat).not.toHaveBeenCalled();
  });

  it("routes a text task to Gemini when a Gemini-only tool is present", async () => {
    const getProvider = await freshGetProvider();
    const tools = [{ googleSearch: {} }] as never;
    const res = await getProvider("diagnosis" as TaskType, tools).chat(params);
    expect(res.content[0]).toMatchObject({ text: "gemini" });
    expect(h.deepseekChat).not.toHaveBeenCalled();
  });

  it("routes a plain text task to DeepSeek by default", async () => {
    const getProvider = await freshGetProvider();
    const res = await getProvider("diagnosis" as TaskType).chat(params);
    expect(res.content[0]).toMatchObject({ text: "deepseek" });
    expect(h.deepseekChat).toHaveBeenCalledTimes(1);
    expect(h.geminiChat).not.toHaveBeenCalled();
  });
});

describe("provider-factory DeepSeek→Gemini fallback latch", () => {
  beforeEach(() => {
    h.geminiChat.mockReset().mockResolvedValue(response("gemini"));
    h.deepseekChat.mockReset();
    delete process.env.AI_PROVIDER;
  });

  afterEach(() => {
    if (ORIGINAL_AI_PROVIDER === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = ORIGINAL_AI_PROVIDER;
  });

  it.each([401, 402, 403])(
    "falls back to Gemini on a %s account error and latches for the rest of the process",
    async (status) => {
      h.deepseekChat.mockRejectedValue(Object.assign(new Error("account error"), { status }));
      const getProvider = await freshGetProvider();

      // First call: DeepSeek fails with an account error → transparently served by Gemini.
      const first = await getProvider("diagnosis" as TaskType).chat(params);
      expect(first.content[0]).toMatchObject({ text: "gemini" });
      expect(h.deepseekChat).toHaveBeenCalledTimes(1);

      // Latched: subsequent calls skip DeepSeek entirely and go straight to Gemini.
      const second = await getProvider("diagnosis" as TaskType).chat(params);
      expect(second.content[0]).toMatchObject({ text: "gemini" });
      expect(h.deepseekChat).toHaveBeenCalledTimes(1); // not retried
      expect(h.geminiChat).toHaveBeenCalledTimes(2);
    },
  );

  it("re-throws a non-account error and does NOT latch or fall back", async () => {
    h.deepseekChat.mockRejectedValue(Object.assign(new Error("server error"), { status: 500 }));
    const getProvider = await freshGetProvider();

    await expect(getProvider("diagnosis" as TaskType).chat(params)).rejects.toThrow("server error");
    expect(h.geminiChat).not.toHaveBeenCalled();

    // No latch: DeepSeek is tried again on the next call (here it succeeds).
    h.deepseekChat.mockResolvedValueOnce(response("deepseek"));
    const next = await getProvider("diagnosis" as TaskType).chat(params);
    expect(next.content[0]).toMatchObject({ text: "deepseek" });
  });
});
