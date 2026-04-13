/**
 * Thin wrapper around the `product_image_embeddings` table.
 *
 * Responsibilities:
 *  - `topKSimilar()` — cosine nearest-neighbor over whatever rows exist.
 *    The in-memory store does a full scan (fine up to a few thousand rows).
 *    When we move to Supabase + pgvector, swap this to an RPC call without
 *    touching callers.
 *  - `insertEmbedding()` — write catalog seed rows and user-confirmed
 *    self-learning rows back to the index.
 *
 * The orchestrator uses this module to turn a cropped furniture region into
 * `RetrievalPrior[]` that are fed to the identifier as hints.
 */

import type { MemoryClient } from "@/lib/store/memory-store";
import { cosineSimilarity } from "@/lib/ai/embeddings";
import type { ProductImageEmbedding } from "@/lib/types/database";
import { createLogger } from "@/lib/logging/logger";

const log = createLogger("embedding-index");

export interface TopKMatch {
  brand: string;
  model: string;
  variant: string | null;
  image_url: string;
  similarity: number;
  source: string;
}

/**
 * Return the top-K embeddings most similar to `queryVector`.
 *
 * `minSimilarity` filters out weak matches (default 0.55 — the identifier
 * treats priors below this as noise anyway). Result is sorted descending.
 */
export async function topKSimilar(
  supabase: MemoryClient,
  queryVector: number[],
  options: { k?: number; minSimilarity?: number } = {},
): Promise<TopKMatch[]> {
  const k = options.k ?? 5;
  const minSimilarity = options.minSimilarity ?? 0.55;

  const { data, error } = await supabase.from("product_image_embeddings").select("*");
  if (error) {
    log.warn("embedding index read failed", { error: String(error) });
    return [];
  }
  const rows = (data as ProductImageEmbedding[] | null) ?? [];
  if (rows.length === 0) return [];

  const scored: TopKMatch[] = [];
  for (const row of rows) {
    if (!row.embedding || row.embedding.length !== queryVector.length) continue;
    const sim = cosineSimilarity(queryVector, row.embedding);
    if (sim < minSimilarity) continue;
    scored.push({
      brand: row.brand,
      model: row.model,
      variant: row.variant ?? null,
      image_url: row.image_url,
      similarity: sim,
      source: row.source,
    });
  }

  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, k);
}

export interface InsertEmbeddingInput {
  brand: string;
  model: string;
  variant?: string | null;
  image_url: string;
  embedding: number[];
  /** "catalog" for seed rows, "user_confirmed" for self-learning write-back. */
  source: "catalog" | "user_confirmed" | string;
}

/**
 * Persist an embedding row. Safe to call repeatedly — we intentionally do not
 * dedupe by (brand, model, image_url) because slight variants of the same
 * model from different angles genuinely improve retrieval. If the catalog
 * seeder cares about dedup, it should query first.
 */
export async function insertEmbedding(
  supabase: MemoryClient,
  input: InsertEmbeddingInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.from("product_image_embeddings").insert({
    brand: input.brand,
    model: input.model,
    variant: input.variant ?? null,
    image_url: input.image_url,
    embedding: input.embedding,
    source: input.source,
  });
  if (error) {
    return { ok: false, error: String(error) };
  }
  return { ok: true };
}
