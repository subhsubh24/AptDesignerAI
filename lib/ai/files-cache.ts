// In-process Files API cache.
//
// The Gemini Files API lets us upload an asset once and reference it by
// `file_uri` across many `generateContent` calls. For assets we send to
// Gemini repeatedly inside a single request (e.g. the floor plan image
// during a diagnosis — consumed by room-diagnostician, greedy-decorator
// for 10-20 iterations, the critique pass, and the validation agent), this
// removes per-call I/O to Supabase, base64 encoding, and request-body
// inflation. Gemini still tokenizes the image at the same rate, so this
// is a latency/bandwidth optimization, not a token one.
//
// The cache is module-level (per-process). Warm serverless instances see
// cache hits across subsequent requests too. Files expire in 48h; we
// treat entries older than 47h as stale and re-upload.
//
// Failure mode: ANY upload failure returns null and the caller falls back
// to the existing inline/URL path. Files API is a fast-path, never a
// hard dependency.

import { GoogleGenAI } from "@google/genai";
import { createLogger } from "@/lib/logging/logger";

const log = createLogger("files-cache");

// 47h safety margin — Google's hard limit is 48h.
const MAX_AGE_MS = 47 * 60 * 60 * 1000;

export interface CachedFile {
  /** Fully-qualified Gemini URI, e.g. "https://generativelanguage.googleapis.com/v1beta/files/abc123". */
  uri: string;
  mimeType: string;
  /** Wall-clock ms after which we treat the entry as stale. */
  expiresAtMs: number;
  /** The `files/{id}` resource name used by the delete API. */
  name: string;
}

// Key is the source URL (Supabase, http(s), or /uploads/...) — dedupes both
// concurrent lookups (returns the in-flight promise) and subsequent lookups
// (returns the resolved cache entry).
//
// Bounded LRU — long-running serverless containers can see thousands of
// distinct source URLs; without eviction the map grows unbounded. We keep
// the most recently touched `MAX_ENTRIES` and drop the oldest. TTL still
// applies independently via `expiresAtMs`.
const MAX_ENTRIES = 500;
const cache = new Map<string, Promise<CachedFile | null>>();

function touch(key: string, value: Promise<CachedFile | null>): void {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > MAX_ENTRIES) {
    const next = cache.keys().next();
    if (next.done || next.value === undefined) break;
    cache.delete(next.value);
  }
}

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  if (!client) client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return client;
}

async function fetchAsBlob(url: string): Promise<{ blob: Blob; mimeType: string }> {
  // Local uploads: read from disk
  if (url.startsWith("/uploads/")) {
    const fs = await import("fs");
    const path = await import("path");
    const filePath = path.join(process.cwd(), "public", url);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Local file not found: ${filePath}`);
    }
    const buffer = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mimeType =
      ext === ".png" ? "image/png" :
      ext === ".webp" ? "image/webp" :
      ext === ".pdf" ? "application/pdf" :
      "image/jpeg";
    return { blob: new Blob([buffer], { type: mimeType }), mimeType };
  }

  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,application/pdf,*/*;q=0.8",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
  }
  const contentType = (response.headers.get("content-type") || "").split(";")[0].trim();
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength === 0) {
    throw new Error("Empty response body");
  }
  const mimeType = contentType || "image/jpeg";
  return { blob: new Blob([buffer], { type: mimeType }), mimeType };
}

/**
 * Return a cached Files API handle for the given source URL, uploading if
 * necessary. Returns null on any failure so callers can gracefully fall
 * back to sending the asset inline.
 *
 * The upload is deduped both by in-flight promise and by cache hit. Stale
 * entries (>47h old) are transparently refreshed.
 */
export async function getOrUploadFile(sourceUrl: string): Promise<CachedFile | null> {
  if (!sourceUrl) return null;

  const existing = cache.get(sourceUrl);
  if (existing) {
    const resolved = await existing;
    if (resolved && resolved.expiresAtMs > Date.now()) {
      // Bump LRU recency.
      touch(sourceUrl, existing);
      return resolved;
    }
    // Stale — fall through to re-upload.
    cache.delete(sourceUrl);
  }

  const promise = uploadNow(sourceUrl).catch((err) => {
    // Don't poison the cache with failures — drop so the next call retries.
    cache.delete(sourceUrl);
    log.warn("Files API upload failed — falling back to inline", {
      url: sourceUrl,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  });
  touch(sourceUrl, promise);
  return promise;
}

async function uploadNow(sourceUrl: string): Promise<CachedFile | null> {
  const { blob, mimeType } = await fetchAsBlob(sourceUrl);
  const ai = getClient();
  const uploaded = await ai.files.upload({
    file: blob,
    config: { mimeType },
  });

  // The SDK returns the File resource; the model accepts .uri on generate.
  // Newly uploaded files may briefly be in PROCESSING state (mostly relevant
  // for video). For images/PDFs the state is typically ACTIVE immediately —
  // if not, Gemini will queue the generateContent call until it's ready.
  if (!uploaded.uri || !uploaded.name) {
    throw new Error("Upload succeeded but returned no uri/name");
  }

  const entry: CachedFile = {
    uri: uploaded.uri,
    name: uploaded.name,
    mimeType: uploaded.mimeType || mimeType,
    expiresAtMs: Date.now() + MAX_AGE_MS,
  };
  log.info("Files API upload cached", {
    url: sourceUrl.slice(0, 80),
    uri: entry.uri,
    mimeType: entry.mimeType,
  });
  return entry;
}

/**
 * Clear the in-process cache. Intended for tests only.
 */
export function __resetFilesCacheForTests(): void {
  cache.clear();
}
