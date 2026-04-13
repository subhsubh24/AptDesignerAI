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
    thinking_tokens: number;
  };
  truncated?: boolean;
  groundingMetadata?: {
    sources: GroundingSource[];
  };
  imageData?: {
    mimeType: string;
    data: string; // base64
  };
}

export interface GoogleMapsToolConfig {
  /** Render the interactive Maps widget in UI responses. Off by default. */
  enableWidget?: boolean;
  /**
   * Structured location context. When provided, Maps grounding resolves to
   * this exact coordinate pair instead of trying to parse location hints from
   * the prompt text — dramatically improves confidence for address lookups.
   */
  latLng?: { latitude: number; longitude: number };
  /**
   * @deprecated `placeId` is NOT a valid input for Gemini Maps-grounding
   * `retrievalConfig` — only `latLng` is. Sending it returns HTTP 400.
   * The field is kept for backwards source compatibility but is silently
   * dropped by `convertTools()`. Embed the placeId in the prompt text if
   * you need the model to see it.
   */
  placeId?: string;
}

export type GeminiTool =
  | { googleSearch: Record<string, never> }
  | { urlContext: Record<string, never> }
  | { googleMaps: Record<string, never> | GoogleMapsToolConfig }
  | { functionDeclarations: FunctionDeclaration[] };

export interface FunctionDeclaration {
  name: string;
  description?: string;
  parametersJsonSchema?: Record<string, unknown>;
}

/**
 * Supported output sizes for Gemini 3.1 Flash Image Preview (Nano Banana 2).
 * "1K" is the default; "0.5K" is faster/cheaper; "2K" and "4K" are higher
 * fidelity at higher cost/latency.
 */
export type ImageSize = "0.5K" | "1K" | "2K" | "4K";

/**
 * Aspect ratios supported by Gemini 3.1 Flash Image Preview. The wide/tall
 * ratios (1:4, 4:1, 1:8, 8:1) are new in Nano Banana 2 and useful for
 * banners, vertical panoramas, and elevation-style room views.
 */
export type ImageAspectRatio =
  | "1:1"
  | "3:4"
  | "4:3"
  | "9:16"
  | "16:9"
  | "2:3"
  | "3:2"
  | "1:4"
  | "4:1"
  | "1:8"
  | "8:1";

export interface ImageConfig {
  imageSize?: ImageSize;
  aspectRatio?: ImageAspectRatio;
}

export interface AIProvider {
  chat(params: {
    model: string;
    system: string;
    messages: AIMessage[];
    max_tokens?: number;
    temperature?: number;
    /**
     * Seed for deterministic sampling. When set with the same prompt+config,
     * Gemini will best-effort return the same result. See
     * lib/ai/determinism.ts for the global DETERMINISTIC_MODE override.
     */
    seed?: number;
    tools?: GeminiTool[];
    responseSchema?: Record<string, unknown>;
    responseMimeType?: string;
    thinkingConfig?: { thinkingLevel?: "minimal" | "low" | "medium" | "high" };
    responseModalities?: string[];
    mediaResolution?: "low" | "medium" | "high" | "ultra_high";
    /**
     * Image generation config — only honored by image-capable models
     * (gemini-3.1-flash-image-preview / Nano Banana 2). Controls output
     * resolution and aspect ratio.
     */
    imageConfig?: ImageConfig;
  }): Promise<AIResponse>;
}
