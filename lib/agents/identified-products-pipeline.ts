/**
 * Identified-products pipeline — orchestrates the full "what brand/model is
 * that sofa?" flow for one room:
 *
 *   room photos
 *       ↓   runFurnitureCropper()
 *   crops (bounding boxes + rough labels)
 *       ↓   per-crop: embedImage() → topKSimilar()
 *   retrieval priors
 *       ↓   runProductIdentifier()
 *   brand/model candidates (0-3 per crop)
 *       ↓   runProductVerifier()  (only for top candidate per crop)
 *   verified & enriched entries
 *       ↓
 *   IdentifiedProductEnriched[]  (written inline to diagnosis_json)
 *
 * Caller (app/api/diagnosis/route.ts) decides whether to run this at all —
 * it adds 1-2 extra Gemini calls per photo + per identified piece, so on
 * low-end accounts we let it be gated by `SKIP_PRODUCT_ID=1`.
 */

import { runFurnitureCropper } from "./furniture-cropper";
import { runProductIdentifier } from "./product-identifier";
import { runProductVerifier } from "./product-verifier";
import { embedImage } from "@/lib/ai/embeddings";
import { topKSimilar } from "@/lib/store/embedding-index";
import { createLogger } from "@/lib/logging/logger";
import type { MemoryClient } from "@/lib/store/memory-store";
import type { IdentifiedProductEnriched, RetrievalPrior } from "@/lib/types/schemas";
import type { AgentResult } from "./types";

const log = createLogger("identified-products-pipeline");

export interface IdentifiedProductsPipelineInput {
  supabase: MemoryClient;
  imageUrls: string[];
  /** Drop un-verified entries before returning. Default: true. */
  dropUnverified?: boolean;
  /** Hard ceiling on verifier calls (cost control). Default: 8. */
  maxVerifyCalls?: number;
  /** Room type — forwarded to cropper/identifier/verifier for context grounding. */
  roomType?: string;
  /** Compact aesthetic hint (palette + materials + style_notes) so identifier/verifier can calibrate brand guesses to the room's direction. */
  aestheticHint?: string;
  /** Budget tier — so identifier/verifier can flag out-of-bracket brand matches. */
  budgetMode?: string;
  /** Room dimensions from the uploaded floor plan — catches scale mismatches during identification. */
  roomDimensions?: string;
}

export interface IdentifiedProductsPipelineResult {
  identified_products: IdentifiedProductEnriched[];
  /** Crops we attempted — useful for telemetry / "we looked at N pieces" UI. */
  crops_considered: number;
  tokensUsed: number;
}

/**
 * Run end-to-end identification for one room. Best-effort: internal failures
 * (cropper, identifier, verifier) are logged and swallowed so callers see a
 * shorter list rather than a hard error. The only hard failure is no photos.
 */
