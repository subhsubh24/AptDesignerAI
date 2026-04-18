/**
 * Default post-search verification step. For each category, picks the
 * top-ranked candidate (by final_item_score) and runs the Computer Use
 * product verifier against its retailer URL to ground-truth price,
 * stock, and dimensions before we commit the row to the database.
 *
 * Design notes:
 *   - Cache-first: checks computer_use_verified_products in Supabase
 *     before opening a Browserbase session. Cache TTL is 24 hours.
 *     Same URL appearing in multiple searches costs one agent run total.
 *   - Verification is best-effort: any individual failure leaves the
 *     original candidate untouched and is logged to computer_use_agent_logs.
 *   - Only the top-1 per category is verified to bound Browserbase cost.
 *   - Gated on Browserbase credential presence — silent no-op otherwise.
 *   - Concurrency is capped so a 12-category search doesn't fan out to
 *     12 simultaneous browser sessions.
 */

import pLimit from "p-limit";
import type { CandidateProduct, ProductDimensions } from "@/lib/types/database";
import type { ProductEvaluationResult } from "@/lib/types/scoring";
import { runProductVerifier, type VerifiedProduct } from "./product-verifier";
import { getAdminClient } from "@/lib/supabase/admin";
import { createLogger } from "@/lib/logging/logger";

const log = createLogger("verify-search-candidates");

const VERIFY_CONCURRENCY = 3;
const VERIFY_TIMEOUT_MS = 90_000;
const CACHE_TTL_HOURS = 24;

export interface VerificationSummary {
  attempted: number;
  succeeded: number;
  cacheHits: number;
  entries: Array<{
    productId: string;
    category: string;
    status: "ok" | "cache_hit" | "failed" | "timeout" | "skipped";
    verifiedFieldsChanged?: string[];
    notes?: string;
  }>;
}

// ─── URL normalisation ────────────────────────────────────────────
// Strip tracking params before using URL as cache key so utm_*, gclid,
// fbclid, etc. don't create spurious cache misses.

const TRACKING_PARAMS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "gclid", "gbraid", "wbraid", "fbclid", "msclkid", "ttclid",
  "dclid", "li_fat_id", "mc_eid", "igshid", "_ga", "s_kwcid",
]);

