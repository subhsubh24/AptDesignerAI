/**
 * Default post-search verification step. For each category, picks the
 * top-ranked candidate (by final_item_score) and runs the Computer Use
 * product verifier against its retailer URL to ground-truth price,
 * stock, and dimensions before we commit the row to the database.
 *
 * Design notes:
 *   - Verification is best-effort: any individual failure leaves the
 *     original candidate untouched.
 *   - Only the top-1 per category is verified — that's the row the
 *     bundle uses, and running a Browserbase session per category is
 *     the cost ceiling we can justify.
 *   - Gated purely on Browserbase credential presence. No opt-in flag —
 *     if the creds aren't set, this is a silent no-op.
 *   - Concurrency is capped so a 12-category search doesn't fan out to
 *     12 simultaneous browser sessions.
 */
import pLimit from "p-limit";
import type { CandidateProduct, ProductDimensions } from "@/lib/types/database";
import type { ProductEvaluationResult } from "@/lib/types/scoring";
import { runProductVerifier, type VerifiedProduct } from "./product-verifier";
import { createLogger } from "@/lib/logging/logger";

const log = createLogger("verify-search-candidates");

const VERIFY_CONCURRENCY = 3;
const VERIFY_TIMEOUT_MS = 90_000;

export interface VerificationSummary {
  attempted: number;
  succeeded: number;
  /** Per-product audit rows — appended to candidate.metadata.verification. */
  entries: Array<{
    productId: string;
    category: string;
    status: "ok" | "failed" | "timeout" | "skipped";
    verifiedFieldsChanged?: string[];
    notes?: string;
  }>;
}

function browserbaseConfigured(): boolean {
  return Boolean(process.env.BROWSERBASE_API_KEY && process.env.BROWSERBASE_PROJECT_ID);
}

function toProductDimensions(v: VerifiedProduct["dimensions"]): ProductDimensions | null {
  if (!v) return null;
  const { width_in, depth_in, height_in } = v;
  if (width_in == null && depth_in == null && height_in == null) return null;
  return {
    ...(typeof width_in === "number" ? { width: width_in } : {}),
    ...(typeof depth_in === "number" ? { depth: depth_in } : {}),
    ...(typeof height_in === "number" ? { height: height_in } : {}),
    unit: "inches",
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | "timeout"> {
  return Promise.race([
    promise,
    new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), ms)),
  ]);
}

async function verifyOne(
  candidate: CandidateProduct,
): Promise<{ verified: VerifiedProduct | null; error?: string; timedOut?: boolean }> {
  if (!candidate.product_url) {
    return { verified: null, error: "no product_url" };
  }
  try {
    const result = await withTimeout(
      runProductVerifier({
        productUrl: candidate.product_url,
        expectedTitle: candidate.title ?? undefined,
        expectedColor: candidate.colors?.[0],
      }),
      VERIFY_TIMEOUT_MS,
    );
    if (result === "timeout") return { verified: null, timedOut: true };
    if (result.product) return { verified: result.product };
    return { verified: null, error: result.notes ?? `agent ${result.agent_status}` };
  } catch (e) {
    return { verified: null, error: (e as Error).message };
  }
}

/**
 * Mutates `candidatesByCategory` in place: merges verified price / stock /
 * dimensions into each top candidate, tags `metadata.verification` with an
 * audit record, and bumps `metadata.verified_at` on success. Safe to call
 * when Browserbase isn't configured — becomes a no-op.
 */
export async function verifyTopSearchCandidates(
  candidatesByCategory: Record<string, CandidateProduct[]>,
  evaluations: Map<string, ProductEvaluationResult>,
): Promise<VerificationSummary> {
  const summary: VerificationSummary = { attempted: 0, succeeded: 0, entries: [] };

  if (!browserbaseConfigured()) {
    log.info("Browserbase not configured — skipping product verification");
    return summary;
  }

  // Pick top-1 candidate per category by evaluation score. Ties broken by
  // whichever came first in the array (stable sort).
  const targets: { category: string; product: CandidateProduct }[] = [];
  for (const [category, products] of Object.entries(candidatesByCategory)) {
    if (!products.length) continue;
    const ranked = [...products].sort((a, b) => {
      const sa = evaluations.get(a.id)?.final_item_score ?? 0;
      const sb = evaluations.get(b.id)?.final_item_score ?? 0;
      return sb - sa;
    });
    const top = ranked[0];
    if (top?.product_url) {
      targets.push({ category, product: top });
    } else {
      summary.entries.push({
        productId: top?.id ?? "unknown",
        category,
        status: "skipped",
        notes: "no product_url",
      });
    }
  }

  if (!targets.length) return summary;

  log.info("Verifying top candidates", {
    categories: targets.length,
    concurrency: VERIFY_CONCURRENCY,
  });

  const limit = pLimit(VERIFY_CONCURRENCY);
  await Promise.all(
    targets.map(({ category, product }) =>
      limit(async () => {
        summary.attempted++;
        const outcome = await verifyOne(product);

        if (outcome.timedOut) {
          summary.entries.push({
            productId: product.id,
            category,
            status: "timeout",
          });
          return;
        }

        if (!outcome.verified) {
          summary.entries.push({
            productId: product.id,
            category,
            status: "failed",
            notes: outcome.error,
          });
          return;
        }

        const v = outcome.verified;
        const changed: string[] = [];
        if (typeof v.price === "number" && v.price !== product.price) {
          product.price = v.price;
          changed.push("price");
        }
        const newDims = toProductDimensions(v.dimensions);
        if (newDims) {
          product.dimensions = newDims;
          changed.push("dimensions");
        }
        if (v.materials.length && !product.materials?.length) {
          product.materials = v.materials;
          changed.push("materials");
        }
        if (v.available_colors.length && !product.colors?.length) {
          product.colors = v.available_colors;
          changed.push("colors");
        }
        product.metadata = {
          ...(product.metadata ?? {}),
          verification: {
            verified_at: new Date().toISOString(),
            in_stock: v.in_stock,
            shipping_estimate: v.shipping_estimate,
            return_policy_summary: v.return_policy_summary,
            caveats: v.caveats,
            changed_fields: changed,
          },
        };
        summary.succeeded++;
        summary.entries.push({
          productId: product.id,
          category,
          status: "ok",
          verifiedFieldsChanged: changed,
        });
      }),
    ),
  );

  log.info("Verification summary", {
    attempted: summary.attempted,
    succeeded: summary.succeeded,
  });
  return summary;
}
