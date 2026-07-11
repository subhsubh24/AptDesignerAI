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

import { runFurnitureCropper, type FurnitureCrop } from "./furniture-cropper";
import { runProductIdentifier } from "./product-identifier";
import { runProductVerifier } from "./product-verifier";
import { embedImage } from "@/lib/ai/embeddings";
import { topKSimilar } from "@/lib/store/embedding-index";
import { createLogger } from "@/lib/logging/logger";
import { pLimit } from "@/lib/utils/p-limit";
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

  // ─── 2. Per-crop: embed + retrieve + identify (concurrent) ──
  // Run embed+identify in parallel. Flash Lite has 10K RPM; 20 concurrent
  // crops is well within budget. Verify runs with its own tighter pool.
  const enrichedResults: IdentifiedProductEnriched[] = [];
  let verifyCallsMade = 0;

  const identifyLimit = pLimit(20);

  type IdentifyResult = {
    crop: typeof cropperOut.crops[number];
    priors: RetrievalPrior[];
    top: import("@/lib/types/schemas").IdentifiedProductCandidate | null;
    tokens: number;
  };

  const identifyResults = await Promise.all(
    cropperOut.crops.map((crop) =>
      identifyLimit(async (): Promise<IdentifyResult> => {
        try {
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
          return {
            crop,
            priors,
            top: idOut.candidates[0] ?? null,
            tokens: idOut.tokensUsed,
          };
        } catch (err) {
          log.warn("identify task failed for crop — skipping", {
            label: crop.label,
            error: err instanceof Error ? err.message : String(err),
          });
          return { crop, priors: [], top: null, tokens: 0 };
        }
      }),
    ),
  );

  for (const r of identifyResults) {
    totalTokens += r.tokens;
  }

  // Verify phase — sequentially to respect maxVerifyCalls cap. Highest-confidence
  // crops are verified first; low-confidence crops are dropped when the cap is
  // reached (see compareVerifyPriority for the determinism-critical tiebreak).
  const verifyOrder = [...identifyResults].sort(compareVerifyPriority);
  for (const r of verifyOrder) {
    if (!r.top) continue;
    if (verifyCallsMade >= maxVerifyCalls) {
      log.info("verify cap reached, skipping", {
        brand: r.top.brand,
        model: r.top.model,
        cap: maxVerifyCalls,
      });
      break;
    }

    const verifyOut = await runProductVerifier({
      candidate: r.top,
      roomImageUrl: r.crop.source_image_url,
      sourceImageUrl: r.crop.source_image_url,
      priors: r.priors,
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
 * Stable identity for a crop — source image + label + normalized box. Used as a
 * deterministic tiebreak so equal-confidence crops verify in a fixed order,
 * independent of the identify fan-out's insertion order.
 */
export function cropSortKey(
  crop: Pick<FurnitureCrop, "source_image_url" | "label" | "box">,
): string {
  const { x, y, w, h } = crop.box;
  return `${crop.source_image_url}|${crop.label}|${x},${y},${w},${h}`;
}

/**
 * Verify-phase ordering: highest top-candidate confidence first, ties broken by
 * the stable crop key. Confidence ties are common (identification defaults to
 * 0.5) and JS sort is stable, so WITHOUT the tiebreak which tied crops win the
 * maxVerifyCalls budget — and therefore which products get verified and reach
 * the final list — would depend on the identify fan-out's insertion order rather
 * than the crop SET. The key makes the outcome a pure function of the set
 * (determinism.md: every score sort needs a final id-keyed tiebreak).
 */
export function compareVerifyPriority(
  a: { crop: Pick<FurnitureCrop, "source_image_url" | "label" | "box">; top: { confidence: number } | null },
  b: { crop: Pick<FurnitureCrop, "source_image_url" | "label" | "box">; top: { confidence: number } | null },
): number {
  return (
    (b.top?.confidence ?? 0) - (a.top?.confidence ?? 0) ||
    cropSortKey(a.crop).localeCompare(cropSortKey(b.crop))
  );
}

/**
 * Keep the highest-confidence entry per (brand, model, variant) key. This is
 * a common case — a sofa photographed from two angles produces two identical
 * candidates. Variant is included so legitimate siblings like
 * "West Elm Harmony" (sofa) + "West Elm Harmony" (sectional) stay as distinct
 * identified products instead of silently collapsing into one row.
 *
 * We don't merge evidence because the higher-confidence entry's evidence is
 * usually from the clearer angle, which is what the UI wants to surface.
 */
function dedupKey(item: IdentifiedProductEnriched): string {
  const variantKey = (item.variant ?? "").toLowerCase().trim();
  return `${item.brand.toLowerCase().trim()}::${item.model.toLowerCase().trim()}::${variantKey}`;
}

export function dedupByBrandModel(
  items: IdentifiedProductEnriched[],
): IdentifiedProductEnriched[] {
  const byKey = new Map<string, IdentifiedProductEnriched>();
  for (const item of items) {
    const key = dedupKey(item);
    const existing = byKey.get(key);
    if (!existing || item.confidence > existing.confidence) {
      byKey.set(key, item);
    }
  }
  // Sort by confidence, with the (brand,model,variant) key as a stable tiebreak.
  // Ties are common — identification defaults to 0.5 and many products share it —
  // and JS sort is stable, so without the tiebreak the output order would depend
  // on Map insertion order (i.e. the upstream `items` order). That silently feeds
  // downstream display + the scoring context an order that varies with input
  // sequencing. The key tiebreak makes the result a pure function of the SET
  // (determinism.md: every score sort needs a final id-keyed tiebreak).
  return Array.from(byKey.values()).sort(
    (a, b) => b.confidence - a.confidence || dedupKey(a).localeCompare(dedupKey(b)),
  );
}
