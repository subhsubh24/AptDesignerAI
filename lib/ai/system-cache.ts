/**
 * Explicit Gemini context caching for the system prompt.
 *
 * Creates a cached content entry (via `ai.caches.create`) keyed on
 * {model, sha256(systemPrompt)} so repeated requests with an identical
 * system instruction avoid re-tokenizing the prompt and pay the cheaper
 * cache-hit rate.
 *
 * Gemini imposes a minimum prompt size for explicit caching (~1024 tokens
 * on Flash, 4096 on Pro at time of writing). On APIs that reject small
 * payloads we catch the error, memoize `null`, and callers fall back to
 * inline systemInstruction without breakage.
 *
 * Opt-in via `ENABLE_GEMINI_CACHE=1` env var. Off by default so local
 * development and tests never make unnecessary API calls.
 */

import crypto from "crypto";
import { GoogleGenAI } from "@google/genai";
import { createLogger } from "@/lib/logging/logger";

const log = createLogger("system-cache");

/** 50 minutes — shorter than the 1h Gemini default so we refresh before expiry. */
const CACHE_TTL_SECONDS = 50 * 60;

interface CacheEntry {
  /** Gemini cache name, e.g. "cachedContents/abc123". Null when create failed. */
  name: string | null;
  /** When this entry expires (ms since epoch). */
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

function cacheKey(model: string, systemPrompt: string): string {
  const hash = crypto.createHash("sha256").update(systemPrompt).digest("hex").slice(0, 16);
  return `${model}:${hash}`;
}

/**
 * Get or create a Gemini cache entry for this system prompt.
 * Returns the cache name on success, or null when caching is disabled,
 * unsupported (prompt too small), or the create call failed.
 *
 * Callers MUST handle a null return by falling back to `systemInstruction`.
 */
export async function getOrCreateSystemCache(
  model: string,
  systemPrompt: string
): Promise<string | null> {
  if (process.env.ENABLE_GEMINI_CACHE !== "1") return null;
  if (!systemPrompt || systemPrompt.length === 0) return null;

  const key = cacheKey(model, systemPrompt);
  const now = Date.now();

  const existing = entries.get(key);
  if (existing && existing.expiresAt > now) {
    return existing.name;
  }

  // Coalesce concurrent creates for the same key
  const pending = inFlight.get(key);
  if (pending) return pending;

  const promise = (async (): Promise<string | null> => {
    try {
      const ai = getClient();
      const response = await ai.caches.create({
        model,
        config: {
          systemInstruction: systemPrompt,
          ttl: `${CACHE_TTL_SECONDS}s`,
        },
      });
      const name = (response as { name?: string }).name ?? null;
      entries.set(key, { name, expiresAt: now + CACHE_TTL_SECONDS * 1000 });
      if (name) {
        log.info("Created system prompt cache", { model, cacheKey: key, name });
      }
      return name;
    } catch (err) {
      // Most common failure: prompt under the minimum token count. Memoize
      // the null result for a short TTL so we don't spam the API on miss.
      const msg = err instanceof Error ? err.message : String(err);
      log.debug("Skipping system cache (create failed)", { model, error: msg });
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

/** Test-only helper: clear the in-memory cache between tests. */
export function __resetSystemCacheForTests(): void {
  entries.clear();
  inFlight.clear();
}
