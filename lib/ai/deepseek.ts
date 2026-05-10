/**
 * DeepSeek V4 Flash provider implementing the AIProvider interface.
 *
 * Uses the OpenAI-compatible API at https://api.deepseek.com/v1.
 * Text-only — vision agents stay on Gemini.
 */

import pLimit from "p-limit";
import { createLogger } from "@/lib/logging/logger";
import { resolveSeed, resolveTemperature } from "./determinism";
import { withRetry, isRetryableError } from "./retry";
import { geminiSchemaToOpenAI } from "./openai-schema";
import type {
  AIProvider,
  AIMessage,
  AIContentBlock,
  AIResponse,
  GeminiTool,
  FunctionDeclaration,
} from "./provider";

const log = createLogger("deepseek");

const DEEPSEEK_API_URL = "https://api.deepseek.com/v1/chat/completions";
const DEEPSEEK_MAX_CONCURRENCY = Number(process.env.DEEPSEEK_MAX_CONCURRENCY) || 20;
const DEEPSEEK_CALL_TIMEOUT_MS = Number(process.env.DEEPSEEK_CALL_TIMEOUT_MS) || 120_000;

const concurrencyLimit = pLimit(DEEPSEEK_MAX_CONCURRENCY);

function getApiKey(): string {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error("DEEPSEEK_API_KEY is not set");
  return key;
}

// ─── Message Conversion ──────────────────────────────────────────

interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

function convertMessages(system: string, messages: AIMessage[]): OpenAIMessage[] {
  const result: OpenAIMessage[] = [];

  if (system) {
    result.push({ role: "system", content: system });
  }

  for (const msg of messages) {
    if (typeof msg.content === "string") {
      result.push({
        role: msg.role === "assistant" ? "assistant" : "user",
        content: msg.content,
      });
      continue;
    }

    // Complex content blocks
    const blocks = msg.content as AIContentBlock[];

    // Collect function calls from assistant messages → tool_calls
    const functionCallBlocks = blocks.filter((b) => b.type === "function_call" && b.functionCall);
    if (msg.role === "assistant" && functionCallBlocks.length > 0) {
      const textParts = blocks
        .filter((b) => b.type === "text" && b.text)
        .map((b) => b.text!)
        .join("");

      result.push({
        role: "assistant",
        content: textParts || null,
        tool_calls: functionCallBlocks.map((b) => ({
          id: b.functionCall!.id,
          type: "function" as const,
          function: {
            name: b.functionCall!.name,
            arguments: JSON.stringify(b.functionCall!.args),
          },
        })),
      });

      // Function responses immediately follow
      const responseBlocks = blocks.filter((b) => b.type === "function_response" && b.functionResponse);
      for (const rb of responseBlocks) {
        result.push({
          role: "tool",
          tool_call_id: rb.functionResponse!.id,
          content: JSON.stringify(rb.functionResponse!.response),
        });
      }
      continue;
    }

    // User messages: function_response blocks → tool messages
    const funcResponses = blocks.filter((b) => b.type === "function_response" && b.functionResponse);
    if (funcResponses.length > 0) {
      for (const fr of funcResponses) {
        result.push({
          role: "tool",
          tool_call_id: fr.functionResponse!.id,
          content: JSON.stringify(fr.functionResponse!.response),
        });
      }
      // Also add any text blocks from the same message
      const textParts = blocks
        .filter((b) => b.type === "text" && b.text)
        .map((b) => b.text!)
        .join("");
      if (textParts) {
        result.push({ role: "user", content: textParts });
      }
      continue;
    }

    // Regular user/assistant message: concatenate text blocks, skip images
    const textParts = blocks
      .filter((b) => b.type === "text" && b.text)
      .map((b) => b.text!)
      .join("\n");

    if (blocks.some((b) => (b.type === "image" || b.type === "file") && b.source)) {
      log.warn("Image content block sent to DeepSeek (text-only) — skipping image");
    }

    if (textParts) {
      result.push({
        role: msg.role === "assistant" ? "assistant" : "user",
        content: textParts,
      });
    }
  }

  return result;
}

// ─── Tool Conversion ─────────────────────────────────────────────

interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
    strict?: boolean;
  };
}

function convertTools(tools?: GeminiTool[]): OpenAITool[] | undefined {
  if (!tools || tools.length === 0) return undefined;

  const result: OpenAITool[] = [];

  for (const tool of tools) {
    const entry = tool as Record<string, unknown>;

    if ("googleSearch" in entry || "urlContext" in entry || "googleMaps" in entry ||
        "computerUse" in entry || "codeExecution" in entry) {
      throw new Error("Gemini-only tool routed to DeepSeek — provider-factory bug");
    }

    if ("functionDeclarations" in entry) {
      const declarations = entry.functionDeclarations as FunctionDeclaration[];
      for (const fn of declarations) {
        result.push({
          type: "function",
          function: {
            name: fn.name,
            description: fn.description,
            parameters: fn.parametersJsonSchema,
            strict: true,
          },
        });
      }
    }
  }

  return result.length > 0 ? result : undefined;
}

// ─── Response Format ─────────────────────────────────────────────

type ResponseFormat =
  | { type: "json_object" }
  | { type: "json_schema"; json_schema: { name: string; strict: boolean; schema: Record<string, unknown> } }
  | undefined;

