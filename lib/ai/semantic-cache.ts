/**
 * Semantic prompt cache.
 *
 * Wraps any `(cacheKey, text) → value` producer with an in-memory LRU
 * keyed by the text's embedding vector. On lookup we embed the incoming
 * text once and scan the store for an existing entry above the cosine
 * similarity threshold; a near-miss returns the cached response instead
 * of burning a full LLM call.
 *
 * Designed for iterative user flows where the same room or area is
 * re-analyzed with minor phrasing changes ("more cozy" vs. "cozier"). The
 * cache is bucketed by an opaque `namespace` (typically the room id +
 * operation) so cross-user lookups can't leak.
 *
 * Intentionally in-memory / per-process — this is a speed-and-cost
 * optimization, not a source of truth. Run-time state is lost on restart
 * and never persisted to the DB.
 */

import { GoogleGenAI } from "@google/genai";
import { cosineSimilarity } from "./embeddings";
import { DETERMINISTIC } from "./determinism";
import { createLogger } from "@/lib/logging/logger";

const log = createLogger("semantic-cache");

/** Google text-embedding model used for the similarity lookup. */
const EMBED_MODEL = "text-embedding-004";
const DEFAULT_THRESHOLD = 0.93;
const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour
const DEFAULT_MAX_ENTRIES = 500;

interface CacheRow<V> {
  embedding: number[];
  value: V;
  /** When the entry expires (ms since epoch). */
  expiresAt: number;
  /** Used for LRU eviction. */
  lastAccessedAt: number;
  /** Original text — kept for debugging/observability, not for lookup. */
  text: string;
}

const buckets = new Map<string, CacheRow<unknown>[]>();

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  if (!client) {
    client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return client;
}

async function embedText(text: string): Promise<number[] | null> {
  try {
    const response = await getClient().models.embedContent({
      model: EMBED_MODEL,
      contents: [{ role: "user", parts: [{ text }] }],
    });
    const values = (response.embeddings?.[0] as { values?: number[] } | undefined)?.values;
    if (!values || values.length === 0) return null;
    return values;
  } catch (err) {
    log.debug("embedText failed — cache miss", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export interface SemanticCacheOptions {
  /** Cosine similarity threshold for a hit. Default: 0.93 */
  threshold?: number;
  /** Entry TTL in ms. Default: 1 hour. */
  ttlMs?: number;
  /** Max entries per namespace before LRU eviction. Default: 500. */
  maxEntries?: number;
}

/**
 * Try to read a cached value whose embedding is ≥ threshold similar to
 * the text's embedding. Returns `null` on any miss (expired, below
 * threshold, embed failure).
 *
 * The call is side-effect-free apart from updating LRU bumps and
 * evicting expired rows for the given namespace.
 */
export async function semanticLookup<V>(
  namespace: string,
  text: string,
  options: SemanticCacheOptions = {}
): Promise<{ value: V; similarity: number } | null> {
  if (DETERMINISTIC) return null;
  if (process.env.ENABLE_SEMANTIC_CACHE !== "1") return null;
  if (!text || text.trim().length === 0) return null;

  const { threshold = DEFAULT_THRESHOLD } = options;
  const rows = buckets.get(namespace);
  if (!rows || rows.length === 0) return null;

  const now = Date.now();
  // Drop expired rows inline so the scan below only visits live entries.
  const live = rows.filter((r) => r.expiresAt > now);
  if (live.length !== rows.length) buckets.set(namespace, live);
  if (live.length === 0) return null;

  const queryEmbedding = await embedText(text);
  if (!queryEmbedding) return null;

  let bestSim = -Infinity;
  let bestRow: CacheRow<unknown> | null = null;
  for (const row of live) {
    // Cosine can throw on dim mismatch — skip those rows silently so a
    // model swap doesn't corrupt the whole cache.
    let sim = -Infinity;
    try {
      sim = cosineSimilarity(queryEmbedding, row.embedding);
    } catch {
      continue;
    }
    if (sim > bestSim) {
      bestSim = sim;
      bestRow = row;
    }
  }

  if (!bestRow || bestSim < threshold) {
    return null;
  }

  bestRow.lastAccessedAt = now;
  log.info("Semantic cache hit", { namespace, similarity: Number(bestSim.toFixed(4)) });
  return { value: bestRow.value as V, similarity: bestSim };
}

/**
 * Store a {text → value} pair in the cache. Re-embeds the text to key the
 * entry. Callers should call this AFTER a successful LLM response.
 */
export async function semanticStore<V>(
  namespace: string,
  text: string,
  value: V,
  options: SemanticCacheOptions = {}
): Promise<void> {
  if (DETERMINISTIC) return;
  if (process.env.ENABLE_SEMANTIC_CACHE !== "1") return;
  if (!text || text.trim().length === 0) return;

  const {
    ttlMs = DEFAULT_TTL_MS,
    maxEntries = DEFAULT_MAX_ENTRIES,
  } = options;

  const embedding = await embedText(text);
  if (!embedding) return;

  const rows = (buckets.get(namespace) ?? []) as CacheRow<unknown>[];
  rows.push({
    embedding,
    value: value as unknown,
    expiresAt: Date.now() + ttlMs,
    lastAccessedAt: Date.now(),
    text: text.slice(0, 200),
  });

  // LRU eviction: drop the oldest entries until we're back under the cap.
  if (rows.length > maxEntries) {
    rows.sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);
    rows.splice(0, rows.length - maxEntries);
  }

  buckets.set(namespace, rows);
}

/** Test-only: clear a namespace (or everything if `namespace` is omitted). */
export function __resetSemanticCacheForTests(namespace?: string): void {
  if (namespace) buckets.delete(namespace);
  else buckets.clear();
}
