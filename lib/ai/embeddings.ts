/**
 * Multimodal embeddings for the furniture product identification feature.
 *
 * Wraps Google's `multimodalembedding@001` (1408-dim), which takes an image
 * (and optional text) and returns a shared-space embedding vector. Used for:
 *  - Seeding the catalog vector index (scripts/seed-product-embeddings.ts)
 *  - Generating a query vector from a cropped furniture region at identify time
 *  - Writing embeddings of user-confirmed crops back to the index
 *
 * Keep this as a thin wrapper — the table layout, ANN search, and self-learning
 * write-back all live in `lib/store/embedding-index.ts`.
 */

import { GoogleGenAI } from "@google/genai";
import fs from "fs";
import path from "path";
import { createLogger } from "@/lib/logging/logger";

const log = createLogger("embeddings");

/** 1408 for `multimodalembedding@001`. Asserted at runtime. */
export const EMBEDDING_DIM = 1408;

export interface EmbedImageInput {
  /** Absolute URL, `/uploads/…` local path, or `{ data, mimeType }` base64. */
  image: string | { data: string; mimeType: string };
  /** Optional short caption/label to steer the shared-space embedding. */
  text?: string;
}

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  if (!client) {
    client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return client;
}

/**
 * Read an image from disk or the network and return { data, mimeType } in
 * base64. Mirrors gemini.ts's internal fetcher so we don't couple to its
 * non-exported helper.
 */
async function fetchImageAsBase64(url: string): Promise<{ data: string; mimeType: string }> {
  if (url.startsWith("/uploads/")) {
    const filePath = path.join(process.cwd(), "public", url);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Local image not found: ${filePath}`);
    }
    const buffer = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mimeType = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
    return { data: buffer.toString("base64"), mimeType };
  }

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
      "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    throw new Error(`Image fetch failed: ${response.status} ${response.statusText} for ${url}`);
  }
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.startsWith("image/")) {
    throw new Error(`Non-image content-type: ${contentType} for ${url}`);
  }
  const buffer = await response.arrayBuffer();
  return {
    data: Buffer.from(buffer).toString("base64"),
    mimeType: contentType.split(";")[0].trim(),
  };
}

/**
 * Produce a shared-space multimodal embedding for an image (+ optional text).
 *
 * Throws on failure — callers decide whether to swallow (at seed time a single
 * bad catalog row shouldn't kill the run) or propagate (at identify time a
 * failed query embedding means we skip retrieval priors but still run vision).
 */
export async function embedImage({ image, text }: EmbedImageInput): Promise<number[]> {
  const payload = typeof image === "string" ? await fetchImageAsBase64(image) : image;

  const ai = getClient();

  // SDK shape: embedContent accepts multiple parts; an image Part + an optional
  // text Part produces the shared-space multimodal embedding.
  const parts: Record<string, unknown>[] = [
    { inlineData: { mimeType: payload.mimeType, data: payload.data } },
  ];
  if (text && text.trim().length > 0) {
    parts.push({ text: text.trim() });
  }

  let response;
  try {
    response = await ai.models.embedContent({
      model: "multimodalembedding@001",
      contents: [{ role: "user", parts }],
    });
  } catch (err) {
    log.error("embedContent call failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  const emb = response.embeddings?.[0];
  const values = (emb as { values?: number[] } | undefined)?.values;
  if (!values || !Array.isArray(values) || values.length === 0) {
    throw new Error("embedContent returned no embedding values");
  }
  if (values.length !== EMBEDDING_DIM) {
    // Not fatal — but we key the index on a specific dim. Log loudly so we
    // notice if the model is swapped out.
    log.warn("Unexpected embedding dim", { expected: EMBEDDING_DIM, got: values.length });
  }
  return values;
}

/**
 * Cosine similarity for two equal-length vectors. Returns a value in [-1, 1].
 * Caller typically normalizes to [0, 1] via `(1 + sim) / 2` only if needed;
 * for our index we treat the raw cosine as the similarity score.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`cosine: dim mismatch ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