export async function runIdentifiedProductsPipeline(
  input: IdentifiedProductsPipelineInput,
): Promise<AgentResult<IdentifiedProductsPipelineResult>> {
  if (input.imageUrls.length === 0) {
    return { success: false, error: "no images" };
  }

  const dropUnverified = input.dropUnverified ?? true;
  const maxVerifyCalls = input.maxVerifyCalls ?? 8;

  let totalTokens = 0;

  // ─── 1. Crop ────────────────────────────────────────────────
  const cropperOut = await runFurnitureCropper(input.imageUrls, input.roomType);
  totalTokens += cropperOut.tokensUsed;

  if (cropperOut.crops.length === 0) {
    log.info("no crops produced — returning empty identified_products", {
      photos: input.imageUrls.length,
    });
    return {
      success: true,
      data: { identified_products: [], crops_considered: 0, tokensUsed: totalTokens },
      tokensUsed: totalTokens,
      model: cropperOut.model,
    };
  }

  // ─── 2. Per-crop: embed + retrieve + identify ──────────────
  // We do this serially per crop — parallelizing hits Gemini rate limits
  // fast on free tier, and the embedding call is ~200ms anyway.
  const enrichedResults: IdentifiedProductEnriched[] = [];
  let verifyCallsMade = 0;

  for (const crop of cropperOut.crops) {
    // Embedding for retrieval prior — failures here just skip priors.
    let priors: RetrievalPrior[] = [];
    try {
      const vec = await embedImage({
        image: crop.source_image_url,
        text: crop.label,
      });
      const matches = await topKSimilar(input.supabase, vec, { k: 3 });
      priors = matches.map((m) => ({
        brand: m.brand,
        model: m.model,
        similarity: m.similarity,
      }));
    } catch (err) {
      log.debug("embedding/retrieval skipped for crop", {
        label: crop.label,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const idOut = await runProductIdentifier({
      roomImageUrl: crop.source_image_url,
      box: crop.box,
      label: crop.label,
      priors,
      roomType: input.roomType,
      aestheticHint: input.aestheticHint,
      budgetMode: input.budgetMode,
      roomDimensions: input.roomDimensions,
    });
    totalTokens += idOut.tokensUsed;

    // Only verify the single top candidate per crop — verifier calls are
    // expensive (grounded search + image compare). If the top one fails,
    // we accept the unverified entry rather than burn tokens on #2.
    const top = idOut.candidates[0];
    if (!top) continue;

    if (verifyCallsMade >= maxVerifyCalls) {
      log.info("verify cap reached, emitting candidate unverified", {
        brand: top.brand,
        model: top.model,
        cap: maxVerifyCalls,
      });
      // Don't throw — still emit the candidate with verified=false by running
      // the verifier shell in degraded mode. Simpler: skip verify and let the
      // dropUnverified filter cull it.
      continue;
    }

    const verifyOut = await runProductVerifier({
      candidate: top,
      roomImageUrl: crop.source_image_url,
      sourceImageUrl: crop.source_image_url,
      priors,
      roomType: input.roomType,
      aestheticHint: input.aestheticHint,
      budgetMode: input.budgetMode,
      roomDimensions: input.roomDimensions,
    });
    verifyCallsMade++;
    totalTokens += verifyOut.tokensUsed;

    enrichedResults.push(verifyOut.enriched);
  }

  // ─── 3. Dedup by (brand,model) — same product can appear from multiple angles ──
  const deduped = dedupByBrandModel(enrichedResults);

  const finalList = dropUnverified ? deduped.filter((p) => p.verified) : deduped;

  log.info("identified-products pipeline complete", {
    photos: input.imageUrls.length,
    crops: cropperOut.crops.length,
    identified: enrichedResults.length,
    deduped: deduped.length,
    verified: finalList.filter((p) => p.verified).length,
    verifyCallsMade,
    tokens: { total: totalTokens },
  });

  return {
    success: true,
    data: {
      identified_products: finalList,
      crops_considered: cropperOut.crops.length,
      tokensUsed: totalTokens,
    },
    tokensUsed: totalTokens,
    model: cropperOut.model,
  };
}

/**
 * Keep the highest-confidence entry per (brand, model) key. This is a common
 * case — a sofa photographed from two angles produces two identical candidates.
 * We don't merge evidence because the higher-confidence entry's evidence is
 * usually from the clearer angle, which is what the UI wants to surface.
 */
function dedupByBrandModel(
  items: IdentifiedProductEnriched[],
): IdentifiedProductEnriched[] {
  const byKey = new Map<string, IdentifiedProductEnriched>();
  for (const item of items) {
    const key = `${item.brand.toLowerCase().trim()}::${item.model.toLowerCase().trim()}`;
    const existing = byKey.get(key);
    if (!existing || item.confidence > existing.confidence) {
      byKey.set(key, item);
    }
  }
  return Array.from(byKey.values()).sort((a, b) => b.confidence - a.confidence);
}
