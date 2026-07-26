/**
 * Confirmation endpoint for the identified-products feature.
 *
 * The frontend shows each identified_product with a confirmation pill
 * ("Yes, that's it" / "No — different model" / "Not sure"). When the user
 * taps a pill, we PATCH here with:
 *
 *   { brand, model, user_confirmed: true | false, correction?: { brand, model, variant? } }
 *
 * Behavior:
 *   - Updates the matching entry inside room_diagnoses.diagnosis_json.identified_products[]
 *   - If confirmed true AND the entry has both a source_image_url and bounding_box,
 *     writes the crop's embedding back to product_image_embeddings so the
 *     next identification run has a stronger prior.
 *   - If the user supplies a correction, we UPDATE brand/model/variant,
 *     mark correction_source="user", and write the embedding under the
 *     corrected (brand, model).
 *
 * Self-learning write-back is best-effort and swallowed on failure — confirming
 * a product should never 500.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { apiError } from "@/lib/utils/api-error";
import { createLogger } from "@/lib/logging/logger";
import { embedImage } from "@/lib/ai/embeddings";
import { insertEmbeddingWithRetry } from "@/lib/store/embedding-index";
import { userOwnsRoom } from "@/lib/auth/ownership";
import { checkRateLimit, RATE_LIMITS } from "@/lib/utils/rate-limiter";
import { checkDailySpendForUser } from "@/lib/utils/spend-limiter";
import type { DiagnosisData, IdentifiedProduct } from "@/lib/types/database";

// Product identifiers are short strings; cap them so a malicious body can't
// bloat the persisted diagnosis_json or the embedding label text.
const MAX_FIELD_LEN = 200;

// This route makes a remote Gemini embedding call (embedImage) on the confirm/
// correct write-back path. Without an explicit maxDuration, Vercel applies a
// short platform default and can kill the function mid-embedding — a "builds
// green, request gets killed" failure that also aborts the confirmation write.
// 300s matches every other embedding/LLM pipeline route.
export const maxDuration = 300;

const log = createLogger("identified-products-confirm");

interface ConfirmBody {
  brand: string;
  model: string;
  user_confirmed: boolean;
  /** Optional user correction. Only applied when user_confirmed === false. */
  correction?: {
    brand: string;
    model: string;
    variant?: string | null;
  };
}

function isBoundedString(v: unknown): v is string {
  return typeof v === "string" && v.length <= MAX_FIELD_LEN;
}

