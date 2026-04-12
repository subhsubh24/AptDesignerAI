import { GoogleGenAI } from "@google/genai";
import fs from "fs";
import path from "path";
import { createLogger } from "@/lib/logging/logger";
import { getInputBudget } from "@/lib/ai/context-truncation";
import { resolveSeed, resolveTemperature, DETERMINISTIC } from "./determinism";
import type {
  AIProvider,
  AIMessage,
  AIResponse,
  GeminiTool,
} from "./provider";

// NOTE on thought signatures (Gemini 3):
// Gemini 3 returns encrypted `thoughtSignature` parts inside
// response.candidates[0].content.parts. For single-turn calls (our current
// usage throughout the agent pipeline), we can safely discard them. If we
// ever start passing the model's response back as a `model`-role message
// (i.e., multi-turn chat or function-calling continuations), we MUST preserve
// the full parts array including any `thoughtSignature` fields — otherwise
// reasoning quality degrades (and function-calling will 400). The
// convertMessages() function below currently only emits text + inlineData;
// update it if we introduce multi-turn flows.

const log = createLogger("gemini");

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!client) {
    client = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });
  }
  return client;
}

/**
 * Fetch an image URL and return base64-encoded data.
 */
async function fetchImageAsBase64(url: string): Promise<{ data: string; mimeType: string }> {
  // Handle relative URLs by reading directly from the local filesystem
  if (url.startsWith("/uploads/")) {
    const filePath = path.join(process.cwd(), "public", url);
    if (!fs.existsSync(filePath)) {
      log.error(`Local image not found at: ${filePath}`, { url });
      throw new Error(`Local image not found: ${filePath}`);
    }
    const buffer = fs.readFileSync(filePath);
    if (buffer.byteLength === 0) {
      throw new Error(`Local image is empty: ${filePath}`);
    }
    const ext = path.extname(filePath).toLowerCase();
    const mimeType = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
    return { data: buffer.toString("base64"), mimeType };
  }

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      "Referer": new URL(url).origin + "/",
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    throw new Error(`Image fetch failed: ${response.status} ${response.statusText} for ${url}`);
  }

  // Reject responses that aren't actually images (e.g., HTML 404 pages, redirects to login)
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.startsWith("image/")) {
    throw new Error(`Image URL returned non-image content-type: ${contentType} for ${url}`);
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength === 0) {
    throw new Error(`Image fetch returned empty data for ${url}`);
  }
  const data = Buffer.from(buffer).toString("base64");
  return { data, mimeType: contentType.split(";")[0].trim() };
}

/**
 * Map our abstract media-resolution tier to the Gemini SDK's
 * `PartMediaResolutionLevel` enum (applied per image Part).
 *
 * NOTE: The top-level `generation_config.media_resolution` field only accepts
 * LOW/MEDIUM/HIGH. ULTRA_HIGH is only valid at the per-Part level. So for
 * ultra_high we attach `mediaResolution: { level: ... }` to each inlineData
 * part instead of setting the config-level field.
 */
function toPartMediaResolutionLevel(
  tier: "low" | "medium" | "high" | "ultra_high" | undefined,
): string | undefined {
  switch (tier) {
    case "low":
      return "MEDIA_RESOLUTION_LOW";
    case "medium":
      return "MEDIA_RESOLUTION_MEDIUM";
    case "high":
      return "MEDIA_RESOLUTION_HIGH";
    case "ultra_high":
      return "MEDIA_RESOLUTION_ULTRA_HIGH";
    default:
      return undefined;
  }
}

/**
 * Convert our abstract AIMessage[] to Gemini content parts.
 *
 * When `partMediaResolutionLevel` is provided, it is attached to each image
 * Part so the API tokenizes the media at that resolution. This is the only
 * supported path for ULTRA_HIGH, which is rejected at the top-level config.
 */