function normaliseUrl(raw: string): string {
  try {
    const u = new URL(raw);
    for (const p of TRACKING_PARAMS) u.searchParams.delete(p);
    return u.toString().replace(/\/+$/, ""); // strip trailing slash
  } catch {
    return raw;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────

function browserbaseConfigured(): boolean {
  return Boolean(process.env.BROWSERBASE_API_KEY && process.env.BROWSERBASE_PROJECT_ID);
}

// Cache the import check so we only test once per process lifecycle.
let _bbAvailable: boolean | null = null;
async function browserbaseAvailable(): Promise<boolean> {
  if (!browserbaseConfigured()) return false;
  if (_bbAvailable !== null) return _bbAvailable;
  try {
    // @ts-expect-error — optional dependency
    await import(/* webpackIgnore: true */ "@browserbasehq/sdk");
    _bbAvailable = true;
  } catch {
    _bbAvailable = false;
  }
  return _bbAvailable;
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

// ─── Supabase cache operations ────────────────────────────────────

async function lookupCache(urlKey: string): Promise<VerifiedProduct | null> {
  const db = getAdminClient();
  if (!db) return null;
  try {
    const cutoff = new Date(Date.now() - CACHE_TTL_HOURS * 3_600_000).toISOString();
    const { data } = await db
      .from("computer_use_verified_products")
      .select("*")
      .eq("product_url_key", urlKey)
      .eq("agent_status", "completed")
      .gte("verified_at", cutoff)
      .order("verified_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!data) return null;
    return {
      title: data.title ?? null,
      price: typeof data.price === "number" ? data.price : data.price != null ? Number(data.price) : null,
      currency: data.currency ?? null,
      in_stock: data.in_stock ?? null,
      dimensions: data.dimensions ?? null,
      materials: Array.isArray(data.materials) ? data.materials : [],
      available_colors: Array.isArray(data.available_colors) ? data.available_colors : [],
      available_sizes: Array.isArray(data.available_sizes) ? data.available_sizes : [],
      shipping_estimate: data.shipping_estimate ?? null,
      return_policy_summary: data.return_policy_summary ?? null,
      caveats: Array.isArray(data.caveats) ? data.caveats : [],
    };
  } catch (e) {
    log.warn("Cache lookup failed", { error: (e as Error).message });
    return null;
  }
}

async function writeCache(urlKey: string, rawUrl: string, verified: VerifiedProduct, agentMeta: {
  status: string;
  turns: number;
  notes?: string;
  steps?: unknown[];
}): Promise<void> {
  const db = getAdminClient();
  if (!db) return;
  try {
    await db.from("computer_use_verified_products").insert({
      product_url: rawUrl,
      product_url_key: urlKey,
      title: verified.title,
      price: verified.price,
      currency: verified.currency,
      in_stock: verified.in_stock,
      dimensions: verified.dimensions,
      materials: verified.materials,
      available_colors: verified.available_colors,
      available_sizes: verified.available_sizes,
      shipping_estimate: verified.shipping_estimate,
      return_policy_summary: verified.return_policy_summary,
      caveats: verified.caveats,
      agent_status: agentMeta.status,
      turns_used: agentMeta.turns,
      agent_notes: agentMeta.notes ?? null,
      agent_steps: agentMeta.steps ?? null,
    });
  } catch (e) {
    log.warn("Cache write failed", { error: (e as Error).message });
  }
}

async function writeAgentLog(entry: {
  contextType: string;
  contextId?: string;
  productUrl?: string;
  status: string;
  totalTurns: number;
  steps?: unknown[];
  error?: string;
}): Promise<void> {
  const db = getAdminClient();
  if (!db) return;
  try {
    await db.from("computer_use_agent_logs").insert({
      context_type: entry.contextType,
      context_id: entry.contextId ?? null,
      product_url: entry.productUrl ?? null,
      agent_status: entry.status,
      total_turns: entry.totalTurns,
      steps: entry.steps ?? [],
      error_message: entry.error ?? null,
      finished_at: new Date().toISOString(),
    });
  } catch (e) {
    log.warn("Agent log write failed", { error: (e as Error).message });
  }
}

// ─── Core verification logic ──────────────────────────────────────

async function verifyOne(
  candidate: CandidateProduct,
  urlKey: string,
): Promise<{
  verified: VerifiedProduct | null;
  fromCache: boolean;
  agentStatus?: string;
  agentTurns?: number;
  agentSteps?: unknown[];
  agentNotes?: string;
  error?: string;
  timedOut?: boolean;
}> {
  // 1. Cache hit?
  const cached = await lookupCache(urlKey);
  if (cached) return { verified: cached, fromCache: true };

  // 2. Live agent run.
  if (!candidate.product_url) return { verified: null, fromCache: false, error: "no product_url" };

  try {
    const result = await withTimeout(
      runProductVerifier({
        productUrl: candidate.product_url,
        expectedTitle: candidate.title ?? undefined,
        expectedColor: candidate.colors?.[0],
      }),
      VERIFY_TIMEOUT_MS,
    );

    if (result === "timeout") {
      return { verified: null, fromCache: false, timedOut: true };
    }

    return {
      verified: result.product,
      fromCache: false,
      agentStatus: result.agent_status,
      agentTurns: result.turns,
      agentSteps: result.notes ? [result.notes] : undefined,
      agentNotes: result.notes,
    };
  } catch (e) {
    return { verified: null, fromCache: false, error: (e as Error).message };
  }
}

// ─── Public API ───────────────────────────────────────────────────

/**
 * Mutates `candidatesByCategory` in place: merges verified price / stock /
 * dimensions into each top candidate, tags `metadata.verification` with an
 * audit record, and bumps `metadata.verified_at` on success. Safe to call
 * when Browserbase isn't configured — becomes a no-op.
 *
 * @param searchSessionId Optional — stored in agent log for traceability.
 */
export async function verifyTopSearchCandidates(
  candidatesByCategory: Record<string, CandidateProduct[]>,
  evaluations: Map<string, ProductEvaluationResult>,
  searchSessionId?: string,
): Promise<VerificationSummary> {
  const summary: VerificationSummary = {
    attempted: 0,
    succeeded: 0,
    cacheHits: 0,
    entries: [],
  };

  if (!await browserbaseAvailable()) {
    log.info("Browserbase not available — skipping product verification");
    return summary;
  }

  // Pick top-1 candidate per category by evaluation score.
  const targets: { category: string; product: CandidateProduct; urlKey: string }[] = [];
  for (const [category, products] of Object.entries(candidatesByCategory)) {
    if (!products.length) continue;
    const ranked = [...products].sort((a, b) => {
      const sa = evaluations.get(a.id)?.final_item_score ?? 0;
      const sb = evaluations.get(b.id)?.final_item_score ?? 0;
      return sb - sa;
    });
    const top = ranked[0];
    if (top?.product_url) {
      targets.push({ category, product: top, urlKey: normaliseUrl(top.product_url) });
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
    targets.map(({ category, product, urlKey }) =>
      limit(async () => {
        summary.attempted++;
        const outcome = await verifyOne(product, urlKey);

        // ── Log to Supabase regardless of outcome ──────────────
        void writeAgentLog({
          contextType: "product_search",
          contextId: searchSessionId,
          productUrl: product.product_url ?? undefined,
          status: outcome.timedOut
            ? "timeout"
            : outcome.error
              ? "error"
              : outcome.fromCache
                ? "cache_hit"
                : outcome.agentStatus ?? "unknown",
          totalTurns: outcome.agentTurns ?? 0,
          steps: outcome.agentSteps,
          error: outcome.error,
        });

        if (outcome.timedOut) {
          summary.entries.push({ productId: product.id, category, status: "timeout" });
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
            from_cache: outcome.fromCache,
            in_stock: v.in_stock,
            shipping_estimate: v.shipping_estimate,
            return_policy_summary: v.return_policy_summary,
            caveats: v.caveats,
            changed_fields: changed,
          },
        };

        // ── Cache the live result ──────────────────────────────
        if (!outcome.fromCache && outcome.agentStatus === "completed" && product.product_url) {
          void writeCache(urlKey, product.product_url, v, {
            status: outcome.agentStatus,
            turns: outcome.agentTurns ?? 0,
            notes: outcome.agentNotes,
          });
        }

        summary.succeeded++;
        if (outcome.fromCache) summary.cacheHits++;
        summary.entries.push({
          productId: product.id,
          category,
          status: outcome.fromCache ? "cache_hit" : "ok",
          verifiedFieldsChanged: changed,
        });
      }),
    ),
  );

  log.info("Verification complete", {
    attempted: summary.attempted,
    succeeded: summary.succeeded,
    cacheHits: summary.cacheHits,
  });
  return summary;
}