function isConfirmBody(x: unknown): x is ConfirmBody {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (
    !isBoundedString(o.brand) ||
    !isBoundedString(o.model) ||
    typeof o.user_confirmed !== "boolean"
  ) {
    return false;
  }
  // Optional correction: when present it must be a well-formed, length-bounded object.
  if (o.correction !== undefined && o.correction !== null) {
    if (typeof o.correction !== "object") return false;
    const c = o.correction as Record<string, unknown>;
    if (!isBoundedString(c.brand) || !isBoundedString(c.model)) return false;
    if (c.variant !== undefined && c.variant !== null && !isBoundedString(c.variant)) {
      return false;
    }
  }
  return true;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  const { roomId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await userOwnsRoom(supabase, roomId, user.id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Throttle the endpoint: the confirm path can trigger a paid Gemini embedding
  // (embedImage) on the self-learning write-back, so an un-throttled caller is a
  // budget-drain + brute-force surface. Matches the sibling correct/ route.
  const limit = checkRateLimit(`product-confirm:${user.id}`, RATE_LIMITS.productConfirm);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many confirmation requests. Please wait a moment." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil((limit.retryAfterMs || 60000) / 1000)) },
      },
    );
  }

  const body = await request.json().catch(() => null);
  if (!isConfirmBody(body)) {
    return NextResponse.json(
      { error: "Body must include { brand, model, user_confirmed }" },
      { status: 400 },
    );
  }

  // Fetch the latest diagnosis for this room. There is no stable per-diagnosis
  // URL on the client yet, so we always target the most recent row. If we ever
  // let users browse prior diagnoses, add a diagnosis_id param here.
  const { data: diagnoses, error: fetchErr } = await supabase
    .from("room_diagnoses")
    .select("*")
    .eq("room_id", roomId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (fetchErr) {
    return apiError("identified-products.confirm", fetchErr);
  }
  const diagnosisRow = Array.isArray(diagnoses) ? diagnoses[0] : diagnoses;
  if (!diagnosisRow) {
    return NextResponse.json({ error: "No diagnosis for this room" }, { status: 404 });
  }

  const diagnosisJson = diagnosisRow.diagnosis_json as DiagnosisData | undefined;
  const current: IdentifiedProduct[] = diagnosisJson?.identified_products ?? [];
  if (current.length === 0) {
    return NextResponse.json(
      { error: "This diagnosis has no identified_products to confirm" },
      { status: 404 },
    );
  }

  const idx = current.findIndex(
    (p) =>
      p.brand.toLowerCase() === body.brand.toLowerCase() &&
      p.model.toLowerCase() === body.model.toLowerCase(),
  );
  if (idx === -1) {
    return NextResponse.json(
      { error: `No identified_product matching ${body.brand} / ${body.model}` },
      { status: 404 },
    );
  }

  // Apply the update.
  const target = current[idx];
  const updated: IdentifiedProduct = { ...target, user_confirmed: body.user_confirmed };

  if (!body.user_confirmed && body.correction) {
    updated.brand = body.correction.brand;
    updated.model = body.correction.model;
    updated.variant = body.correction.variant ?? null;
    updated.correction_source = "user";
    // The prior grounded enrichment is now stale — clear canonical fields and
    // let a future re-run (or the frontend) re-enrich against the corrected ID.
    updated.verified = false;
    updated.canonical_url = null;
    updated.source_urls = [];
    updated.dimensions = null;
    updated.materials = [];
    updated.colors = [];
    updated.price_range = null;
    updated.image_url = null;
    updated.embedding_written_back = false;
    // A user correction is a confirmed ID — just of a different product.
    updated.user_confirmed = true;
  }

  // Self-learning write-back: only when the user positively confirmed AND we
  // have enough crop context to recreate the embedding.
  if (
    updated.user_confirmed === true &&
    !updated.embedding_written_back &&
    updated.source_image_url &&
    updated.bounding_box &&
    // Meter only the actual paid call: a non-embedding confirm costs nothing and
    // must not consume the daily ceiling. When the ceiling is hit we skip the
    // best-effort write-back (confirming must still succeed — never 500).
    (await checkDailySpendForUser(user.id)).allowed
  ) {
    try {
      // Embedding the full source image + the label is the simplest workable
      // approach without a cropping utility in the repo. If/when we add sharp
      // or a client-side cropper, switch this to embed the cropped tile.
      const vec = await embedImage({
        image: updated.source_image_url,
        text: `${updated.brand} ${updated.model}${updated.variant ? " " + updated.variant : ""}`,
      });
      const result = await insertEmbeddingWithRetry(supabase, {
        brand: updated.brand,
        model: updated.model,
        variant: updated.variant ?? null,
        image_url: updated.source_image_url,
        embedding: vec,
        source: "user_confirmed",
      });
      if (result.ok) {
        updated.embedding_written_back = true;
      } else {
        log.warn("embedding write-back failed", { error: result.error });
      }
    } catch (err) {
      log.warn("embedding generation for write-back failed — skipping", {
        brand: updated.brand,
        model: updated.model,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const nextList = [...current];
  nextList[idx] = updated;

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
    return apiError("identified-products.confirm", updateErr);
  }

  return NextResponse.json({
    identified_product: updated,
    embedding_written_back: updated.embedding_written_back ?? false,
  });
}