async function convertMessages(
  messages: AIMessage[],
  partMediaResolutionLevel?: string,
): Promise<{ role: string; parts: Record<string, unknown>[] }[]> {
  const result: { role: string; parts: Record<string, unknown>[] }[] = [];

  let totalImages = 0;
  let failedImages = 0;

  const imagePartExtras: Record<string, unknown> = partMediaResolutionLevel
    ? { mediaResolution: { level: partMediaResolutionLevel } }
    : {};

  for (const msg of messages) {
    const parts: Record<string, unknown>[] = [];

    if (typeof msg.content === "string") {
      parts.push({ text: msg.content });
    } else {
      for (const block of msg.content) {
        if (block.type === "image" && block.source) {
          totalImages++;
          if (block.source.type === "base64" && block.source.data) {
            parts.push({
              ...imagePartExtras,
              inlineData: {
                mimeType: block.source.media_type || "image/jpeg",
                data: block.source.data,
              },
            });
          } else if (block.source.type === "url" && block.source.url) {
            const imgUrl = block.source.url;
            // Skip obviously invalid URLs (but allow /uploads/ local paths)
            if (!imgUrl.startsWith("http://") && !imgUrl.startsWith("https://") && !imgUrl.startsWith("/uploads/")) {
              failedImages++;
              continue;
            }
            try {
              const { data, mimeType } = await fetchImageAsBase64(imgUrl);
              parts.push({
                ...imagePartExtras,
                inlineData: { mimeType, data },
              });
            } catch (err) {
              failedImages++;
              log.warn(`Failed to fetch image (${failedImages}/${totalImages})`, { url: block.source.url, error: err instanceof Error ? err.message : String(err) });
            }
          }
        } else if (block.type === "text" && block.text) {
          parts.push({ text: block.text });
        }
      }
    }

    result.push({
      role: msg.role === "assistant" ? "model" : "user",
      parts,
    });
  }

  // If ALL images failed, throw so the caller knows analysis would be blind
  if (totalImages > 0 && failedImages === totalImages) {
    throw new Error(
      `All ${totalImages} image(s) failed to load. Cannot proceed with analysis without visual input. Check that image URLs are accessible.`
    );
  }

  if (failedImages > 0) {
    log.warn(`${failedImages}/${totalImages} images failed — proceeding with partial visual context`);
  }

  return result;
}

/**
 * Convert our tool definitions to Gemini format.
 *
 * Returns both the `tools` array AND an optional `toolConfig`. Structured
 * location context for Maps grounding (latLng / placeId) is passed via
 * `toolConfig.retrievalConfig` — NOT inside the googleMaps tool entry — so we
 * split those fields out here. The googleMaps tool entry keeps `enableWidget`
 * only (the field the API accepts inline).
 */
function convertTools(tools?: GeminiTool[]): {
  tools: Record<string, unknown>[] | undefined;
  toolConfig: Record<string, unknown> | undefined;
} {
  if (!tools || tools.length === 0) return { tools: undefined, toolConfig: undefined };
  // Gemini SDK expects each Tool object to hold multiple tool types as properties,
  // not separate objects per tool. Merge all tool entries into a single object.
  const merged: Record<string, unknown> = {};
  let retrievalConfig: Record<string, unknown> | undefined;

  for (const tool of tools) {
    const entry = tool as Record<string, unknown>;
    // Special-case googleMaps: its config may carry latLng / placeId which
    // actually belong in toolConfig.retrievalConfig, not inside the tool.
    if ("googleMaps" in entry) {
      const mapsCfg = entry.googleMaps as Record<string, unknown> | undefined;
      const toolLevel: Record<string, unknown> = {};
      if (mapsCfg && typeof mapsCfg === "object") {
        if (mapsCfg.enableWidget) {
          // API expects the widget mode enum string, not a boolean.
          toolLevel.enableWidget = "WIDGET_CONFIG_INLINE";
        }
        const latLng = mapsCfg.latLng as { latitude: number; longitude: number } | undefined;
        const placeId = mapsCfg.placeId as string | undefined;
        if (latLng || placeId) {
          retrievalConfig = retrievalConfig || {};
          if (latLng) retrievalConfig.latLng = latLng;
          if (placeId) retrievalConfig.placeId = placeId;
        }
      }
      merged.googleMaps = toolLevel;
      continue;
    }
    Object.assign(merged, entry);
  }

  const toolConfig = retrievalConfig ? { retrievalConfig } : undefined;
  return { tools: [merged], toolConfig };
}

