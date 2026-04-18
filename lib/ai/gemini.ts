import { GoogleGenAI } from "@google/genai";
import fs from "fs";
import path from "path";
import { createLogger } from "@/lib/logging/logger";
import { getInputBudget } from "@/lib/ai/context-truncation";
import { resolveSeed, resolveTemperature, DETERMINISTIC } from "./determinism";
import { getOrCreateSystemCache } from "./system-cache";
import { getOrCreateCombinedCache } from "./user-cache";
import type {
  AIProvider,
  AIMessage,
  AIResponse,
  GeminiTool,
} from "./provider";

// NOTE on thought signatures (Gemini 3):
// Gemini 3 returns encrypted `thoughtSignature` fields inside
// response.candidates[0].content.parts. They matter only when continuing a
// conversation (multi-turn) or doing client-side function calling — echoing
// them back preserves the model's reasoning state across turns and prevents
// 400 errors on sequential function-call continuations. All current
// callsites in this codebase are single-turn, so we simply surface any
// returned signatures on AIResponse.thoughtSignatures for future use.
// convertMessages() passes through signatures on model-role messages if a
// caller ever hands them back in assistant content (currently no caller
// does). See https://ai.google.dev/gemini-api/docs/thought-signatures

const log = createLogger("gemini");

let client: GoogleGenAI | null = null;

/**
 * Identify pure network / socket-level errors from the underlying fetch.
 * These are safe to retry transparently at the transport layer because no
 * request body was accepted by the server. Rate-limit (429) and 5xx
 * responses are intentionally excluded — those are handled by
 * agent-level `withRetry` to avoid compounding retry budgets.
 */
