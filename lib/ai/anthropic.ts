import Anthropic from "@anthropic-ai/sdk";
import type { AIProvider, AIMessage, AIResponse, AIContentBlock } from "./provider";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }
  return client;
}

function convertMessages(messages: AIMessage[]): Anthropic.MessageParam[] {
  return messages.map((msg) => {
    if (typeof msg.content === "string") {
      return { role: msg.role, content: msg.content };
    }

    const blocks: Anthropic.ContentBlockParam[] = msg.content.map((block: AIContentBlock) => {
      if (block.type === "image" && block.source) {
        if (block.source.type === "base64") {
          return {
            type: "image" as const,
            source: {
              type: "base64" as const,
              media_type: (block.source.media_type || "image/jpeg") as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
              data: block.source.data!,
            },
          };
        }
        if (block.source.type === "url") {
          return {
            type: "image" as const,
            source: {
              type: "url" as const,
              url: block.source.url!,
            },
          };
        }
      }
      return { type: "text" as const, text: block.text || "" };
    });

    return { role: msg.role, content: blocks };
  });
}

/** Models that support adaptive thinking */
const ADAPTIVE_THINKING_MODELS = ["claude-sonnet-4-6", "claude-opus-4-6"];

export const anthropicProvider: AIProvider = {
  async chat({ model, system, messages, max_tokens = 16000, temperature = 0.3, thinking, effort }): Promise<AIResponse> {
    const anthropic = getClient();

    const supportsAdaptive = ADAPTIVE_THINKING_MODELS.some((m) => model.includes(m));

    // Build request params
    const params: Record<string, unknown> = {
      model,
      max_tokens,
      system,
      messages: convertMessages(messages),
    };

    if (supportsAdaptive) {
      // Use adaptive thinking for Sonnet 4.6 / Opus 4.6
      params.thinking = thinking || { type: "adaptive" };
      params.output_config = { effort: effort || "high" };
      // Temperature must be 1 when thinking is enabled
      params.temperature = 1;
    } else {
      params.temperature = temperature;
    }

    const response = await anthropic.messages.create(
      params as unknown as Anthropic.MessageCreateParamsNonStreaming
    );

    // Extract text content (skip thinking blocks)
    const textContent = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

    return {
      content: textContent,
      model: response.model,
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
      },
    };
  },
};
