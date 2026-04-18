import { createHash } from "crypto";
import { DETERMINISTIC } from "@/lib/ai/determinism";
import { createLogger } from "@/lib/logging/logger";
import type { PriceTier } from "@/lib/prompts/search-brief";
import type { SearchCandidate } from "./shopping-researcher";
import type { DesignDirection } from "@/lib/types/database";

const log = createLogger("search-cache");

const CACHE_TTL_MS = 48 * 60 * 60 * 1000;
const MAX_ENTRIES = 500;

interface Entry<T> {
  data: T;
  timestamp: number;
}

function lruSet<T>(cache: Map<string, Entry<T>>, key: string, data: T) {
  cache.set(key, { data, timestamp: Date.now() });
  if (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
}

function lruGet<T>(cache: Map<string, Entry<T>>, key: string): T | null {
  if (DETERMINISTIC) return null;
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

// ─── Query cache (web search results) ──────────────────────────
const queryCache = new Map<string, Entry<SearchCandidate[]>>();

function queryKey(
  query: string,
  tier: PriceTier | undefined,
  category: string | undefined,
  maxResults: number
): string {
  const payload = JSON.stringify({ q: query, t: tier ?? "", c: category ?? "", n: maxResults });
  return createHash("sha256").update(payload).digest("hex");
}

export function getCachedQuery(
  query: string,
  tier: PriceTier | undefined,
  category: string | undefined,
  maxResults: number
): SearchCandidate[] | null {
  const hit = lruGet(queryCache, queryKey(query, tier, category, maxResults));
  if (hit) log.debug("query cache hit", { query: query.slice(0, 60), tier, category });
  return hit;
}

export function cacheQuery(
  query: string,
  tier: PriceTier | undefined,
  category: string | undefined,
  maxResults: number,
  data: SearchCandidate[]
) {
  lruSet(queryCache, queryKey(query, tier, category, maxResults), data);
}

// ─── Screen cache (per-batch quick-screen results) ─────────────
const screenCache = new Map<string, Entry<SearchCandidate[]>>();

function briefFingerprint(
  category: string,
  tier: PriceTier,
  requirements: string[],
  designDirection?: DesignDirection
): string {
  const d = designDirection
    ? `${designDirection.style_notes ?? ""}|${(designDirection.recommended_palette ?? []).join(",")}|${(designDirection.recommended_materials ?? []).join(",")}`
    : "";
  return `${category}|${tier}|${requirements.join(",")}|${d}`;
}

function screenKey(
  batch: SearchCandidate[],
  category: string,
  tier: PriceTier,
  requirements: string[],
  designDirection?: DesignDirection
): string {
  // URLs are the stable identity of a batch. Sort so ordering doesn't
  // invalidate the cache on otherwise identical batches.
  const urls = batch.map((c) => c.url).sort().join("\n");
  const brief = briefFingerprint(category, tier, requirements, designDirection);
  return createHash("sha256").update(urls + "||" + brief).digest("hex");
}

export function getCachedScreen(
  batch: SearchCandidate[],
  category: string,
  tier: PriceTier,
  requirements: string[],
  designDirection?: DesignDirection
): SearchCandidate[] | null {
  const hit = lruGet(screenCache, screenKey(batch, category, tier, requirements, designDirection));
  if (hit) log.debug("screen cache hit", { category, tier, size: batch.length });
  return hit;
}

export function cacheScreen(
  batch: SearchCandidate[],
  category: string,
  tier: PriceTier,
  requirements: string[],
  designDirection: DesignDirection | undefined,
  passed: SearchCandidate[]
) {
  lruSet(screenCache, screenKey(batch, category, tier, requirements, designDirection), passed);
}
