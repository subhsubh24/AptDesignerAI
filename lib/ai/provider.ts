/**
 * AI provider abstraction.
 * Currently wraps OpenAI's GPT API.
 * Can be extended to support other providers.
 */

export interface AIMessage {
  role: "user" | "assistant";
  content: string | AIContentBlock[];
}

export interface AIContentBlock {
  type: "text" | "image";
  text?: string;
  source?: {
    type: "base64" | "url";
    media_type?: string;
    data?: string;
    url?: string;
  };
}

export interface AIResponse {
  content: string;
  model: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

export interface AIProvider {
  chat(params: {
    model: string;
    system: string;
    messages: AIMessage[];
    max_tokens?: number;
    temperature?: number;
  }): Promise<AIResponse>;
}
