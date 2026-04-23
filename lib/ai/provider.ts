/**
 * AI provider abstraction.
 * Currently wraps Google Gemini API.
 * Can be extended to support other providers.
 */

export interface AIMessage {
  role: "user" | "assistant";
  content: string | AIContentBlock[];
  /**
   * Raw Gemini Part objects from the model's response. When present on an
   * assistant message, `convertMessages()` echoes these parts verbatim
   * instead of reconstructing from `content` — preserving thought text,
   * `thought: true` flags, and `thoughtSignature` values that Gemini 3
   * mandates on multi-turn continuations. Only set by callers that do
   * multi-turn function calling with thinking mode enabled.
   */
  _rawGeminiParts?: unknown[];
}

export interface AIContentBlock {
  type: "text" | "image" | "file" | "function_call" | "function_response";
  text?: string;
  source?: {
    type: "base64" | "url" | "file_uri";
    media_type?: string;
    data?: string;
    url?: string;
    /**
     * Gemini Files API resource URI (e.g. "https://generativelanguage.googleapis.com/v1beta/files/abc").
     * Used when an asset is uploaded once and referenced across many calls
     * (see lib/ai/files-cache.ts). The provider emits a `file_data` part
     * instead of base64-inlining the bytes.
     */
    uri?: string;
  };
  /**
   * For type="function_call": the model's request to invoke a tool.
   * Returned in assistant messages echoed back to the model in multi-turn
   * function-calling loops. Gemini 3 mandates the `thoughtSignature` from
   * the original response be preserved here, or the next call will 400.
   */
  functionCall?: {
    id: string;
    name: string;
    args: Record<string, unknown>;
    thoughtSignature?: string;
  };
  /**
   * For type="function_response": the tool's result, paired by `id` to the
   * function_call. The model uses this to plan the next step.
   */
  functionResponse?: {
    id: string;
    name: string;
    response: Record<string, unknown>;
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
  /**
   * Gemini 3 thought signatures — encrypted representations of the model's
   * reasoning state. Required ONLY when continuing the same conversation
   * across turns (chat history) or when doing client-side function calling
   * with sequential calls. All current callsites are single-turn, so callers
   * can ignore this. If a future multi-turn flow is added, echo the full
   * parts array (text + thoughtSignature) back as the next `model` message,
   * or the model will 400 on function-calling continuations.
   * See: https://ai.google.dev/gemini-api/docs/thought-signatures
   */
  thoughtSignatures?: string[];
  /**
   * Thought summaries — natural-language snapshots of the model's
   * reasoning process. Populated only when `thinkingConfig.includeThoughts`
   * was set on the request. Useful for surfacing the agent's "why" to
   * users without exposing raw chain-of-thought.
   */
  thoughtSummaries?: string[];
  /**
   * Function calls the model wants to invoke (Gemini function-calling).
   * Empty when the model returned only text. When present, the caller is
   * responsible for executing the named tool with the provided args and
   * sending back a function_response message containing the result. The
   * optional `thoughtSignature` is mandatory to echo back on Gemini 3 in
   * the same Part where it was received — otherwise the next request will
   * 400 with "missing a thought_signature".
   */
  functionCalls?: Array<{
    id: string;
    name: string;
    args: Record<string, unknown>;
    thoughtSignature?: string;
  }>;
  /**
   * Raw Gemini Part objects from the model's response content. Callers
   * doing multi-turn function calling with thinking mode MUST echo these
   * verbatim as the assistant message's `_rawGeminiParts` — reconstructing
   * from parsed fields drops thought text + thought signatures, which
   * Gemini 3 mandates on continuation requests.
   */
  modelContentParts?: unknown[];
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

/**
 * Computer Use tool — enables the browser-control agent (see
 * lib/agents/computer-use/). Only the preview Computer Use models
 * (gemini-2.5-computer-use-preview-* and gemini-3-flash-preview) support
 * this tool; calling it with the regular text model will 400.
 */
export interface ComputerUseToolConfig {
  /**
   * Execution environment. We only target a remote browser (Browserbase)
   * so this is always ENVIRONMENT_BROWSER. Kept as a field for future
   * Android / desktop expansion.
   */
  environment?: "ENVIRONMENT_BROWSER";
  /**
   * Disable specific predefined functions the agent shouldn't emit. Useful
   * for locking the agent out of destructive actions (e.g., drag_and_drop
   * in a product-verifier flow where we only need clicks + reads).
   */
  excludedPredefinedFunctions?: string[];
}

export type GeminiTool =
  | { googleSearch: Record<string, never> }
  | { urlContext: Record<string, never> }
  | { googleMaps: Record<string, never> | GoogleMapsToolConfig }
  | { computerUse: ComputerUseToolConfig }
  | { codeExecution: Record<string, never> }
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
    thinkingConfig?: {
      thinkingLevel?: "minimal" | "low" | "medium" | "high";
      /**
       * When true, the model returns thought summaries — distilled
       * snapshots of its reasoning process — interleaved with the final
       * response. Surfaced in `AIResponse.thoughtSummaries`. Useful for
       * transparency in agent loops; small extra output cost.
       */
      includeThoughts?: boolean;
    };
    responseModalities?: string[];
    mediaResolution?: "low" | "medium" | "high" | "ultra_high";
    /**
     * Image generation config — only honored by image-capable models
     * (gemini-3.1-flash-image-preview / Nano Banana 2). Controls output
     * resolution and aspect ratio.
     */
    imageConfig?: ImageConfig;
    /**
     * Opt-in Gemini context caching for user-role content. When provided,
     * the provider builds (or reuses) a cache entry containing the given
     * content blocks alongside the system prompt, and only sends `messages`
     * as net-new input. Typical use: cache room images + design context
     * across many fit-scoring calls that share the same session.
     *
     * Enabled by default (set `ENABLE_GEMINI_CACHE=0` to disable). Any failure (prompt too small, API
     * error) transparently falls back to inlining `cacheScope.content`
     * ahead of the first message — behavior is identical, just without the
     * token savings.
     */
    cacheScope?: {
      sessionKey: string;
      content: AIContentBlock[];
    };
  }): Promise<AIResponse>;
}
