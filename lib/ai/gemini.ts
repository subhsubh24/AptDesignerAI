import { GoogleGenAI } from "@google/genai";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import pLimit from "p-limit";
import { createLogger } from "@/lib/logging/logger";
import { getInputBudget } from "@/lib/ai/context-truncation";
import { isBaseTier, TEXT_TIERS } from "@/lib/ai/models";
import { resolveSeed, resolveTemperature, DETERMINISTIC } from "./determinism";
import { getOrCreateSystemCache } from "./system-cache";
import { getOrCreateCombinedCache } from "./user-cache";
import { cassetteProvider } from "./cassette-provider";
import { getMeter, emit } from "@/lib/observability/margin-meter";
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

/**
 * Hard per-call timeout (ms). The SDK's fetch has no built-in upper bound,
 * so a partial/silently-stalled response could hang a request forever. This
 * caps every generateContent call; transport retries are already layered on
 * top so a timeout looks like a single transport error to callers.
 *
 * Set intentionally generous: image+long-context prompts can legitimately
 * take 60–90s on Pro tier. Real stalls are orders of magnitude longer.
 */
const GEMINI_CALL_TIMEOUT_MS = Number(process.env.GEMINI_CALL_TIMEOUT_MS) || 180_000;

/**
 * Global concurrency limiter for Gemini calls.
 *
 * Without this, 20+ parallel calls (e.g., the search-brief / quick-screen
 * fan-out in orchestrator) all hit the per-minute quota at the same instant,
 * trigger 429s, and retry in lockstep — staying synchronized indefinitely.
 *
 * Default 8 concurrent calls keeps the per-minute rate within Flash Lite's
 * free-tier quota while leaving headroom for image-generation and verifier
 * calls. Override via GEMINI_MAX_CONCURRENCY for paid tiers.
 */
const GEMINI_MAX_CONCURRENCY = Number(process.env.GEMINI_MAX_CONCURRENCY) || 8;
const geminiConcurrencyLimit = pLimit(GEMINI_MAX_CONCURRENCY);

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

function isServerError(err: unknown): boolean {
  const status = (err as Record<string, unknown>)?.status;
  return typeof status === "number" && status >= 500 && status < 600;
}

