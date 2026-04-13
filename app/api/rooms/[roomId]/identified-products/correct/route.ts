/**
 * Correction endpoint — "Different model" flow.
 *
 * The frontend calls this when the user rejected an identifier's guess AND
 * picked a specific replacement model from the typeahead. We:
 *
 *   1. Mark the original (rejected) entry as `user_confirmed: false`.
 *   2. Run the verifier's grounded enrichment against the user's pick to
 *      populate dimensions / materials / colors / price_range / canonical_url.
 *   3. Insert the enriched entry alongside the original with
 *      `correction_source: "user"` and `user_confirmed: true`.
 *   4. Embedding write-back so the corrected model's visual becomes a prior
 *      for future identification runs.
 *
 * Body:
 *   {
 *     original: { brand, model },                // entry being corrected
 *     corrected: { brand, model, variant? },     // user's replacement
 *     source_image_url?: string,                 // for the embedding write-back
 *     bounding_box?: { x, y, w, h }
 *   }
 *
 * Failure modes are best-effort: enrichment failure still creates the
 * user-confirmed entry with null canonical fields (so downstream treats it
 * as "known category present" but can't apply canonical dimensions).
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createLogger } from "@/lib/logging/logger";
import { runProductVerifier } from "@/lib/agents/product-verifier";
import { embedImage } from "@/lib/ai/embeddings";
import { insertEmbedding } from "@/lib/store/embedding-index";
import type { DiagnosisData, IdentifiedProduct } from "@/lib/types/database";
import type { IdentifiedProductCandidate } from "@/lib/types/schemas";

const log = createLogger("identified-products-correct");

interface CorrectBody {
  original: { brand: string; model: string };
  corrected: { brand: string; model: string; variant?: string | null };
  source_image_url?: string | null;
  bounding_box?: { x: number; y: number; w: number; h: number } | null;
}

function isCorrectBody(x: unknown): x is CorrectBody {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  const orig = o.original as Record<string, unknown> | undefined;
  const corr = o.corrected as Record<string, unknown> | undefined;
  return (
    !!orig && typeof orig.brand === "string" && typeof orig.model === "string" &&
    !!corr && typeof corr.brand === "string" && typeof corr.model === "string"
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  const { roomId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!isCorrectBody(body)) {
    return NextResponse.json(
      { error: "Body must include { original: {brand,model}, corrected: {brand,model} }" },
      { status: 400 },
    );
  }

  // Locate the most-recent diagnosis (same as the confirm endpoint).
  const { data: diagnoses, error: fetchErr } = await supabase
    .from("room_diagnoses")
    .select("*")
    .eq("room_id", roomId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (fetchErr) {
    return NextResponse.json({ error: String(fetchErr) }, { status: 500 });
  }
  const diagnosisRow = Array.isArray(diagnoses) ? diagnoses[0] : diagnoses;
  if (!diagnosisRow) {
    return NextResponse.json({ error: "No diagnosis for this room" }, { status: 404 });
  }

  const diagnosisJson = diagnosisRow.diagnosis_json as DiagnosisData | undefined;
  const current: IdentifiedProduct[] = diagnosisJson?.identified_products ?? [];
  if (current.length === 0) {
    return NextResponse.json(
      { error: "This diagnosis has no identified_products to correct" },
      { status: 404 },
    );
  }

  const origIdx = current.findIndex(
    (p) =>
      p.brand.toLowerCase() === body.original.brand.toLowerCase() &&
      p.model.toLowerCase() === body.original.model.toLowerCase(),
  );
  if (origIdx === -1) {
    return NextResponse.json(
      { error: `No identified_product matching ${body.original.brand} / ${body.original.model}` },
      { status: 404 },
    );
  }

  const original = current[origIdx];
  const sourceImageUrl = body.source_image_url ?? original.source_image_url ?? undefined;
  const boundingBox = body.bounding_box ?? original.bounding_box ?? undefined;
  const category = original.category || "other";

  // Run the verifier with a synthetic candidate built from the user's pick.
  // We reuse the room photo we have on hand (sourceImageUrl) to ground the
  // enrichment — worst case the match-score is low, which is fine: the user
  // already confirmed the model, so we honor their call regardless.
  const syntheticCandidate: IdentifiedProductCandidate = {
    brand: body.corrected.brand,
    model: body.corrected.model,
    variant: body.corrected.variant ?? null,
    category,
    confidence: 1, // user-confirmed
    evidence: "user-corrected via Different-model flow",
    distinguishing_features: [],
    bounding_box: boundingBox ?? null,
  };

  let enrichedEntry: IdentifiedProduct | null = null;
  if (sourceImageUrl) {
    try {
      const verifyOut = await runProductVerifier({
        candidate: syntheticCandidate,
        roomImageUrl: sourceImageUrl,
        sourceImageUrl,
        priors: [],
      });
      enrichedEntry = {
        ...verifyOut.enriched,
        user_confirmed: true,
        correction_source: "user",
      };
    } catch (err) {
      log.warn("verifier failed during correction — keeping minimal entry", {
        brand: body.corrected.brand,
        model: body.corrected.model,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Fallback: build a minimal entry from scratch if we had no image or the
  // verifier blew up. Downstream still treats it as "known category present".
  if (!enrichedEntry) {
    enrichedEntry = {
      brand: body.corrected.brand,
      model: body.corrected.model,
      variant: body.corrected.variant ?? null,
      category,
      confidence: 1,
      verified: false,
      user_confirmed: true,
      canonical_url: null,
      source_urls: [],
      dimensions: null,
      materials: [],
      colors: [],
      price_range: null,
      image_url: null,
      evidence: "user-corrected via Different-model flow",
      distinguishing_features: [],
      retrieval_priors: [],
      correction_source: "user",
      embedding_written_back: false,
      bounding_box: boundingBox ?? null,
      source_image_url: sourceImageUrl ?? null,
    };
  }

  // Self-learning write-back: write the corrected embedding against the
  // user's pick so it becomes a retrieval prior for future runs.
  if (sourceImageUrl && !enrichedEntry.embedding_written_back) {
    try {
      const vec = await embedImage({
        image: sourceImageUrl,
        text: `${enrichedEntry.brand} ${enrichedEntry.model}${enrichedEntry.variant ? " " + enrichedEntry.variant : ""}`,
      });
      const result = await insertEmbedding(supabase, {
        brand: enrichedEntry.brand,
        model: enrichedEntry.model,
        variant: enrichedEntry.variant ?? null,
        image_url: sourceImageUrl,
        embedding: vec,
        source: "user_confirmed",
      });
      if (result.ok) {
        enrichedEntry.embedding_written_back = true;
      } else {
        log.warn("embedding write-back failed after correction", { error: result.error });
      }
    } catch (err) {
      log.warn("embedding generation failed during correction — skipping", {
        brand: enrichedEntry.brand,
        model: enrichedEntry.model,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Splice: mark original as rejected, append the corrected entry after it.
  const rejectedOriginal: IdentifiedProduct = {
    ...original,
    user_confirmed: false,
  };
  const nextList: IdentifiedProduct[] = [...current];
  nextList[origIdx] = rejectedOriginal;
  nextList.splice(origIdx + 1, 0, enrichedEntry);

  const nextDiagnosisJson: DiagnosisData = {
    ...(diagnosisJson as DiagnosisData),
    identified_products: nextList,
  };

  const { error: updateErr } = await supabase
    .from("room_diagnoses")
    .update({
      diagnosis_json: nextDiagnosisJson,
      updated_at: new Date().toISOString(),
    })
    .eq("id", diagnosisRow.id);

  if (updateErr) {
    return NextResponse.json({ error: String(updateErr) }, { status: 500 });
  }

  return NextResponse.json({
    replaced: rejectedOriginal,
    inserted: enrichedEntry,
  });
}
