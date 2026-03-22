/**
 * AI provider abstraction.
 * Currently wraps Google Gemini API.
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

export interface GroundingSource {
  uri: string;
  title: string;
}

export interface AIResponse {
  content: string;
  model: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
  groundingMetadata?: {
    sources: GroundingSource[];
  };
  imageData?: {
    mimeType: string;
    data: string; // base64
  };
}

export type GeminiTool =
  | { googleSearch: Record<string, never> }
  | { urlContext: Record<string, never> }
  | { functionDeclarations: FunctionDeclaration[] };

export interface FunctionDeclaration {
  name: string;
  description?: string;
  parametersJsonSchema?: Record<string, unknown>;
}

export interface AIProvider {
  chat(params: {
    model: string;
    system: string;
    messages: AIMessage[];
    max_tokens?: number;
    temperature?: number;
    tools?: GeminiTool[];
    responseSchema?: Record<string, unknown>;
    responseMimeType?: string;
    thinkingConfig?: { thinkingLevel?: "minimal" | "low" | "medium" | "high" };
    responseModalities?: string[];
  }): Promise<AIResponse>;
}