function buildResponseFormat(
  responseSchema?: Record<string, unknown>,
  responseMimeType?: string,
): ResponseFormat {
  if (responseSchema) {
    return {
      type: "json_schema",
      json_schema: {
        name: "response",
        strict: true,
        schema: geminiSchemaToOpenAI(responseSchema),
      },
    };
  }
  if (responseMimeType === "application/json") {
    return { type: "json_object" };
  }
  return undefined;
}

// ─── Thinking Mode ───────────────────────────────────────────────

function shouldEnableThinking(
  thinkingConfig?: { thinkingLevel?: string; includeThoughts?: boolean },
): boolean {
  if (!thinkingConfig) return true; // match Gemini default of HIGH
  const level = thinkingConfig.thinkingLevel;
  return level === "high" || level === "medium";
}

// ─── Provider Implementation ─────────────────────────────────────

export const deepseekProvider: AIProvider = {
  async chat({
    model,
    system,
    messages,
    max_tokens = 64000,
    temperature,
    seed,
    tools,
    responseSchema,
    responseMimeType,
    thinkingConfig,
  }): Promise<AIResponse> {
    const effectiveTemperature = resolveTemperature(temperature);
    const effectiveSeed = resolveSeed(seed);
    const apiKey = getApiKey();

    const openAIMessages = convertMessages(system, messages);
    const openAITools = convertTools(tools);
    const responseFormat = buildResponseFormat(responseSchema, responseMimeType);
    const enableThinking = shouldEnableThinking(thinkingConfig);

    const body: Record<string, unknown> = {
      model,
      messages: openAIMessages,
      max_tokens,
      stream: false,
    };

    if (typeof effectiveTemperature === "number") {
      body.temperature = effectiveTemperature;
    }
    if (typeof effectiveSeed === "number") {
      body.seed = effectiveSeed;
    }
    if (openAITools) {
      body.tools = openAITools;
      body.tool_choice = "auto";
    }
    if (responseFormat) {
      body.response_format = responseFormat;
    }

    // DeepSeek thinking mode control
    if (enableThinking) {
      body.reasoning = true;
    }

    const makeRequest = async (): Promise<AIResponse> => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), DEEPSEEK_CALL_TIMEOUT_MS);

      let response: Response;
      try {
        response = await concurrencyLimit(() =>
          fetch(DEEPSEEK_API_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(body),
            signal: controller.signal,
          }),
        );
      } catch (err) {
        clearTimeout(timeoutId);
        if (err instanceof DOMException && err.name === "AbortError") {
          throw Object.assign(
            new Error(`DeepSeek call timed out after ${DEEPSEEK_CALL_TIMEOUT_MS}ms`),
            { status: 408 },
          );
        }
        throw err;
      } finally {
        clearTimeout(timeoutId);
      }

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        const err = Object.assign(
          new Error(`DeepSeek API error ${response.status}: ${errorText.slice(0, 500)}`),
          { status: response.status },
        );
        throw err;
      }

      const data = await response.json() as {
        choices: Array<{
          message: {
            content?: string | null;
            reasoning_content?: string | null;
            tool_calls?: Array<{
              id: string;
              type: "function";
              function: { name: string; arguments: string };
            }>;
          };
          finish_reason: string;
        }>;
        usage: {
          prompt_tokens: number;
          completion_tokens: number;
          reasoning_tokens?: number;
          prompt_cache_hit_tokens?: number;
        };
      };

      const choice = data.choices?.[0];
      if (!choice) {
        throw new Error("DeepSeek returned no choices");
      }

      const content = choice.message.content || "";
      const reasoningContent = choice.message.reasoning_content || "";

      // Map function calls
      const functionCalls = choice.message.tool_calls?.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        args: JSON.parse(tc.function.arguments) as Record<string, unknown>,
      }));

      // Detect truncation
      const truncated = choice.finish_reason === "length";
      if (truncated) {
        log.warn("Response truncated", { model, maxTokens: max_tokens });
      }

      // Log cache hits for cost tracking
      const cacheHitTokens = data.usage?.prompt_cache_hit_tokens || 0;
      if (cacheHitTokens > 0) {
        log.debug("Prefix cache hit", {
          model,
          cacheHitTokens,
          totalPromptTokens: data.usage?.prompt_tokens || 0,
        });
      }

      const reasoningTokens = data.usage?.reasoning_tokens || 0;
      if (reasoningTokens > 0) {
        log.debug("Token usage", {
          model,
          tokens: {
            thinking: reasoningTokens,
            output: data.usage?.completion_tokens || 0,
          },
        });
      }

      return {
        content,
        model,
        usage: {
          input_tokens: data.usage?.prompt_tokens || 0,
          output_tokens: data.usage?.completion_tokens || 0,
          thinking_tokens: reasoningTokens,
        },
        truncated,
        thoughtSummaries: reasoningContent ? [reasoningContent] : undefined,
        functionCalls: functionCalls && functionCalls.length > 0 ? functionCalls : undefined,
      };
    };

    return withRetry(makeRequest, {
      maxAttempts: 3,
      baseDelayMs: 1000,
      maxDelayMs: 30000,
      isRetryable: (error) => {
        // "insufficient_quota" is not retryable
        if (error instanceof Error && error.message.includes("insufficient_quota")) {
          return false;
        }
        return isRetryableError(error);
      },
      onRetry: (attempt, delay, error) => {
        log.warn("Retrying DeepSeek call", {
          model,
          attempt,
          delay,
          error: error instanceof Error ? error.message : String(error),
        });
      },
    });
  },
};