function isTransportError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  if (msg.includes("fetch failed")) return true;
  const cause = (err as { cause?: { code?: string } }).cause;
  const code = cause?.code;
  if (!code) return false;
  return (
    code === "UND_ERR_CONNECT_TIMEOUT" ||
    code === "UND_ERR_SOCKET" ||
    code === "ECONNRESET" ||
    code === "ECONNREFUSED" ||
    code === "ETIMEDOUT" ||
    code === "EAI_AGAIN" ||
    code === "ENETUNREACH"
  );
}

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
    const mimeType =
      ext === ".png" ? "image/png" :
      ext === ".webp" ? "image/webp" :
      ext === ".pdf" ? "application/pdf" :
      "image/jpeg";
    return { data: buffer.toString("base64"), mimeType };
  }

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,application/pdf,*/*;q=0.8",
      "Referer": new URL(url).origin + "/",
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    throw new Error(`Image fetch failed: ${response.status} ${response.statusText} for ${url}`);
  }

  // Reject responses that aren't actually images or PDFs (e.g., HTML 404
  // pages, redirects to login). PDFs are allowed for floor plan extraction.
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.startsWith("image/") && !contentType.startsWith("application/pdf")) {
    throw new Error(`URL returned unsupported content-type: ${contentType} for ${url}`);
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

  // MEDIA_RESOLUTION_ULTRA_HIGH requires rasterized images (JPEG, PNG, WebP,
  // etc.). Applying it to PDFs or other non-image types causes
  // INVALID_ARGUMENT (400). Helper returns extras only for rasterized types.
  const mediaResExtras = (mime: string): Record<string, unknown> =>
    partMediaResolutionLevel && mime.startsWith("image/")
      ? { mediaResolution: { level: partMediaResolutionLevel } }
      : {};

  for (const msg of messages) {
    const parts: Record<string, unknown>[] = [];

    if (typeof msg.content === "string") {
      parts.push({ text: msg.content });
    } else {
      for (const block of msg.content) {
        if ((block.type === "image" || block.type === "file") && block.source) {
          totalImages++;
          if (block.source.type === "file_uri" && block.source.uri) {
            const mime = block.source.media_type || "image/jpeg";
            parts.push({
              ...mediaResExtras(mime),
              fileData: {
                mimeType: mime,
                fileUri: block.source.uri,
              },
            });
          } else if (block.source.type === "base64" && block.source.data) {
            const mime = block.source.media_type || "image/jpeg";
            parts.push({
              ...mediaResExtras(mime),
              inlineData: {
                mimeType: mime,
                data: block.source.data,
              },
            });
          } else if (block.source.type === "url" && block.source.url) {
            const imgUrl = block.source.url;
            if (!imgUrl.startsWith("http://") && !imgUrl.startsWith("https://") && !imgUrl.startsWith("/uploads/")) {
              failedImages++;
              continue;
            }
            try {
              const { data, mimeType } = await fetchImageAsBase64(imgUrl);
              parts.push({
                ...mediaResExtras(mimeType),
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
        // NOTE: `placeId` is NOT a valid field inside `retrievalConfig` — the
        // current Gemini Maps-grounding schema only accepts `latLng` (and
        // optionally `languageCode`). Sending `placeId` yields HTTP 400:
        //   Unknown name "placeId" at 'tool_config.retrieval_config'.
        // PlaceId appears only in grounding *metadata* (responses), not as an
        // input. Callers that know the placeId should embed it in the prompt
        // text and rely on latLng for structured localization.
        if (latLng) {
          retrievalConfig = retrievalConfig || {};
          retrievalConfig.latLng = latLng;
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
    cacheScope,
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

    // Combined cache: when caller opts in, convert the cacheable content
    // parts and try to create/reuse a cache that covers system + these parts.
    // On success, we set config.cachedContent and send only the net-new
    // messages. On failure, we prepend the cacheable parts to the first
    // user message so behavior matches the pre-caching baseline.
    // Skip combined cache when tools are present — some Gemini tool types
    // (googleSearch, urlContext) may be incompatible with cachedContent.
    let combinedCacheName: string | null = null;
    if (cacheScope && cacheScope.content.length > 0 && !tools?.length) {
      const cacheableConverted = await convertMessages(
        [{ role: "user", content: cacheScope.content }],
        partMediaResolutionLevel,
      );
      const cacheableParts = cacheableConverted[0]?.parts ?? [];
      if (cacheableParts.length > 0) {
        combinedCacheName = await getOrCreateCombinedCache({
          model,
          system,
          cacheableParts,
          sessionKey: cacheScope.sessionKey,
        });
        if (!combinedCacheName) {
          // Fallback: prepend cached parts to the first user message so the
          // model still sees the full context inline.
          if (contents.length > 0) {
            contents[0].parts = [...cacheableParts, ...contents[0].parts];
          } else {
            contents.push({ role: "user", parts: cacheableParts });
          }
        }
      }
    }

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

    // Pre-compute: urlContext tool presence gates multiple config fields below.
    const hasUrlContext = tools?.some((t) => "urlContext" in (t as Record<string, unknown>));

    // seed is incompatible with responseSchema AND urlContext tools on
    // Gemini 3.1 Flash Lite — combining them produces INVALID_ARGUMENT (400).
    if (typeof effectiveSeed === "number" && !responseSchema && !hasUrlContext) {
      config.seed = effectiveSeed;
    }

    if (DETERMINISTIC) {
      log.debug("deterministic call", { model, seed: effectiveSeed, temperatureOverridden: effectiveTemperature === undefined });
    }

    // Gemini rejects `cachedContent` when `tools` or `tool_config` are
    // present (HTTP 400: "CachedContent can not be used with GenerateContent
    // request setting system_instruction, tools or tool_config"). Guard ALL
    // cache paths against tools.
    const hasTools = !!tools?.length;

    if (combinedCacheName) {
      config.cachedContent = combinedCacheName;
    } else if (system) {
      if (!hasTools) {
        const cacheName = await getOrCreateSystemCache(model, system);
        if (cacheName) {
          config.cachedContent = cacheName;
        } else {
          config.systemInstruction = system;
        }
      } else {
        config.systemInstruction = system;
      }
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

    // Gemini 3.1 Flash Lite defaults to "minimal" thinking — too shallow for
    // our reasoning-heavy tasks. We force every call to "high" unless:
    //   (a) the caller explicitly passed a thinkingConfig, OR
    //   (b) responseSchema is set — structured output mode is incompatible with
    //       thinkingConfig on flash-lite, causing INVALID_ARGUMENT (400).
    //   (c) urlContext tool is active — retrieval + thinking causes 400.
    const effectiveThinkingConfig = thinkingConfig
      ?? (responseSchema || hasUrlContext ? undefined : { thinkingLevel: "high" });
    if (effectiveThinkingConfig) {
      config.thinkingConfig = effectiveThinkingConfig;
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

    // Transport-level retry: the underlying fetch can fail with
    // UND_ERR_CONNECT_TIMEOUT when an IPv6 route is broken, or ECONNRESET /
    // socket errors on transient flakes. These are distinct from rate-limit
    // and 5xx responses (which agent-level withRetry already handles). We
    // retry only *connection* errors here with short backoff so every caller
    // — including routes that don't wrap with withRetry — survives brief
    // network hiccups without compounding rate-limit retry budgets.
    let response;
    const maxTransportAttempts = 3;
    for (let attempt = 1; ; attempt++) {
      try {
        response = await ai.models.generateContent({
          model,
          contents,
          config,
        });
        break;
      } catch (err) {
        const e = err as Record<string, unknown>;
        const canRetry =
          attempt < maxTransportAttempts && isTransportError(err);
        if (!canRetry) {
          const status = e.status as number;
          log.error("API error", {
            model,
            errorName: e.name as string,
            status,
            error: (e.message || (err instanceof Error ? err.message : "unknown")) as string,
            details: e.details || e.errorDetails,
          });
          if (status === 400) {
            const imagePartCount = contents.reduce((n, c) => n + c.parts.filter((p: Record<string, unknown>) => p.inlineData || p.fileData).length, 0);
            log.error("400 diagnostic", {
              configKeys: Object.keys(config),
              hasResponseSchema: !!config.responseSchema,
              hasThinkingConfig: !!config.thinkingConfig,
              hasSeed: "seed" in config,
              hasCachedContent: !!config.cachedContent,
              imagePartCount,
              hasPartMediaRes: contents.some((c) => c.parts.some((p: Record<string, unknown>) => p.mediaResolution)),
            });
          }
          throw err;
        }
        const delay = 500 * Math.pow(2, attempt - 1); // 500ms, 1000ms
        log.warn("Transport error, retrying", {
          model,
          attempt,
          delay,
          error: (e.message || (err instanceof Error ? err.message : "unknown")) as string,
        });
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    // Extract text content + any thought signatures (Gemini 3).
    // Signatures are surfaced on AIResponse so future multi-turn callers
    // can echo them back; single-turn callers can safely ignore them.
    let content = "";
    let imageData: { mimeType: string; data: string } | undefined;
    const thoughtSignatures: string[] = [];

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
          if (typeof p.thoughtSignature === "string" && p.thoughtSignature.length > 0) {
            thoughtSignatures.push(p.thoughtSignature);
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
      thoughtSignatures: thoughtSignatures.length > 0 ? thoughtSignatures : undefined,
    };
  },
};