export const geminiProvider: AIProvider = {
  async chat({
    model,
    system,
    messages,
    max_tokens = 4000,
    temperature,
    seed,
    tools,
    responseSchema,
    responseMimeType,
    thinkingConfig,
    responseModalities,
    mediaResolution,
    imageConfig,
  }): Promise<AIResponse> {
    // Gemini 3 is optimized for temperature=1.0 (its default). Google warns
    // that sub-1.0 values can cause looping / degraded reasoning. We no
    // longer set a 0.3 fallback; if the caller doesn't pass a temperature,
    // we let Gemini 3 use its own default.
    const effectiveTemperature = resolveTemperature(temperature);
    const effectiveSeed = resolveSeed(seed);
    const ai = getClient();

    // ULTRA_HIGH is ONLY valid at the per-Part level; the top-level
    // `generation_config.media_resolution` field rejects it with HTTP 400.
    // For any requested tier, we attach it at the Part level on each image
    // so behavior stays consistent (and we avoid the config-level path for
    // ultra_high entirely).
    const partMediaResolutionLevel = toPartMediaResolutionLevel(mediaResolution);
    const contents = await convertMessages(messages, partMediaResolutionLevel);

    // ─── Prompt size monitoring ──────────────────────────────
    // Rough token estimate: ~4 chars per token for English text.
    // Warn when prompt is large so we can catch context window issues early.
    const estimatedPromptTokens = (() => {
      let textChars = 0;
      let imageCount = 0;
      if (system) textChars += system.length;
      for (const msg of contents) {
        for (const part of msg.parts) {
          if (typeof (part as { text?: string }).text === "string") {
            textChars += ((part as { text: string }).text).length;
          }
          if ((part as { inlineData?: unknown }).inlineData) {
            imageCount++;
          }
        }
      }
      // Images are ~258 tokens per image (Gemini's default for inline images)
      return Math.ceil(textChars / 4) + imageCount * 258;
    })();

    const inputBudget = getInputBudget(model, max_tokens);
    if (estimatedPromptTokens > inputBudget * 0.85) {
      log.warn(`Prompt approaching context limit: ~${estimatedPromptTokens.toLocaleString()} / ${inputBudget.toLocaleString()} tokens (${Math.round(estimatedPromptTokens / inputBudget * 100)}%)`, { model, estimatedPromptTokens, inputBudget });
    } else if (estimatedPromptTokens > 50000) {
      log.info(`Large prompt: ~${estimatedPromptTokens.toLocaleString()} estimated tokens`, { model, estimatedPromptTokens });
    }

    // Build config
    const config: Record<string, unknown> = {
      maxOutputTokens: max_tokens,
    };

    if (typeof effectiveTemperature === "number") {
      config.temperature = effectiveTemperature;
    }

    if (typeof effectiveSeed === "number") {
      config.seed = effectiveSeed;
    }

    if (DETERMINISTIC) {
      log.debug("deterministic call", { model, seed: effectiveSeed, temperatureOverridden: effectiveTemperature === undefined });
    }

    if (system) {
      config.systemInstruction = system;
    }

    if (tools) {
      const converted = convertTools(tools);
      if (converted.tools) config.tools = converted.tools;
      if (converted.toolConfig) config.toolConfig = converted.toolConfig;
    }

    if (responseMimeType) {
      config.responseMimeType = responseMimeType;
    }

    if (responseSchema) {
      config.responseSchema = responseSchema;
      // Auto-set mime type for JSON schema responses
      if (!responseMimeType) {
        config.responseMimeType = "application/json";
      }
    }

    if (thinkingConfig) {
      config.thinkingConfig = thinkingConfig;
    }

    if (responseModalities) {
      config.responseModalities = responseModalities;
    }

    // Top-level generation_config.media_resolution only accepts LOW/MEDIUM/HIGH.
    // We already apply the requested tier per-Part (see convertMessages call
    // above), which also covers ULTRA_HIGH. Mirror low/medium/high at the
    // top level for parity with older SDK behavior, but drop ultra_high since
    // the API rejects it there.
    if (mediaResolution && mediaResolution !== "ultra_high") {
      config.mediaResolution = mediaResolution;
    }

    // Image generation config (Gemini 3.1 Flash Image Preview / Nano Banana 2).
    // Controls output resolution (0.5K / 1K / 2K / 4K) and aspect ratio.
    // Only honored by the image-capable model; text models ignore it.
    if (imageConfig && (imageConfig.imageSize || imageConfig.aspectRatio)) {
      const ic: Record<string, unknown> = {};
      if (imageConfig.imageSize) ic.imageSize = imageConfig.imageSize;
      if (imageConfig.aspectRatio) ic.aspectRatio = imageConfig.aspectRatio;
      config.imageConfig = ic;
    }

    let response;
    try {
      response = await ai.models.generateContent({
        model,
        contents,
        config,
      });
    } catch (err) {
      const e = err as Record<string, unknown>;
      log.error("API error", {
        model,
        errorName: e.name as string,
        status: e.status as number,
        error: (e.message || (err instanceof Error ? err.message : "unknown")) as string,
        details: e.details || e.errorDetails,
      });
      throw err;
    }

    // Extract text content
    let content = "";
    let imageData: { mimeType: string; data: string } | undefined;

    if (response.candidates && response.candidates.length > 0) {
      const candidate = response.candidates[0];
      if (candidate.content?.parts) {
        for (const part of candidate.content.parts) {
          const p = part as Record<string, unknown>;
          if (p.text) {
            content += p.text as string;
          }
          if (p.inlineData) {
            const inline = p.inlineData as { mimeType: string; data: string };
            imageData = {
              mimeType: inline.mimeType,
              data: inline.data,
            };
          }
        }
      }
    }

    // Fallback to response.text if available
    if (!content && response.text) {
      content = response.text;
    }

    // Extract grounding metadata
    let groundingMetadata: AIResponse["groundingMetadata"];
    if (response.candidates?.[0]) {
      const candidate = response.candidates[0] as Record<string, unknown>;
      const gm = candidate.groundingMetadata as Record<string, unknown> | undefined;
      if (gm?.groundingChunks) {
        const chunks = gm.groundingChunks as Array<{ web?: { uri: string; title: string } }>;
        groundingMetadata = {
          sources: chunks
            .filter((c) => c.web)
            .map((c) => ({
              uri: c.web!.uri,
              title: c.web!.title || "",
            })),
        };
      }
    }

    // Detect truncation — response was cut off due to max_tokens
    const finishReason = response.candidates?.[0]?.finishReason as string | undefined;
    const truncated = finishReason === "MAX_TOKENS";
    if (truncated) {
      log.warn("Response truncated (MAX_TOKENS)", { model });
    }

    // Extract usage — include thinking tokens for accurate cost tracking
    const usageMetadata = response.usageMetadata as Record<string, number> | undefined;
    const thinkingTokens = usageMetadata?.thoughtsTokenCount || 0;

    if (thinkingTokens > 0) {
      log.debug("Token usage", { model, tokens: { thinking: thinkingTokens, output: usageMetadata?.candidatesTokenCount || 0 } });
    }

    return {
      content,
      model,
      usage: {
        input_tokens: usageMetadata?.promptTokenCount || 0,
        output_tokens: usageMetadata?.candidatesTokenCount || 0,
        thinking_tokens: thinkingTokens,
      },
      truncated,
      groundingMetadata,
      imageData,
    };
  },
};
