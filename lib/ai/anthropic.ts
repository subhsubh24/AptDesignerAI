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

export const anthropicProvider: AIProvider = {
  async chat({ model, system, messages, max_tokens = 4096, temperature = 0.3 }): Promise<AIResponse> {
    const anthropic = getClient();

    const response = await anthropic.messages.create({
      model,
      max_tokens,
      temperature,
      system,
      messages: convertMessages(messages),
    });

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