function isRateLimitError(err: unknown): boolean {
  const status = (err as Record<string, unknown>)?.status;
  return status === 429;
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
    // Multi-turn function-calling with thinking: echo the raw model parts
    // verbatim to preserve thought text, thought=true flags, and
    // thoughtSignature values that Gemini 3 mandates on continuations.
    if (msg._rawGeminiParts && msg.role === "assistant") {
      result.push({
        role: "model",
        parts: msg._rawGeminiParts as Record<string, unknown>[],
      });
      continue;
    }

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
        } else if (block.type === "function_call" && block.functionCall) {
          // Echo the model's function call back when continuing a multi-turn
          // tool-use conversation. Gemini 3 mandates the thoughtSignature
          // be preserved on the same Part — re-attaching it here.
          const fcPart: Record<string, unknown> = {
            functionCall: {
              id: block.functionCall.id,
              name: block.functionCall.name,
              args: block.functionCall.args,
            },
          };
          if (block.functionCall.thoughtSignature) {
            fcPart.thoughtSignature = block.functionCall.thoughtSignature;
          }
          parts.push(fcPart);
        } else if (block.type === "function_response" && block.functionResponse) {
          parts.push({
            functionResponse: {
              id: block.functionResponse.id,
              name: block.functionResponse.name,
              response: block.functionResponse.response,
            },
          });
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

  let hasFunctionDeclarations = false;
  let hasBuiltInTool = false;

  for (const tool of tools) {
    const entry = tool as Record<string, unknown>;
    if ("functionDeclarations" in entry) hasFunctionDeclarations = true;
    if (
      "googleSearch" in entry ||
      "urlContext" in entry ||
      "googleMaps" in entry ||
      "codeExecution" in entry
    ) {
      hasBuiltInTool = true;
    }
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

  // Gemini 3 requires `include_server_side_tool_invocations` when mixing
  // function declarations (custom tools) with built-in tools (Google Search,
  // URL Context, Code Execution, Maps). Without this flag, the API 400s
  // with: "Please enable tool_config.include_server_side_tool_invocations
  // to use Built-in tools with Function calling."
  const toolConfig: Record<string, unknown> = {};
  if (retrievalConfig) toolConfig.retrievalConfig = retrievalConfig;
  if (hasFunctionDeclarations && hasBuiltInTool) {
    toolConfig.includeServerSideToolInvocations = true;
  }

  return {
    tools: [merged],
    toolConfig: Object.keys(toolConfig).length > 0 ? toolConfig : undefined,
  };
}

const realGeminiProvider: AIProvider = {
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
    responseModalities,
    mediaResolution,
    imageConfig,
    cacheScope,
  }): Promise<AIResponse> {
    // Gemini 3 is optimized for temperature=1.0 (its default). Google warns
    // that sub-1.0 values can cause looping / degraded reasoning. We no
    // longer set a 0.3 fallback; if the caller doesn't pass a temperature,
    // we let Gemini 3 use its own default.
    // gemini-2.5-flash-lite can't use tools (no tools+JSON mime, no tool-call
    // circulation). Upgrade to the mid tier when the caller needs tools.
    if (tools?.length && isBaseTier(model)) {
      log.debug("Upgrading base model to mid for tool support", { from: model, to: TEXT_TIERS.mid });
      model = TEXT_TIERS.mid;
    }

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

    // seed was previously incompatible with responseSchema on older Gemini
    // versions but works on 3.1 (verified April 2026). urlContext tools
    // still reject seed — guard only for that case.
    if (typeof effectiveSeed === "number" && !hasUrlContext) {
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

    // Safety-net floor: callers set task-appropriate thinking via thinkingFor().
    // If a callsite forgets, fall back to "low" — cheap but functional.
    const effectiveThinkingConfig = thinkingConfig ?? { thinkingLevel: "low" };
    // gemini-2.5-flash-lite doesn't support thinking — strip to avoid 400.
    // (Exact base match: the mid/ceiling tiers DO support thinking.)
    if (isBaseTier(model)) {
      log.debug("Stripping thinkingConfig for model without thinking support", { model });
    } else {
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
    // Time the whole call (incl. transport retries) for Margin economics below.
    const marginStart = Date.now();
    for (let attempt = 1; ; attempt++) {
      try {
        response = await geminiConcurrencyLimit(() => Promise.race([
          ai.models.generateContent({
            model,
            contents,
            config,
          }),
          new Promise<never>((_, reject) =>
            setTimeout(
              () =>
                reject(
                  Object.assign(new Error(`Gemini call timed out after ${GEMINI_CALL_TIMEOUT_MS}ms`), {
                    name: "GeminiTimeoutError",
                    cause: { code: "UND_ERR_CONNECT_TIMEOUT" },
                  }),
                ),
              GEMINI_CALL_TIMEOUT_MS,
            ),
          ),
        ]));
        break;
      } catch (err) {
        const e = err as Record<string, unknown>;
        const isRateLimit = isRateLimitError(err);
        const maxAttempts = isRateLimit ? 5 : maxTransportAttempts;
        const canRetry =
          attempt < maxAttempts && (isTransportError(err) || isServerError(err) || isRateLimit);
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
        const isServer = isServerError(err);
        // Full jitter (AWS pattern): random delay in [0, baseDelay] decorrelates
        // parallel retries. Without this, dozens of concurrent calls all hit 429
        // and retry at exactly 2s/4s/8s, staying lockstep-synchronized forever.
        const baseDelay = isRateLimit
          ? 2000 * Math.pow(2, attempt - 1) // up to 2s, 4s, 8s, 16s, 32s
          : isServer ? 1000 * Math.pow(2, attempt - 1) : 500 * Math.pow(2, attempt - 1);
        const delay = isRateLimit ? Math.floor(Math.random() * baseDelay) + 500 : baseDelay;
        const reason = isRateLimit ? "Rate limited (429), retrying" : isServer ? "Server error, retrying" : "Transport error, retrying";
        log.warn(reason, {
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
    const thoughtSummaries: string[] = [];
    const functionCalls: Array<{
      id: string;
      name: string;
      args: Record<string, unknown>;
      thoughtSignature?: string;
    }> = [];

    let rawModelParts: unknown[] | undefined;

    if (response.candidates && response.candidates.length > 0) {
      const candidate = response.candidates[0];
      if (candidate.content?.parts) {
        rawModelParts = candidate.content.parts as unknown[];
        for (const part of candidate.content.parts) {
          const p = part as Record<string, unknown>;
          // Thought summaries are text parts marked thought=true; final
          // answer text parts have no `thought` flag (or thought=false).
          if (p.text && p.thought) {
            thoughtSummaries.push(p.text as string);
            // Don't add thought text to `content` — it's not the answer.
            continue;
          }
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
          // Gemini function-calling: extract any functionCall parts so the
          // caller can dispatch them. The thoughtSignature on this same
          // Part must be echoed back on the next call (Gemini 3 mandate).
          if (p.functionCall) {
            const fc = p.functionCall as { id?: string; name?: string; args?: Record<string, unknown> };
            const sig = typeof p.thoughtSignature === "string" && p.thoughtSignature.length > 0
              ? p.thoughtSignature
              : undefined;
            functionCalls.push({
              id: fc.id || crypto.randomUUID(),
              name: fc.name || "",
              args: fc.args || {},
              thoughtSignature: sig,
            });
          } else if (typeof p.thoughtSignature === "string" && p.thoughtSignature.length > 0) {
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
      log.warn("Response truncated (MAX_TOKENS)", { model, maxOutputTokens: max_tokens, outputTokens: (response.usageMetadata as Record<string, number> | undefined)?.candidatesTokenCount || 0 });
    } else if (finishReason && finishReason !== "STOP") {
      // SAFETY, RECITATION, OTHER, etc. — these silently produce empty
      // content unless we surface them. Callers seeing empty `content`
      // can correlate with this log to diagnose.
      log.warn("Non-STOP finish reason", {
        model,
        finishReason,
        contentLength: content.length,
        functionCallCount: functionCalls.length,
      });
    } else if (!content && functionCalls.length === 0 && !imageData) {
      // STOP with no content, no function calls, no image — model
      // produced no output despite finishing cleanly. Often indicates
      // thinking exhausted budget without emitting answer text.
      log.warn("Empty response with STOP finish reason", {
        model,
        thinkingTokens: (response.usageMetadata as Record<string, number> | undefined)?.thoughtsTokenCount || 0,
        outputTokens: (response.usageMetadata as Record<string, number> | undefined)?.candidatesTokenCount || 0,
      });
    }

    // Extract usage — include thinking tokens for accurate cost tracking
    const usageMetadata = response.usageMetadata as Record<string, number> | undefined;
    const thinkingTokens = usageMetadata?.thoughtsTokenCount || 0;

    if (thinkingTokens > 0) {
      log.debug("Token usage", { model, tokens: { thinking: thinkingTokens, output: usageMetadata?.candidatesTokenCount || 0 } });
    }

    // Emit this call's economics to Margin (cost-per-outcome telemetry).
    // Fail-safe: getMeter() is null in CI/tests and without a key. emit() hands
    // the promise to Vercel waitUntil so it isn't dropped when the serverless
    // instance freezes on response (a bare floating promise would be lost).
    emit(getMeter()?.recordCall({
      workflowId: "aptdesigner-search",
      provider: "google",
      model,
      inputTokens: usageMetadata?.promptTokenCount || 0,
      outputTokens: usageMetadata?.candidatesTokenCount || 0,
      cacheReadTokens: usageMetadata?.cachedContentTokenCount || 0,
      latencyMs: Date.now() - marginStart,
      status: "ok",
    }));

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
      thoughtSummaries: thoughtSummaries.length > 0 ? thoughtSummaries : undefined,
      functionCalls: functionCalls.length > 0 ? functionCalls : undefined,
      modelContentParts: rawModelParts,
    };
  },
};

let _cassetteWarned = false;

/**
 * FAIL-CLOSED guard: the AI cassette must NEVER answer on a deployed platform.
 * If E2E_AUTH_STACK is ever set on Vercel (any deploy — prod OR preview), REFUSE
 * TO BOOT — routing the render pipeline to canned images would silently serve
 * fake mockups to real, paying users (a product-integrity disaster far worse
 * than a crash). CI/local have no `VERCEL` env, so the cassette works there.
 * Runs at module load (first import on a serverless cold start) so a
 * misconfigured deploy fails fast + loud. Mirrors assertRateLimitBypassSafe()
 * in lib/utils/rate-limiter.ts — the exact same env-flag safety class.
 */
export function assertCassetteSafe(): void {
  if (process.env.E2E_AUTH_STACK === "1" && process.env.VERCEL) {
    throw new Error(
      "FATAL: E2E_AUTH_STACK is set on a deployed (Vercel) environment — it routes " +
        "the AI pipeline to the hermetic test cassette (canned images) and must ONLY " +
        "ever be set in CI. Unset it immediately.",
    );
  }
}
assertCassetteSafe();

/**
 * TEST-ONLY: route Gemini traffic to the hermetic {@link cassetteProvider} for
 * the CI functional-journey suite, so the photo→…→mockup money path runs end to
 * end and returns a REAL decodable image WITHOUT live LLM keys. Gated SOLELY on
 * E2E_AUTH_STACK=1 — an env var PRODUCTION MUST NEVER SET (the CI workflow sets
 * it only on the journeys job). Not gated on NODE_ENV: the suite serves a
 * PRODUCTION build via `next start` (NODE_ENV=production), so a NODE_ENV check
 * would wrongly disable the cassette in CI. assertCassetteSafe() above
 * hard-refuses the flag on any Vercel deploy. Logs once, loudly.
 */
function cassetteActiveForTest(): boolean {
  const on = process.env.E2E_AUTH_STACK === "1";
  if (on && !_cassetteWarned) {
    _cassetteWarned = true;
    log.warn(
      "[gemini] E2E_AUTH_STACK active — routing AI calls to the hermetic test " +
        "cassette. This is CI/test only; PRODUCTION must never set this env var.",
    );
  }
  return on;
}

/**
 * Public Gemini provider. In normal operation this is the real Gemini
 * implementation; under the CI journeys flag it delegates to the hermetic
 * cassette (see {@link cassetteActiveForTest}). Every caller — including the
 * ~20 agents that import `geminiProvider` directly — goes through this gate.
 */
export const geminiProvider: AIProvider = {
  async chat(params) {
    if (cassetteActiveForTest()) {
      return cassetteProvider.chat(params);
    }
    return realGeminiProvider.chat(params);
  },
};
