import OpenAI from "openai";
import type { AIProvider, AIMessage, AIResponse, AIContentBlock } from "./provider";

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return client;
}

function convertMessages(
  system: string,
  messages: AIMessage[]
): OpenAI.ChatCompletionMessageParam[] {
  const result: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: system },
  ];

  for (const msg of messages) {
    if (typeof msg.content === "string") {
      result.push({ role: msg.role, content: msg.content });
      continue;
    }

    const parts: OpenAI.ChatCompletionContentPart[] = msg.content.map(
      (block: AIContentBlock) => {
        if (block.type === "image" && block.source) {
          if (block.source.type === "base64") {
            const mediaType = block.source.media_type || "image/jpeg";
            return {
              type: "image_url" as const,
              image_url: {
                url: `data:${mediaType};base64,${block.source.data}`,
              },
            };
          }
          if (block.source.type === "url") {
            return {
              type: "image_url" as const,
              image_url: { url: block.source.url! },
            };
          }
        }
        return { type: "text" as const, text: block.text || "" };
      }
    );

    if (msg.role === "user") {
      result.push({ role: "user", content: parts });
    } else {
      // Assistant messages with content parts: extract text only
      const text = parts
        .filter((p): p is OpenAI.ChatCompletionContentPartText => p.type === "text")
        .map((p) => p.text)
        .join("");
      result.push({ role: "assistant", content: text });
    }
  }

  return result;
}

export const openaiProvider: AIProvider = {
  async chat({
    model,
    system,
    messages,
    max_tokens = 16000,
    temperature = 0.3,
  }): Promise<AIResponse> {
    const openai = getClient();

    const response = await openai.chat.completions.create({
      model,
      messages: convertMessages(system, messages),
      max_tokens,
      temperature,
    });

    const content = response.choices[0]?.message?.content || "";

    return {
      content,
      model: response.model,
      usage: {
        input_tokens: response.usage?.prompt_tokens || 0,
        output_tokens: response.usage?.completion_tokens || 0,
      },
    };
  },
};
