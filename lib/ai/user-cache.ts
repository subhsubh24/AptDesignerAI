/**
 * Combined (system + user content) context cache for Gemini.
 *
 * Parallels `lib/ai/system-cache.ts` but caches both the system instruction
 * AND user-role content (room images, design block, etc.) in one entry. A
 * typical product-search run makes 200+ calls that all share the same room
 * images and design context; this cache lets Gemini re-tokenize those parts
 * at the cheaper cached rate.
 *
 * Opt-in via `ENABLE_GEMINI_CACHE=1`. Any failure (prompt too small, API
 * error, missing content) returns null; callers fall back to inline content.
 */

import crypto from "crypto";
import { GoogleGenAI } from "@google/genai";
import { createLogger } from "@/lib/logging/logger";

const log = createLogger("user-cache");

const CACHE_TTL_SECONDS = 50 * 60;

interface CacheEntry {
  name: string | null;
  expiresAt: number;
}

const entries = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<string | null>>();

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  if (!client) {
    client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return client;
}

export interface CombinedCacheParams {
  model: string;
  /** Optional system prompt — embedded in the cache so the same cachedContent
   *  reference covers both. */
  system?: string;
  /** Pre-converted Gemini parts (e.g. the output of convertMessages for the
   *  cacheable user content). Must be non-empty. */
  cacheableParts: Record<string, unknown>[];
  /** Stable per-session key (room id + design version, etc.) so calls within
   *  the same session reuse the cache. */
  sessionKey: string;
}

function fingerprintParts(parts: Record<string, unknown>[]): string {
  // Hash only stable fields — URIs, text, and mimetypes — never base64 bytes.
  const condensed = parts.map((p) => {
    const fd = p.fileData as { fileUri?: string; mimeType?: string } | undefined;
    const inline = p.inlineData as { mimeType?: string; data?: string } | undefined;
    const text = p.text as string | undefined;
    if (fd?.fileUri) return `f:${fd.mimeType || ""}:${fd.fileUri}`;
    if (inline?.data) return `i:${inline.mimeType || ""}:${crypto.createHash("sha1").update(inline.data).digest("hex").slice(0, 12)}`;
    if (typeof text === "string") return `t:${text}`;
    return JSON.stringify(p);
  });
  return crypto.createHash("sha256").update(condensed.join("||")).digest("hex").slice(0, 16);
}

function cacheKey(params: CombinedCacheParams): string {
  const sysHash = params.system
    ? crypto.createHash("sha256").update(params.system).digest("hex").slice(0, 12)
    : "nosys";
  const partHash = fingerprintParts(params.cacheableParts);
  return `${params.model}:${params.sessionKey}:${sysHash}:${partHash}`;
}

/**
 * Get or create a combined Gemini cache. Returns null when caching is
 * disabled, the prompt is too small for Gemini's minimum cache size, or the
 * create call failed for any reason. Callers MUST handle null by falling
 * back to inlining the content.
 */
export async function getOrCreateCombinedCache(
  params: CombinedCacheParams
): Promise<string | null> {
  if (process.env.ENABLE_GEMINI_CACHE !== "1") return null;
  if (!params.cacheableParts || params.cacheableParts.length === 0) return null;

  const key = cacheKey(params);
  const now = Date.now();

  const existing = entries.get(key);
  if (existing && existing.expiresAt > now) {
    return existing.name;
  }

  const pending = inFlight.get(key);
  if (pending) return pending;

  const promise = (async (): Promise<string | null> => {
    try {
      const ai = getClient();
      const config: Record<string, unknown> = {
        contents: [{ role: "user", parts: params.cacheableParts }],
        ttl: `${CACHE_TTL_SECONDS}s`,
      };
      if (params.system) {
        config.systemInstruction = params.system;
      }
      const response = await ai.caches.create({
        model: params.model,
        config,
      });
      const name = (response as { name?: string }).name ?? null;
      entries.set(key, { name, expiresAt: now + CACHE_TTL_SECONDS * 1000 });
      if (name) {
        log.info("Created combined cache", {
          model: params.model,
          sessionKey: params.sessionKey,
          name,
          partCount: params.cacheableParts.length,
        });
      }
      return name;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.debug("Skipping combined cache (create failed)", {
        model: params.model,
        sessionKey: params.sessionKey,
        error: msg,
      });
      // Memoize null for a short TTL so we don't spam the API on miss
      entries.set(key, { name: null, expiresAt: now + 5 * 60 * 1000 });
      return null;
    }
  })();

  inFlight.set(key, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(key);
  }
}

export function __resetUserCacheForTests(): void {
  entries.clear();
  inFlight.clear();
}
