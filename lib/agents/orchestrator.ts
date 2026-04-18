import {
  generateSearchBrief,
  searchProducts,
  deduplicateCandidates,
  quickScreenCandidates,
  type SearchCandidate,
  type SearchBrief,
} from "./shopping-researcher";
import { extractFromUrl } from "./product-extractor";
import { runProductVerifier } from "./computer-use/product-verifier";
import { scoreProduct, quickScoreProducts } from "./fit-scorer";
import { evaluateBundle, generateBundleVibe } from "./bundle-optimizer";
import { validateProductSet } from "./validation-agent";
import { rerankCandidates } from "./reranker";
import { PipelineTracer } from "./pipeline-trace";
import { checkForDrift, getScoreDistributionSummary } from "@/lib/scoring/drift-monitor";
import { pairwiseRerank } from "@/lib/scoring/pairwise-reranker";
import { selectByMMR } from "@/lib/scoring/mmr-reranker";
import { generateExplorationQueries } from "@/lib/scoring/query-exploration";
import { productMatchesCategory } from "@/lib/validation/category-match";
import { ORCHESTRATOR } from "@/lib/config/pipeline";
import { createLogger } from "@/lib/logging/logger";
import type { AgentContext, AgentResult } from "./types";
import type { CandidateProduct } from "@/lib/types/database";
import type { ProductEvaluationResult } from "@/lib/types/scoring";
import type { PriceTier } from "@/lib/prompts/search-brief";

const log = createLogger("orchestrator");

// ─── Deterministic tiebreakers ─────────────────────────────────
// When two items have equal scores, JavaScript's .sort is unstable: ties
// fall out in insertion order, which depends on which async extraction
// finished first. We add URL-based tiebreakers so the same candidate set
// always produces the same ranking.
function tiebreakProduct(a: CandidateProduct, b: CandidateProduct): number {
  const au = a.product_url || "";
  const bu = b.product_url || "";
  return au.localeCompare(bu);
}
function tiebreakBundle(a: CandidateProduct[], b: CandidateProduct[]): number {
  const au = [...a.map((p) => p.product_url || "")].sort().join("|");
  const bu = [...b.map((p) => p.product_url || "")].sort().join("|");
  return au.localeCompare(bu);
}

// ─── Types ─────────────────────────────────────────────────────

export interface OrchestrationStep {
  step: string;
  status: "pending" | "running" | "completed" | "failed";
  data?: unknown;
}

export interface OrchestrationResult {
  searchBrief: unknown;
  candidatesByCategory: Record<string, CandidateProduct[]>;
  // (s) Additional alternatives the user can browse
  alsoConsidered?: Record<string, CandidateProduct[]>;
  evaluations: Map<string, ProductEvaluationResult>;
  bundles: unknown[];
  steps: OrchestrationStep[];
  validation?: { isValid: boolean; confidence: number; issues: string[] };
  stats: {
    totalSearchQueries: number;
    totalRawUrls: number;
    totalAfterDedup: number;
    totalAfterScreen: number;
    totalExtracted: number;
    totalQuickScored: number;
    totalDeepScored: number;
    totalFinal: number;
    tokensUsed: number;
    conversionRates?: Record<string, number>;
    bottlenecks?: string[];
    driftWarnings?: string[];
  };
  trace?: ReturnType<PipelineTracer["getTrace"]>;
}

const PRICE_TIERS: PriceTier[] = ["budget", "balanced", "high_end"];
const TIER_LABELS: Record<PriceTier, string> = {
  budget: "Budget",
  balanced: "Balanced",
  high_end: "High End",
};

// ─── Concurrency Limiter ───────────────────────────────────────

function pLimit(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  function next() {
    if (queue.length > 0 && active < concurrency) {
      active++;
      const run = queue.shift()!;
      run();
    }
  }

  return function <T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        fn().then(resolve, reject).finally(() => {
          active--;
          next();
        });
      });
      next();
    });
  };
}

// ─── Cartesian Product ────────────────────────────────────────

/** Generate all combinations by picking one element from each array. */
function cartesian<T>(arrays: T[][]): T[][] {
  if (arrays.length === 0) return [[]];
  const [first, ...rest] = arrays;
  const restCombos = cartesian(rest);
  const result: T[][] = [];
  for (const item of first) {
    for (const combo of restCombos) {
      result.push([item, ...combo]);
    }
  }
  return result;
}

// ─── Token Budget ─────────────────────────────────────────────

/** Track cumulative token usage and enforce a hard cap. */
class TokenBudget {
  used = 0;
  readonly cap: number;

  constructor(cap: number) {
    this.cap = cap;
  }

  add(tokens: number) {
    this.used += tokens;
  }

  get remaining() {
    return Math.max(0, this.cap - this.used);
  }

  get exceeded() {
    return this.used >= this.cap;
  }
}

/** Token cap reads from centralized config; env var override available. */
const DEFAULT_TOKEN_CAP = ORCHESTRATOR.defaultTokenCap;

// ─── Sentinel Domain Tracker ──────────────────────────────────
// Tracks extraction failure rates per domain to skip domains that
// consistently return sentinel titles (category pages, 403s, etc.)

const domainSentinelStats = new Map<string, { total: number; sentinels: number }>();

function trackExtraction(url: string, isSentinel: boolean) {
  try {
    const domain = new URL(url).hostname;
    const entry = domainSentinelStats.get(domain) ?? { total: 0, sentinels: 0 };
    entry.total++;
    if (isSentinel) entry.sentinels++;
    domainSentinelStats.set(domain, entry);
  } catch { /* invalid URL */ }
}

function isDomainBlocked(url: string): boolean {
  try {
    const domain = new URL(url).hostname;
    const entry = domainSentinelStats.get(domain);
    if (!entry || entry.total < 5) return false;
    return entry.sentinels / entry.total > 0.8;
  } catch { return false; }
}

// ─── URL Filtering ─────────────────────────────────────────────

const NON_PRODUCT_PATTERNS = /\/(collections|category|categories|all-|shop-all|browse|blog|magazine|inspiration|ideas|guides|reviews?)\b/i;

function isLikelyProductUrl(url: string): boolean {
  try {
    const lower = url.toLowerCase();
    if (lower.endsWith(".pdf")) return false;
    if (NON_PRODUCT_PATTERNS.test(lower)) return false;
    return true;
  } catch {
    return false;
  }
}

// ─── Main Orchestrator ─────────────────────────────────────────

/**
 * Run the full intensive agentic search loop.
 *
 * 6-Phase Funnel:
 * 1. Generate 5 diverse search queries per tier per category
 * 2. Run ALL queries → ~450 raw URLs → deduplicate to ~150
 * 3. Quick screen with Flash → ~90 likely product pages
 * 4. Extract all screened URLs with URL Context → ~60 valid products
 * 5a. Quick score with Flash (batch, no images) → top 8 per tier
 * 5b. Deep score with Pro (images, 8 dimensions) → top 5 per tier
 * 6. Validate holistically + generate bundles
 */
export async function runAgenticSearch(
  ctx: AgentContext,
  missingCategories: string[],
  onStep?: (step: OrchestrationStep) => void,
  categoryHints?: Record<string, string>
): Promise<AgentResult<OrchestrationResult>> {
  domainSentinelStats.clear();
  const steps: OrchestrationStep[] = [];
  const candidatesByCategory: Record<string, CandidateProduct[]> = {};
  const evaluations = new Map<string, ProductEvaluationResult>();
  const tracer = new PipelineTracer(crypto.randomUUID(), ctx.roomId);
  const tokenBudget = new TokenBudget(DEFAULT_TOKEN_CAP);
  const stats = {
    totalSearchQueries: 0,
    totalRawUrls: 0,
    totalAfterDedup: 0,
    totalAfterScreen: 0,
    totalExtracted: 0,
    totalQuickScored: 0,
    totalDeepScored: 0,
    totalFinal: 0,
    tokensUsed: 0,
    /** Per-phase token breakdown for cost/efficiency analysis */
    tokensPerPhase: {
      search_brief: 0,
      search: 0,
      screen: 0,
      rerank: 0,
      extract: 0,
      quick_score: 0,
      deep_score: 0,
      validation: 0,
      bundle: 0,
      backfill: 0,
    } as Record<string, number>,
  };

  function reportStep(step: OrchestrationStep) {
    // Attach running stats to every step event for real-time progress
    const enriched = { ...step, data: { ...(step.data as Record<string, unknown> || {}), stats: { ...stats } } };
    steps.push(step);
    onStep?.(enriched);
    log.info(`${step.status}: ${step.step}`, { phase: step.step, roomId: ctx.roomId });
  }

  try {
    // ═══════════════════════════════════════════════════════════
    // PHASE 1: Generate search brief (5 queries × 3 tiers × N categories)
    // ═══════════════════════════════════════════════════════════
    reportStep({ step: "Generating intensive search brief", status: "running" });
    const briefResult = await generateSearchBrief(
      ctx.roomType, missingCategories, ctx.budgetMode, categoryHints,
      ctx.designProfile, ctx.designDirection, ctx.priorities,
      ctx.keepItems, ctx.replaceItems, ctx.spatialLayout, ctx.roomSummary,
      ctx.userContext, ctx.diagnosis as Record<string, unknown> | undefined,
      ctx.lightingConditions, ctx.windowDoorPositions, ctx.outletPositions,
      ctx.identifiedContext, ctx.imageUrls
    );
    if (!briefResult.success || !briefResult.data) {
      reportStep({ step: "Generating intensive search brief", status: "failed", data: { error: briefResult.error } });
      log.error("Search brief failed", { error: briefResult.error, roomId: ctx.roomId });
      return { success: false, error: briefResult.error || "Failed to generate search brief" };
    }
    const brief: SearchBrief = briefResult.data;
    if (briefResult.tokensUsed) {
      tokenBudget.add(briefResult.tokensUsed);
      stats.tokensUsed += briefResult.tokensUsed;
      stats.tokensPerPhase.search_brief += briefResult.tokensUsed;
    }
    reportStep({ step: "Generating intensive search brief", status: "completed", data: brief });

    // ═══════════════════════════════════════════════════════════
    // PHASE 2: Run ALL search queries in parallel, deduplicate
    // ═══════════════════════════════════════════════════════════
    reportStep({ step: "Searching across all retailers", status: "running" });

    // Build list of all search tasks
    const searchTasks: Array<{
      category: string;
      tier: PriceTier;
      query: string;
      angle: string;
    }> = [];

    for (const categoryBrief of brief.categories) {
      for (const tier of PRICE_TIERS) {
        const tierBrief = categoryBrief.tiers[tier];
        if (!tierBrief) continue;
        for (const queryObj of tierBrief.search_queries) {
          searchTasks.push({
            category: categoryBrief.category,
            tier,
            query: queryObj.query,
            angle: queryObj.angle,
          });
        }
      }
    }

    // Inject exploration queries: alternative style synonyms and boutique
    // modifiers to escape the deterministic LLM query generation rut.
    // Seeded per room so results are reproducible but vary across rooms.
    const explorationQueries = generateExplorationQueries(
      searchTasks,
      ctx.roomId,
      ctx.designDirection?.style_notes
    );
    for (const eq of explorationQueries) {
      searchTasks.push(eq);
    }

    stats.totalSearchQueries = searchTasks.length;

    // Run all searches with concurrency limit of 15 (Flash Lite is fast)
    const searchLimit = pLimit(15);
    const searchResultsByCategory: Record<string, Record<PriceTier, SearchCandidate[]>> = {};
    let searchesCompleted = 0;

    const searchPromises = searchTasks.map((task) =>
      searchLimit(async () => {
        tracer.trace({ phase: "search", action: "query", category: task.category, tier: task.tier, metadata: { query: task.query, angle: task.angle } });
        const result = await searchProducts(task.query, 10, task.tier, task.category, ctx.imageUrls);
        const candidates = result.success ? (result.data || []) : [];
        if (result.tokensUsed) {
          tokenBudget.add(result.tokensUsed);
          stats.tokensUsed += result.tokensUsed;
          stats.tokensPerPhase.search += result.tokensUsed;
        }
        for (const c of candidates) {
          tracer.trace({ phase: "search", action: "found", url: c.url, category: task.category, tier: task.tier });
        }
        searchesCompleted++;
        if (searchesCompleted % 5 === 0 || searchesCompleted === searchTasks.length) {
          reportStep({
            step: "Searching across all retailers",
            status: "running",
            data: { completed: searchesCompleted, total: searchTasks.length },
          });
        }
        return {
          category: task.category,
          tier: task.tier,
          candidates,
        };
      })
    );

    const searchResults = await Promise.all(searchPromises);

    // Organize by category and tier
    for (const result of searchResults) {
      if (!searchResultsByCategory[result.category]) {
        searchResultsByCategory[result.category] = { budget: [], balanced: [], high_end: [] };
      }
      searchResultsByCategory[result.category][result.tier].push(...result.candidates);
    }

    // Count raw URLs and deduplicate per category+tier, then also across
    // tiers of the same category — the same product URL frequently surfaces
    // in budget/balanced/high_end since price bands overlap. Keeping only
    // the first occurrence halves extraction work on noisy runs. The
    // post-extraction price-tier reclassification step moves products into
    // the correct tier based on actual price anyway.
    const dedupedByCategory: Record<string, Record<PriceTier, SearchCandidate[]>> = {};

    for (const [category, tierResults] of Object.entries(searchResultsByCategory)) {
      dedupedByCategory[category] = { budget: [], balanced: [], high_end: [] };
      const seenAcrossTiers = new Set<string>();
      for (const tier of PRICE_TIERS) {
        const raw = tierResults[tier].filter((c) => c.url && isLikelyProductUrl(c.url));
        stats.totalRawUrls += raw.length;
        const dedupedInTier = deduplicateCandidates(raw);
        const kept: SearchCandidate[] = [];
        for (const c of dedupedInTier) {
          let urlKey = c.url;
          try {
            const u = new URL(c.url);
            urlKey = `${u.hostname}${u.pathname.replace(/\/+$/, "")}`;
          } catch { /* keep raw url as key */ }
          if (seenAcrossTiers.has(urlKey)) continue;
          seenAcrossTiers.add(urlKey);
          kept.push(c);
        }
        stats.totalAfterDedup += kept.length;
        dedupedByCategory[category][tier] = kept;
      }
    }

    reportStep({
      step: "Searching across all retailers",
      status: "completed",
      data: { queries: stats.totalSearchQueries, rawUrls: stats.totalRawUrls, afterDedup: stats.totalAfterDedup },
    });

    // ═══════════════════════════════════════════════════════════
    // PHASE 3: Quick screen with Flash (batch, text-only)
    // ═══════════════════════════════════════════════════════════
    reportStep({ step: "Quick-screening candidates", status: "running" });

    const screenedByCategory: Record<string, Record<PriceTier, SearchCandidate[]>> = {};
    const screenPromises: Promise<void>[] = [];

    for (const [category, tierResults] of Object.entries(dedupedByCategory)) {
      screenedByCategory[category] = { budget: [], balanced: [], high_end: [] };

      for (const tier of PRICE_TIERS) {
        const candidates = tierResults[tier];
        if (candidates.length === 0) continue;

        // Find requirements from brief
        const catBrief = brief.categories.find((c) => c.category === category);
        const requirements = catBrief?.key_requirements || [];

        screenPromises.push(
          (async () => {
            const screenResult = await quickScreenCandidates(candidates, category, tier, requirements, ctx.designDirection, ctx.imageUrls);
            if (screenResult.tokensUsed) {
              tokenBudget.add(screenResult.tokensUsed);
              stats.tokensUsed += screenResult.tokensUsed;
              stats.tokensPerPhase.screen += screenResult.tokensUsed;
            }
            if (screenResult.success && screenResult.data) {
              screenedByCategory[category][tier] = screenResult.data;
              stats.totalAfterScreen += screenResult.data.length;
              for (const c of screenResult.data) {
                tracer.trace({ phase: "screen", action: "passed", url: c.url, category, tier });
              }
              // Trace filtered-out candidates
              const passedUrls = new Set(screenResult.data.map((c) => c.url));
              for (const c of candidates) {
                if (!passedUrls.has(c.url)) {
                  tracer.traceFilter("screen", "", c.url, "failed quick screen");
                }
              }
            } else {
              // Fail open: keep all candidates, but log structured event
              screenedByCategory[category][tier] = candidates;
              stats.totalAfterScreen += candidates.length;
              log.warn("Quick-screen failed — keeping all candidates", {
                phase: "screen", category, tier, candidateCount: candidates.length,
                error: screenResult.error || "unknown", failOpen: true,
              });
            }
          })()
        );
      }
    }

    await Promise.all(screenPromises);

    // Hard cap on screened candidates per (category, tier) before extraction.
    // Extraction is the most expensive phase (URL Context + CU fallback) and
    // quality plateaus after ~4 products per tier — beyond that we pay token
    // cost for products that won't survive deep-score. Override via env.
    const maxExtractPerCatTier = Number(process.env.MAX_EXTRACT_PER_CAT_TIER || "4");
    let totalCapped = 0;
    for (const [category, tierResults] of Object.entries(screenedByCategory)) {
      for (const tier of PRICE_TIERS) {
        const cands = tierResults[tier];
        if (cands.length > maxExtractPerCatTier) {
          const dropped = cands.slice(maxExtractPerCatTier);
          screenedByCategory[category][tier] = cands.slice(0, maxExtractPerCatTier);
          totalCapped += dropped.length;
          for (const d of dropped) {
            tracer.traceFilter("screen", "", d.url, `capped at ${maxExtractPerCatTier}/tier`);
          }
        }
      }
    }
    if (totalCapped > 0) {
      log.info("Capped screened candidates before extraction", {
        phase: "screen", cap: maxExtractPerCatTier, dropped: totalCapped,
      });
    }

    reportStep({
      step: "Quick-screening candidates",
      status: "completed",
      data: { screened: stats.totalAfterScreen, capped: totalCapped },
    });

    // ═══════════════════════════════════════════════════════════
    // PHASE 3b: Rerank screened candidates (cheap, title+snippet only)
    //
    // Opt-in via ENABLE_RERANK=1. When on, trims each (category, tier)
    // bucket to the top-K most relevant URLs before the expensive extract
    // phase, saving ~50–70% of extract tokens on large runs.
    // Fails open — any error falls back to unreranked candidates.
    // ═══════════════════════════════════════════════════════════
    if (process.env.ENABLE_RERANK === "1") {
      reportStep({ step: "Reranking candidates", status: "running" });
      const rerankTopK = Number(process.env.RERANK_TOP_K || "10");
      const rerankPromises: Promise<void>[] = [];

      for (const [category, tierResults] of Object.entries(screenedByCategory)) {
        const catBrief = brief.categories.find((c) => c.category === category);
        const requirements = catBrief?.key_requirements || [];

        for (const tier of PRICE_TIERS) {
          const candidates = tierResults[tier];
          if (candidates.length <= rerankTopK) continue;

          rerankPromises.push(
            (async () => {
              const result = await rerankCandidates({
                category,
                tier,
                requirements,
                candidates,
                topK: rerankTopK,
                roomImageUrls: ctx.imageUrls,
                designDirection: ctx.designDirection,
                diagnosis: ctx.diagnosis,
                priorities: ctx.priorities,
                budgetMode: ctx.budgetMode,
              });
              if (result.tokensUsed) {
                tokenBudget.add(result.tokensUsed);
                stats.tokensUsed += result.tokensUsed;
                stats.tokensPerPhase.rerank += result.tokensUsed;
              }
              screenedByCategory[category][tier] = result.kept;
              for (const dropped of result.dropped) {
                tracer.traceFilter("rerank", "", dropped.url, "below rerank top-K");
              }
            })()
          );
        }
      }

      await Promise.all(rerankPromises);

      // Recompute downstream stats so progress UI reflects the trim.
      const afterRerank = Object.values(screenedByCategory).reduce(
        (sum, tiers) => sum + Object.values(tiers).reduce((s, c) => s + c.length, 0),
        0
      );
      reportStep({
        step: "Reranking candidates",
        status: "completed",
        data: { afterRerank },
      });
    }

    // ═══════════════════════════════════════════════════════════
    // PHASE 4: Extract all screened URLs with URL Context
    // ═══════════════════════════════════════════════════════════
    reportStep({ step: "Extracting product details from websites", status: "running" });

    const extractLimit = pLimit(10);
    // Browser sessions are expensive — cap at 3 concurrent runs regardless of extraction concurrency.
    // Gated on Browserbase credentials + package availability; becomes a no-op when absent.
    const cuFallbackLimit = pLimit(3);
    let cuEnabled = Boolean(process.env.BROWSERBASE_API_KEY && process.env.BROWSERBASE_PROJECT_ID);
    if (cuEnabled) {
      // @ts-expect-error — optional dependency, not installed in all envs
      try { await import(/* webpackIgnore: true */ "@browserbasehq/sdk"); } catch { cuEnabled = false; }
    }

    // CU fallback promises collected separately from extraction so extraction
    // slots don't block on browser sessions. Awaited collectively after Phase 4
    // before Phase 5 (deep-score) reads the product data.
    const cuPromises: Promise<void>[] = [];

    const extractedByCategory: Record<string, Record<PriceTier, CandidateProduct[]>> = {};

    const totalToExtract = Object.values(screenedByCategory).reduce(
      (sum, tiers) => sum + Object.values(tiers).reduce((s, c) => s + c.length, 0), 0
    );
    let extractedSoFar = 0;

    const extractPromises: Promise<void>[] = [];

    for (const [category, tierResults] of Object.entries(screenedByCategory)) {
      extractedByCategory[category] = { budget: [], balanced: [], high_end: [] };

      for (const tier of PRICE_TIERS) {
        const candidates = tierResults[tier];

        for (const candidate of candidates) {
          extractPromises.push(
            extractLimit(async () => {
              try {
                // Extraction budget gate: stop extracting once we've consumed
                // 55% of the total budget. This reserves headroom for deep-
                // scoring, bundling, and validation downstream.
                if (tokenBudget.used / tokenBudget.cap > 0.55) {
                  tracer.traceFilter("extract", "", candidate.url, "extraction budget gate (>55% used)");
                  extractedSoFar++;
                  return;
                }
                if (isDomainBlocked(candidate.url)) {
                  tracer.traceFilter("extract", "", candidate.url, "domain blocked (>80% sentinel rate)");
                  extractedSoFar++;
                  return;
                }
                const extractResult = await extractFromUrl(candidate.url, ctx.designProfile, ctx.imageUrls);
                if (extractResult.tokensUsed) { tokenBudget.add(extractResult.tokensUsed); stats.tokensUsed += extractResult.tokensUsed; stats.tokensPerPhase.extract += extractResult.tokensUsed; }
                if (!extractResult.success || !extractResult.data) {
                  trackExtraction(candidate.url, true);
                  tracer.traceError("extract", candidate.url, extractResult.error || "extraction failed");
                  extractedSoFar++;
                  return;
                }
                const title = extractResult.data.title || "";
                if (!title || title === "PAGE_NOT_ACCESSIBLE" || title === "NOT_A_PRODUCT_PAGE") {
                  trackExtraction(candidate.url, true);
                  tracer.traceFilter("extract", "", candidate.url, `sentinel title: ${title || "empty"}`);
                  extractedSoFar++;
                  return;
                }
                trackExtraction(candidate.url, false);
                // Confidence gate: skip products with no meaningful data
                const hasSubstance = extractResult.data.title
                  && (extractResult.data.price || extractResult.data.materials?.length || extractResult.data.description);
                if (!hasSubstance) {
                  tracer.traceFilter("extract", "", candidate.url, "insufficient substance");
                  extractedSoFar++;
                  return;
                }

                // Category guard: reject products that don't match the
                // requested category (e.g. a lint roller returned for a
                // "vase" search). Quick-screen is URL-heuristic only; this
                // is the first semantic check on actual product content.
                const catCheck = productMatchesCategory(
                  category,
                  extractResult.data.category,
                  extractResult.data.title,
                );
                if (!catCheck.ok) {
                  tracer.traceFilter("extract", "", candidate.url, `category mismatch: ${catCheck.reason}`);
                  extractedSoFar++;
                  return;
                }

                // Price range filter: skip if price is way outside tier range
                const catBriefForPrice = brief.categories.find((c) => c.category === category);
                const priceRange = catBriefForPrice?.tiers[tier]?.price_range;
                if (priceRange && extractResult.data.price) {
                  if (extractResult.data.price > priceRange.max * 1.75) {
                    tracer.traceFilter("extract", "", candidate.url, `price $${extractResult.data.price} above 1.75x max $${priceRange.max}`);
                    extractedSoFar++;
                    return;
                  }
                  if (extractResult.data.price < priceRange.min * 0.4) {
                    tracer.traceFilter("extract", "", candidate.url, `price $${extractResult.data.price} below 0.4x min $${priceRange.min}`);
                    extractedSoFar++;
                    return;
                  }
                }

                const product: CandidateProduct = {
                  id: crypto.randomUUID(),
                  room_id: ctx.roomId,
                  search_session_id: null,
                  title: extractResult.data.title || candidate.title,
                  category: extractResult.data.category || category,
                  retailer: extractResult.data.retailer || candidate.source,
                  product_url: candidate.url,
                  image_url: extractResult.data.image_url,
                  local_image_path: null,
                  price: extractResult.data.price,
                  dimensions: extractResult.data.dimensions,
                  materials: extractResult.data.materials,
                  colors: extractResult.data.colors,
                  description: extractResult.data.description,
                  source_type: "agentic_search",
                  metadata: {
                    price_tier: tier,
                    lifestyle_image_url: extractResult.data.lifestyle_image_url || null,
                    visual_style_tags: extractResult.data.visual_style_tags || [],
                    available_variants: extractResult.data.available_variants || [],
                    // (r) Stock/availability info
                    in_stock: extractResult.data.in_stock ?? null,
                    stock_notes: extractResult.data.stock_notes || null,
                  },
                  status: "pending",
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                };

                // ── Computer Use fallback (detached) ──
                // JS-heavy retailer pages (West Elm, CB2, RH, etc.) often don't render
                // price/dimension tables for text-only scrapers. Queue CU as an
                // independent promise — don't block the extract slot waiting for
                // a browser session. The CU promise mutates `product` in place
                // and is awaited before Phase 5 reads product data.
                if (cuEnabled && (!product.price || !product.dimensions)) {
                  cuPromises.push(
                    cuFallbackLimit(async () => {
                      try {
                        const verifyResult = await Promise.race([
                          runProductVerifier({
                            productUrl: candidate.url,
                            expectedTitle: product.title ?? undefined,
                            expectedColor: product.colors?.[0],
                            maxTurns: 10,
                          }),
                          new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 60_000)),
                        ]);
                        if (verifyResult === "timeout" || !verifyResult.product) return;
                        const v = verifyResult.product;
                        if (typeof v.price === "number") product.price = v.price;
                        if (v.dimensions?.width_in || v.dimensions?.depth_in || v.dimensions?.height_in) {
                          product.dimensions = {
                            ...(v.dimensions.width_in != null ? { width: v.dimensions.width_in } : {}),
                            ...(v.dimensions.depth_in != null ? { depth: v.dimensions.depth_in } : {}),
                            ...(v.dimensions.height_in != null ? { height: v.dimensions.height_in } : {}),
                            unit: "inches" as const,
                          };
                        }
                        if (v.materials.length && !product.materials?.length) product.materials = v.materials;
                        if (v.available_colors.length && !product.colors?.length) product.colors = v.available_colors;
                        product.metadata = {
                          ...(product.metadata ?? {}),
                          cu_fallback: true,
                          cu_turns: verifyResult.turns,
                          in_stock: v.in_stock ?? null,
                        };
                        log.info("Computer use fallback enriched product", {
                          phase: "extract",
                          url: candidate.url,
                          category,
                          filledPrice: typeof v.price === "number",
                          filledDimensions: Boolean(product.dimensions),
                        });
                      } catch (cuErr) {
                        log.warn("Computer use fallback failed", {
                          phase: "extract",
                          url: candidate.url,
                          error: cuErr instanceof Error ? cuErr.message : String(cuErr),
                        });
                      }
                    })
                  );
                }

                extractedByCategory[category][tier].push(product);
                stats.totalExtracted++;
                tracer.trace({ phase: "extract", action: "success", productId: product.id, url: candidate.url, category, tier });
              } catch (err) {
                tracer.traceError("extract", candidate.url, err);
              }
              extractedSoFar++;
              // Report incremental progress every 5 extractions
              if (extractedSoFar % 5 === 0 || extractedSoFar === totalToExtract) {
                reportStep({
                  step: "Extracting product details from websites",
                  status: "running",
                  data: { extracted: stats.totalExtracted, progress: extractedSoFar, total: totalToExtract },
                });
              }
            })
          );
        }
      }
    }

    await Promise.all(extractPromises);

    // Wait for any detached CU fallback sessions to complete so deep-score
    // sees the enriched price/dimensions rather than the text-only defaults.
    if (cuPromises.length > 0) {
      log.info("Awaiting detached CU fallbacks", { count: cuPromises.length });
      await Promise.all(cuPromises);
    }

    // ── Price-tier reclassification ─────────────────────────────
    // Products often land in the wrong tier because search queries
    // are approximate. After extraction we know the actual price —
    // move products to their correct tier instead of dropping them.
    for (const [category, tierResults] of Object.entries(extractedByCategory)) {
      const catBriefForTier = brief.categories.find((c) => c.category === category);
      if (!catBriefForTier) continue;

      const toMove: Array<{ product: CandidateProduct; fromTier: PriceTier; toTier: PriceTier }> = [];

      for (const fromTier of PRICE_TIERS) {
        const products = tierResults[fromTier];
        for (const product of products) {
          if (!product.price) continue;
          // Find the correct tier based on actual price
          for (const candidateTier of PRICE_TIERS) {
            if (candidateTier === fromTier) continue;
            const range = catBriefForTier.tiers[candidateTier]?.price_range;
            if (range && product.price >= range.min * 0.6 && product.price <= range.max * 1.4) {
              const origRange = catBriefForTier.tiers[fromTier]?.price_range;
              if (origRange && (product.price > origRange.max * 1.5 || product.price < origRange.min * 0.5)) {
                toMove.push({ product, fromTier, toTier: candidateTier });
                break;
              }
            }
          }
        }
      }

      for (const { product, fromTier, toTier } of toMove) {
        extractedByCategory[category][fromTier] = extractedByCategory[category][fromTier].filter((p) => p.id !== product.id);
        product.metadata = { ...(product.metadata ?? {}), price_tier: toTier, reclassified_from: fromTier };
        extractedByCategory[category][toTier].push(product);
        tracer.trace({ phase: "extract", action: "tier_reclassify", productId: product.id, url: product.product_url ?? undefined, category, metadata: { from: fromTier, to: toTier } });
        log.info("Reclassified product tier", { category, url: product.product_url, from: fromTier, to: toTier, price: product.price });
      }
    }

    // Deduplicate extracted products by title+retailer within each tier
    // Uses fuzzy matching: normalize titles by removing size/color variants,
    // and deduplicate by URL hostname+path to catch same product with different titles
    for (const [category, tierResults] of Object.entries(extractedByCategory)) {
      for (const tier of PRICE_TIERS) {
        const seenTitles = new Set<string>();
        const seenUrlKeys = new Set<string>();
        extractedByCategory[category][tier] = tierResults[tier].filter((p) => {
          // Exact title+retailer dedup
          const titleKey = `${(p.title || "").toLowerCase().trim()}|${(p.retailer || "").toLowerCase().trim()}`;
          if (seenTitles.has(titleKey)) return false;
          seenTitles.add(titleKey);

          // URL-based dedup: normalize URL to hostname+pathname (ignore query params)
          if (p.product_url) {
            try {
              const u = new URL(p.product_url);
              const urlKey = `${u.hostname}${u.pathname.replace(/\/+$/, "")}`;
              if (seenUrlKeys.has(urlKey)) return false;
              seenUrlKeys.add(urlKey);
            } catch { /* invalid URL, skip URL dedup */ }
          }

          // Fuzzy title dedup: strip size/color suffixes and common variant patterns
          const normalizedTitle = (p.title || "")
            .toLowerCase()
            .replace(/\s*[-–]\s*(small|medium|large|xl|king|queen|twin|full|\d+["'x×]\s*\d+).*$/i, "")
            .replace(/\s*in\s+(white|black|gray|grey|beige|cream|walnut|oak|navy|blue|green)\s*$/i, "")
            .replace(/[^a-z0-9]/g, "")
            .trim();
          const fuzzyKey = `${normalizedTitle}|${(p.retailer || "").toLowerCase().trim()}`;
          if (normalizedTitle.length > 5 && seenTitles.has(fuzzyKey)) return false;
          seenTitles.add(fuzzyKey);

          return true;
        });
      }
    }

    reportStep({
      step: "Extracting product details from websites",
      status: "completed",
      data: { extracted: stats.totalExtracted },
    });

    // ═══════════════════════════════════════════════════════════
    // PHASE 5a: Quick score with Flash (batch, no images)
    // ═══════════════════════════════════════════════════════════
    reportStep({ step: "Quick-scoring all candidates", status: "running" });

    const quickScoresByProduct = new Map<string, number>();
    const quickScorePromises: Promise<void>[] = [];

    for (const [category, tierResults] of Object.entries(extractedByCategory)) {
      for (const tier of PRICE_TIERS) {
        const products = tierResults[tier];
        if (products.length === 0) continue;

        quickScorePromises.push(
          (async () => {
            const result = await quickScoreProducts(products, category, ctx.roomType, ctx.budgetMode, ctx.designDirection, ctx.placementMap?.[category], ctx.floorPlan, ctx.diagnosis as Record<string, unknown> | undefined, ctx.priorities, ctx.keepItems);
            if (result.tokensUsed) {
              tokenBudget.add(result.tokensUsed);
              stats.tokensUsed += result.tokensUsed;
              stats.tokensPerPhase.quick_score += result.tokensUsed;
            }
            if (result.success && result.data) {
              for (const entry of result.data) {
                quickScoresByProduct.set(entry.productId, entry.quickScore);
                stats.totalQuickScored++;
              }
            }
          })()
        );
      }
    }

    await Promise.all(quickScorePromises);

    reportStep({
      step: "Quick-scoring all candidates",
      status: "completed",
      data: { quickScored: stats.totalQuickScored },
    });

    // Build anchorSpecs: top quick-scored product per anchor category.
    // Dependent categories (coffee_table, side_table, nightstand, area_rug,
    // etc.) will receive these specs so deep-scoring is grounded in the real
    // found anchor, not abstract requirements.
    const ANCHOR_CATEGORIES = new Set([
      "sofa", "sectional", "area_rug", "bed", "dining_table",
      "media_console", "accent_chair",
    ]);
    const DEPENDENT_CATEGORIES = new Set([
      "coffee_table", "side_table", "end_table", "nightstand",
      "floor_lamp", "table_lamp", "throw_pillows", "throw_blanket",
      "dining_chairs", "pendant_light",
    ]);

    const anchorSpecs: Record<string, string> = {};
    for (const [category, tierResults] of Object.entries(extractedByCategory)) {
      if (!ANCHOR_CATEGORIES.has(category)) continue;
      // Find the highest quick-scored product across all tiers for this anchor
      let bestProduct: CandidateProduct | null = null;
      let bestScore = -1;
      for (const tier of PRICE_TIERS) {
        for (const p of tierResults[tier]) {
          const qs = quickScoresByProduct.get(p.id) ?? 0;
          if (qs > bestScore) { bestScore = qs; bestProduct = p; }
        }
      }
      if (!bestProduct) continue;
      const dim = bestProduct.dimensions;
      const dimStr = dim
        ? [
            dim.width && `W:${dim.width}${dim.unit === "cm" ? "cm" : '"'}`,
            dim.depth && `D:${dim.depth}${dim.unit === "cm" ? "cm" : '"'}`,
            dim.height && `H:${dim.height}${dim.unit === "cm" ? "cm" : '"'}`,
            dim.diameter && `Ø:${dim.diameter}${dim.unit === "cm" ? "cm" : '"'}`,
          ].filter(Boolean).join("×")
        : "dimensions unknown";
      const matStr = bestProduct.materials?.join(", ") || "material unknown";
      const colStr = bestProduct.colors?.join(", ") || "colors unknown";
      anchorSpecs[category] = `${bestProduct.title || category} | dimensions: ${dimStr} | material: ${matStr} | colors: ${colStr}`;
    }

    // ═══════════════════════════════════════════════════════════
    // PHASE 5b: Deep score top candidates with Pro (images, 8 dims)
    // ═══════════════════════════════════════════════════════════
    reportStep({ step: "Deep-scoring top candidates", status: "running" });

    const deepScoreLimit = pLimit(5);
    const deepScorePromises: Promise<void>[] = [];
    let totalToDeepScore = 0;

    for (const tierResults of Object.values(extractedByCategory)) {
      for (const tier of PRICE_TIERS) {
        let products = tierResults[tier];

        // Sort by quick score, keep top 8 per tier (or all if ≤8)
        products.sort((a, b) => {
          const scoreA = quickScoresByProduct.get(a.id) || 0;
          const scoreB = quickScoresByProduct.get(b.id) || 0;
          return (scoreB - scoreA) || tiebreakProduct(a, b);
        });

        // Filter out low-confidence products (quick score confidence < 4)
        // and products with no image — deep-score is vision-based, so a
        // null image_url means the LLM is scoring a blank prompt and
        // wasting tokens on a product it can't evaluate.
        products = products.filter((p) => {
          const qs = quickScoresByProduct.get(p.id);
          if (qs !== undefined && qs < 4) {
            tracer.traceFilter("quick_score", p.id, p.product_url || "", `quickScore ${qs} < 4`);
            return false;
          }
          if (!p.image_url) {
            tracer.traceFilter("quick_score", p.id, p.product_url || "", "no image_url");
            return false;
          }
          return true;
        });

        // Tier early-exit: if 3+ products already pass the 6.0 bar, deep-
        // score only those (max 5). Otherwise fall back to top-8 to give
        // sparse tiers a chance. Saves 40–60% of deep-score tokens on
        // healthy tiers where we've already found enough winners.
        const passThreshold = products.filter((p) => (quickScoresByProduct.get(p.id) || 0) >= 6);
        const topN = products.slice(0, 8);
        const toScore = passThreshold.length >= 3 ? passThreshold.slice(0, 5) : topN;
        totalToDeepScore += toScore.length;

        for (const product of toScore) {
          deepScorePromises.push(
            deepScoreLimit(async () => {
              if (tokenBudget.exceeded) {
                tracer.traceFilter("deep_score", product.id, product.product_url || "", "token budget exceeded");
                return;
              }
              const productCategory = product.category || "";
              const scoreResult = await scoreProduct(product, {
                roomType: ctx.roomType,
                budgetMode: ctx.budgetMode,
                existingItems: ctx.keepItems,
                roomImageUrls: ctx.imageUrls,
                priorities: ctx.priorities,
                otherRoomsContext: ctx.otherRoomsContext,
                designProfile: ctx.designProfile,
                diagnosis: ctx.diagnosis,
                designDirection: ctx.designDirection,
                userFeedbackContext: ctx.userFeedbackContext,
                placement: ctx.placementMap?.[productCategory],
                spatialLayout: ctx.spatialLayout,
                floorPlan: ctx.floorPlan,
                extractedFloorPlan: ctx.extractedFloorPlan,
                lightingConditions: ctx.lightingConditions,
                windowDoorPositions: ctx.windowDoorPositions,
                outletPositions: ctx.outletPositions,
                userContext: ctx.userContext,
                replaceItems: ctx.replaceItems,
                identifiedContext: ctx.identifiedContext,
                // Only pass anchor context to dependent categories so anchor
                // categories themselves don't get confused by self-reference.
                anchorSpecs: DEPENDENT_CATEGORIES.has(productCategory) && Object.keys(anchorSpecs).length > 0
                  ? anchorSpecs
                  : undefined,
              });
              if (scoreResult.tokensUsed) { tokenBudget.add(scoreResult.tokensUsed); stats.tokensUsed += scoreResult.tokensUsed; stats.tokensPerPhase.deep_score += scoreResult.tokensUsed; }
              if (scoreResult.success && scoreResult.data) {
                evaluations.set(product.id, scoreResult.data);
                stats.totalDeepScored++;
                tracer.traceScore("deep_score", product.id, scoreResult.data.final_item_score, { verdict: scoreResult.data.verdict });
                reportStep({
                  step: "Deep-scoring top candidates",
                  status: "running",
                  data: { deepScored: stats.totalDeepScored, total: totalToDeepScore },
                });
              }
            })
          );
        }
      }
    }

    await Promise.all(deepScorePromises);

    // Progressive degradation: if budget is tight, shed expensive phases
    // instead of aborting entirely.
    const budgetPct = tokenBudget.used / tokenBudget.cap;
    const skipPairwise = budgetPct > 0.85;
    const skipBackfill = budgetPct > 0.75;
    if (skipPairwise) {
      log.info("Budget >85% — skipping pairwise re-rank to preserve budget for validation/bundling", {
        tokensUsed: stats.tokensUsed, budgetPct: Math.round(budgetPct * 100),
      });
      (stats as Record<string, unknown>).bottlenecks = [...((stats as Record<string, unknown>).bottlenecks as string[] || []), "Pairwise re-rank skipped (budget conservation)"];
    }
    if (skipBackfill) {
      log.info("Budget >75% — skipping backfill to preserve budget for validation/bundling", {
        tokensUsed: stats.tokensUsed, budgetPct: Math.round(budgetPct * 100),
      });
    }

    if (tokenBudget.exceeded) {
      log.warn("Token budget fully exceeded — returning scored results", { tokensUsed: stats.tokensUsed, tokenCap: DEFAULT_TOKEN_CAP, deepScored: stats.totalDeepScored });
      reportStep({ step: "Token budget exceeded — returning scored results", status: "completed" });

      for (const [category, tierResults] of Object.entries(extractedByCategory)) {
        const kept: CandidateProduct[] = [];
        for (const tier of PRICE_TIERS) {
          const products = tierResults[tier].filter((p) => evaluations.has(p.id));
          products.sort((a, b) => {
            const scoreA = evaluations.get(a.id)?.final_item_score || 0;
            const scoreB = evaluations.get(b.id)?.final_item_score || 0;
            return (scoreB - scoreA) || tiebreakProduct(a, b);
          });
          kept.push(...products.slice(0, 5));
        }
        if (kept.length > 0) candidatesByCategory[category] = kept;
        stats.totalFinal += kept.length;
      }

      return {
        success: true,
        data: {
          searchBrief: brief,
          candidatesByCategory,
          evaluations,
          bundles: [],
          steps,
          stats: { ...stats, bottlenecks: [...((stats as Record<string, unknown>).bottlenecks as string[] || []), "Token budget exceeded before validation/bundling — partial results returned"] },
          trace: tracer.getTrace(),
        },
      };
    }

    reportStep({
      step: "Deep-scoring top candidates",
      status: "completed",
      data: { deepScored: stats.totalDeepScored },
    });

    // ═══════════════════════════════════════════════════════════
    // Phase 5c: Pairwise re-rank top-scored products per category
    // ═══════════════════════════════════════════════════════════
    if (skipPairwise) {
      reportStep({ step: "Pairwise re-ranking skipped (budget conservation)", status: "completed" });
    }
    if (!skipPairwise) reportStep({ step: "Pairwise re-ranking top candidates", status: "running" });

    const pairwiseRerankedByCategory: Record<string, Record<PriceTier, CandidateProduct[]>> = {};

    if (!skipPairwise) {
      const pairwisePromises: Promise<void>[] = [];

      for (const [category, tierResults] of Object.entries(extractedByCategory)) {
        pairwiseRerankedByCategory[category] = {
          budget: [], balanced: [], high_end: [],
        } as Record<PriceTier, CandidateProduct[]>;
        for (const tier of PRICE_TIERS) {
          const products = tierResults[tier].filter((p) => {
            const ev = evaluations.get(p.id);
            if (!ev) return false;
            if (ev.scores?.confidence_score !== undefined && ev.scores.confidence_score < 4) return false;
            return true;
          });
          products.sort((a, b) => {
            const scoreA = evaluations.get(a.id)?.final_item_score || 0;
            const scoreB = evaluations.get(b.id)?.final_item_score || 0;
            return (scoreB - scoreA) || tiebreakProduct(a, b);
          });
          if (products.length === 0) continue;

          // Early termination: if the top-3 deep scores are well-separated
          // (each gap > 1.5 points), pairwise won't change the order — skip
          // the LLM call and use the deep-score ordering directly.
          if (products.length >= 3) {
            const s0 = evaluations.get(products[0].id)?.final_item_score || 0;
            const s1 = evaluations.get(products[1].id)?.final_item_score || 0;
            const s2 = evaluations.get(products[2].id)?.final_item_score || 0;
            if (s0 - s1 > 1.5 && s1 - s2 > 1.5) {
              pairwiseRerankedByCategory[category][tier] = products;
              log.debug("Skipping pairwise (high score separation)", {
                category, tier, topScores: [s0, s1, s2],
              });
              continue;
            }
          }

          pairwisePromises.push(
            (async () => {
              if (tokenBudget.exceeded) {
                pairwiseRerankedByCategory[category][tier] = products;
                return;
              }
              const reranked = await pairwiseRerank(products, evaluations, {
                roomType: ctx.roomType,
                category,
                designDirection: ctx.designDirection?.style_notes,
                palette: ctx.designDirection?.recommended_palette,
                existingItems: ctx.keepItems,
              });
              pairwiseRerankedByCategory[category][tier] = reranked;
            })()
          );
        }
      }
      await Promise.all(pairwisePromises);
      reportStep({ step: "Pairwise re-ranking top candidates", status: "completed" });
    } else {
      // Skipped pairwise — use deep-scored products directly, sorted by score
      for (const [category, tierResults] of Object.entries(extractedByCategory)) {
        pairwiseRerankedByCategory[category] = { budget: [], balanced: [], high_end: [] } as Record<PriceTier, CandidateProduct[]>;
        for (const tier of PRICE_TIERS) {
          const products = tierResults[tier].filter((p) => evaluations.has(p.id));
          products.sort((a, b) => {
            const scoreA = evaluations.get(a.id)?.final_item_score || 0;
            const scoreB = evaluations.get(b.id)?.final_item_score || 0;
            return (scoreB - scoreA) || tiebreakProduct(a, b);
          });
          pairwiseRerankedByCategory[category][tier] = products;
        }
      }
    }

    // ═══════════════════════════════════════════════════════════
    // Phase 5d: MMR diversity selection + final organization
    //
    // After pairwise re-ranking, top-k products can still be redundant (same
    // retailer, material, color). MMR picks 5 that balance relevance and
    // diversity — λ=0.7 favors relevance but penalizes near-duplicates.
    // ═══════════════════════════════════════════════════════════
    const alsoConsidered: Record<string, CandidateProduct[]> = {};

    for (const [category, tierResults] of Object.entries(pairwiseRerankedByCategory)) {
      const kept: CandidateProduct[] = [];
      const alternatives: CandidateProduct[] = [];

      for (const tier of PRICE_TIERS) {
        const products = tierResults[tier];
        if (products.length === 0) continue;

        // MMR diversity selection for top 5
        const diverse = selectByMMR(products, evaluations, 5, 0.7);
        kept.push(...diverse);

        // "Also considered": the rest, ordered by pairwise rank (already sorted)
        const diverseIds = new Set(diverse.map((p) => p.id));
        const remaining = products.filter((p) => !diverseIds.has(p.id));
        alternatives.push(...remaining.slice(0, 15));
      }

      candidatesByCategory[category] = kept;
      if (alternatives.length > 0) {
        alsoConsidered[category] = alternatives;
      }
      stats.totalFinal += kept.length;
    }

    // ═══════════════════════════════════════════════════════════
    // PHASE 6: Validate + generate bundles
    // ═══════════════════════════════════════════════════════════
    reportStep({ step: "Validating all recommendations", status: "running" });

    const allProducts = Object.values(candidatesByCategory).flat();
    const validationResult = await validateProductSet(
      allProducts.map((p) => {
        const pMeta = p.metadata as Record<string, unknown> | null;
        return {
          title: p.title || "Unknown",
          category: p.category || "unknown",
          tier: ((pMeta?.price_tier as string) || "balanced"),
          materials: p.materials || undefined,
          colors: p.colors || undefined,
          price: p.price || undefined,
          description: p.description || undefined,
          image_url: p.image_url,
          dimensions: p.dimensions || undefined,
          visual_style_tags: (pMeta?.visual_style_tags as string[]) || undefined,
        };
      }),
      {
        roomType: ctx.roomType,
        designDirection: ctx.designDirection?.style_notes || "Based on apartment photos and building context",
        existingItems: ctx.keepItems,
        roomImageUrls: ctx.imageUrls,
        designProfile: ctx.designProfile,
        placementMap: ctx.placementMap,
        spatialLayout: ctx.spatialLayout,
        floorPlan: ctx.floorPlan,
        lightingConditions: ctx.lightingConditions,
        windowDoorPositions: ctx.windowDoorPositions,
        outletPositions: ctx.outletPositions,
        priorities: ctx.priorities,
        userContext: ctx.userContext,
        replaceItems: ctx.replaceItems,
        whatShouldGo: ctx.whatShouldGo,
        identifiedContext: ctx.identifiedContext,
        diagnosis: ctx.diagnosis,
      }
    );

    if (validationResult.tokensUsed) {
      tokenBudget.add(validationResult.tokensUsed);
      stats.tokensUsed += validationResult.tokensUsed;
      stats.tokensPerPhase.validation += validationResult.tokensUsed;
    }

    let validationData: { isValid: boolean; confidence: number; issues: string[] } | undefined;
    if (validationResult.success && validationResult.data) {
      validationData = {
        isValid: validationResult.data.isValid,
        confidence: validationResult.data.confidence,
        issues: validationResult.data.issues,
      };

      // Act on per-product harmony flags — demote products that clash with the set
      const flags = validationResult.data.product_flags;
      if (flags && flags.length > 0) {
        const clashingProducts = flags.filter((f) => f.harmony_score <= 3);
        const weakProducts = flags.filter((f) => f.harmony_score >= 4 && f.harmony_score <= 5);

        // Remove products that actively clash (score ≤ 3)
        for (const flag of clashingProducts) {
          for (const [category, products] of Object.entries(candidatesByCategory)) {
            const idx = products.findIndex(
              (p) => p.title?.toLowerCase() === flag.title.toLowerCase()
            );
            if (idx !== -1) {
              log.info(`Removing "${flag.title}" — harmony ${flag.harmony_score}/10`, { phase: "validation", title: flag.title, harmonyScore: flag.harmony_score, reason: flag.reason });
              tracer.traceFilter("validation", products[idx].id, products[idx].product_url || "", `harmony ${flag.harmony_score}/10: ${flag.reason}`);
              candidatesByCategory[category].splice(idx, 1);
              stats.totalFinal--;
            }
          }
        }

        // Penalize weak-fit products (score 4-5) by reducing their individual score
        for (const flag of weakProducts) {
          for (const products of Object.values(candidatesByCategory)) {
            const product = products.find(
              (p) => p.title?.toLowerCase() === flag.title.toLowerCase()
            );
            if (product) {
              const existing = evaluations.get(product.id);
              if (existing) {
                const penalty = (5 - flag.harmony_score) * 0.5; // 0.5 or 1.0 point penalty
                const penalized = Math.max(0, existing.final_item_score - penalty);
                log.info(`Penalizing "${flag.title}"`, { phase: "validation", title: flag.title, penalty, harmonyScore: flag.harmony_score, before: existing.final_item_score, after: penalized });
                evaluations.set(product.id, { ...existing, final_item_score: penalized });
              }
            }
          }
        }

        if (clashingProducts.length > 0 || weakProducts.length > 0) {
          log.info("Validation enforcement complete", { phase: "validation", dropped: clashingProducts.length, penalized: weakProducts.length });
        }
      }

      reportStep({ step: "Validating all recommendations", status: "completed", data: validationData });
    } else {
      reportStep({ step: "Validating all recommendations", status: "failed" });
    }

    // Generate bundles for each tier — try multiple combinations, pick best
    reportStep({ step: "Generating bundles", status: "running" });
    const bundles: unknown[] = [];

    const bundleCtx = {
      roomType: ctx.roomType,
      roomImageUrls: ctx.imageUrls,
      priorities: ctx.priorities,
      existingItems: ctx.keepItems,
      designProfile: ctx.designProfile,
      diagnosis: ctx.diagnosis,
      designDirection: ctx.designDirection,
      spatialLayout: ctx.spatialLayout,
      placementMap: ctx.placementMap,
      floorPlan: ctx.floorPlan,
      extractedFloorPlan: ctx.extractedFloorPlan,
      lightingConditions: ctx.lightingConditions,
      windowDoorPositions: ctx.windowDoorPositions,
      outletPositions: ctx.outletPositions,
      userContext: ctx.userContext,
      replaceItems: ctx.replaceItems,
      whatShouldGo: ctx.whatShouldGo,
      identifiedContext: ctx.identifiedContext,
    };

    const bundlePromises = PRICE_TIERS.map(async (tier) => {
      // Get top 3 products per category for this tier
      const topByCategory: CandidateProduct[][] = [];
      for (const products of Object.values(candidatesByCategory)) {
        const tierFiltered = products.filter(
          (p) => (p.metadata as { price_tier: string })?.price_tier === tier
        );
        tierFiltered.sort((a, b) => {
          const scoreA = evaluations.get(a.id)?.final_item_score || 0;
          const scoreB = evaluations.get(b.id)?.final_item_score || 0;
          return (scoreB - scoreA) || tiebreakProduct(a, b);
        });
        if (tierFiltered.length > 0) topByCategory.push(tierFiltered.slice(0, 3));
      }

      if (topByCategory.length === 0) return null;

      // Generate full cartesian product of top candidates across categories
      // e.g. 3 categories × 3 options each = up to 27 combos
      let combos = cartesian(topByCategory);

      // Safety cap: if more than 27 combos, keep only top 27 by average individual score
      if (combos.length > 27) {
        combos.sort((a, b) => {
          const avgA = a.reduce((s, p) => s + (evaluations.get(p.id)?.final_item_score || 0), 0) / a.length;
          const avgB = b.reduce((s, p) => s + (evaluations.get(p.id)?.final_item_score || 0), 0) / b.length;
          return (avgB - avgA) || tiebreakBundle(a, b);
        });
        combos = combos.slice(0, 27);
      }

      // Evaluate all combos with concurrency limit. Vibe is narrative-only
      // and doesn't affect final_bundle_score, so we skip it here and run it
      // just for the winning combo below.
      const bundleEvalLimit = pLimit(3);
      const comboResults = await Promise.all(
        combos.map((combo) =>
          bundleEvalLimit(async () => {
            if (tokenBudget.exceeded) return null;
            const result = await evaluateBundle(combo, bundleCtx, { skipVibe: true });
            if (result.tokensUsed) { tokenBudget.add(result.tokensUsed); stats.tokensUsed += result.tokensUsed; stats.tokensPerPhase.bundle += result.tokensUsed; }
            if (result.success && result.data) {
              return { products: combo, ...result.data };
            }
            return null;
          })
        )
      );

      const validResults = comboResults.filter(Boolean) as Array<{
        products: CandidateProduct[];
        scores: unknown;
        final_bundle_score: number;
        verdict: string;
        analysis: unknown;
      }>;

      if (validResults.length === 0) return null;

      // Pick the best bundle
      validResults.sort((a, b) => (b.final_bundle_score - a.final_bundle_score) || tiebreakBundle(a.products, b.products));
      const best = validResults[0];
      for (const r of validResults) {
        tracer.trace({ phase: "bundle", action: "evaluated", tier, score: r.final_bundle_score, metadata: { verdict: r.verdict } });
      }
      tracer.trace({ phase: "bundle", action: "selected", tier, score: best.final_bundle_score, metadata: { product_ids: best.products.map((p) => p.id) } });

      // Produce the room-vibe narrative for the winner only.
      let roomVibe: unknown = undefined;
      if (!tokenBudget.exceeded) {
        const vibeRes = await generateBundleVibe(best.products, bundleCtx, best.verdict);
        if (vibeRes.tokensUsed) { tokenBudget.add(vibeRes.tokensUsed); stats.tokensUsed += vibeRes.tokensUsed; stats.tokensPerPhase.bundle += vibeRes.tokensUsed; }
        if (vibeRes.success && vibeRes.data) roomVibe = vibeRes.data.room_vibe;
      }

      return {
        tier,
        scores: best.scores,
        final_bundle_score: best.final_bundle_score,
        verdict: best.verdict,
        analysis: best.analysis,
        room_vibe: roomVibe,
        product_ids: best.products.map((p) => p.id),
        combos_evaluated: validResults.length,
      };
    });

    const bundleResults = await Promise.all(bundlePromises);
    for (const b of bundleResults) {
      if (b) bundles.push(b);
    }
    reportStep({ step: "Generating bundles", status: "completed", data: { bundles: bundles.length } });

    // ═══════════════════════════════════════════════════════════
    // Backfill weak tiers
    // ═══════════════════════════════════════════════════════════
    const weakTiers: Array<{ category: string; tier: PriceTier }> = [];
    for (const [category, products] of Object.entries(candidatesByCategory)) {
      for (const tier of PRICE_TIERS) {
        const tierProducts = products.filter(
          (p) => (p.metadata as { price_tier: string })?.price_tier === tier
        );
        const strongProducts = tierProducts.filter(
          (p) => (evaluations.get(p.id)?.final_item_score || 0) >= 7
        );
        if (strongProducts.length < 3) {
          weakTiers.push({ category, tier });
        }
      }
    }

    if (weakTiers.length > 0 && !tokenBudget.exceeded && !skipBackfill) {
      reportStep({
        step: `Backfilling ${weakTiers.length} weak tier(s)`,
        status: "running",
        data: { weakTiers: weakTiers.map((t) => `${t.category}/${t.tier}`) },
      });

      // Run targeted backfill searches for weak tiers
      const backfillSearchLimit = pLimit(10);
      const backfillPromises = weakTiers.map((wt) =>
        backfillSearchLimit(async () => {
          const styleHint = ctx.designDirection?.style_notes || "modern apartment";
          const backfillQuery = `best ${wt.category} for ${styleHint} ${TIER_LABELS[wt.tier]} price ${new Date().getFullYear()}`;
          const searchResult = await searchProducts(backfillQuery, 10, wt.tier, wt.category, ctx.imageUrls);
          if (!searchResult.success || !searchResult.data) return;

          const filtered = searchResult.data.filter((c) => c.url && isLikelyProductUrl(c.url));
          const deduped = deduplicateCandidates(filtered);

          // Extract top 5 backfill candidates
          for (const candidate of deduped.slice(0, 5)) {
            try {
              const extractResult = await extractFromUrl(candidate.url, ctx.designProfile, ctx.imageUrls);
              if (!extractResult.success || !extractResult.data) continue;
              if (!extractResult.data.title && !extractResult.data.price) continue;

              // Same category guard used in the main path.
              const catCheck = productMatchesCategory(
                wt.category,
                extractResult.data.category,
                extractResult.data.title,
              );
              if (!catCheck.ok) {
                tracer.traceFilter("extract", "", candidate.url, `backfill category mismatch: ${catCheck.reason}`);
                continue;
              }

              const product: CandidateProduct = {
                id: crypto.randomUUID(),
                room_id: ctx.roomId,
                search_session_id: null,
                title: extractResult.data.title || candidate.title,
                category: extractResult.data.category || wt.category,
                retailer: extractResult.data.retailer || candidate.source,
                product_url: candidate.url,
                image_url: extractResult.data.image_url,
                local_image_path: null,
                price: extractResult.data.price,
                dimensions: extractResult.data.dimensions,
                materials: extractResult.data.materials,
                colors: extractResult.data.colors,
                description: extractResult.data.description,
                source_type: "agentic_search",
                metadata: {
                  price_tier: wt.tier,
                  backfill: true,
                  lifestyle_image_url: extractResult.data.lifestyle_image_url || null,
                  visual_style_tags: extractResult.data.visual_style_tags || [],
                  available_variants: extractResult.data.available_variants || [],
                },
                status: "pending",
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              };

              // Deep score the backfill product directly
              const backfillCategory = product.category || "";
              const scoreResult = await scoreProduct(product, {
                roomType: ctx.roomType,
                budgetMode: ctx.budgetMode,
                existingItems: ctx.keepItems,
                roomImageUrls: ctx.imageUrls,
                priorities: ctx.priorities,
                otherRoomsContext: ctx.otherRoomsContext,
                designProfile: ctx.designProfile,
                diagnosis: ctx.diagnosis,
                designDirection: ctx.designDirection,
                userFeedbackContext: ctx.userFeedbackContext,
                placement: ctx.placementMap?.[backfillCategory],
                spatialLayout: ctx.spatialLayout,
                floorPlan: ctx.floorPlan,
                extractedFloorPlan: ctx.extractedFloorPlan,
                lightingConditions: ctx.lightingConditions,
                windowDoorPositions: ctx.windowDoorPositions,
                outletPositions: ctx.outletPositions,
                userContext: ctx.userContext,
                replaceItems: ctx.replaceItems,
                identifiedContext: ctx.identifiedContext,
                anchorSpecs: DEPENDENT_CATEGORIES.has(backfillCategory) && Object.keys(anchorSpecs).length > 0
                  ? anchorSpecs
                  : undefined,
              });
              if (scoreResult.success && scoreResult.data) {
                evaluations.set(product.id, scoreResult.data);
                if (scoreResult.data.final_item_score >= 6) {
                  candidatesByCategory[wt.category] = candidatesByCategory[wt.category] || [];
                  candidatesByCategory[wt.category].push(product);
                  stats.totalFinal++;
                }
              }
            } catch {
              // Skip failed backfill extractions
            }
          }
        })
      );

      await Promise.all(backfillPromises);
      reportStep({ step: `Backfilling ${weakTiers.length} weak tier(s)`, status: "completed" });

      // Re-run bundle evaluation for tiers that got backfill products
      if (!tokenBudget.exceeded) {
        const backfilledTiers = new Set(weakTiers.map((wt) => wt.tier));
        reportStep({ step: "Re-evaluating bundles after backfill", status: "running" });

        for (const tier of backfilledTiers) {
          const topByCategory: CandidateProduct[][] = [];
          for (const products of Object.values(candidatesByCategory)) {
            const tierFiltered = products.filter(
              (p) => (p.metadata as { price_tier: string })?.price_tier === tier
            );
            tierFiltered.sort((a, b) => {
              const scoreA = evaluations.get(a.id)?.final_item_score || 0;
              const scoreB = evaluations.get(b.id)?.final_item_score || 0;
              return (scoreB - scoreA) || tiebreakProduct(a, b);
            });
            if (tierFiltered.length > 0) topByCategory.push(tierFiltered.slice(0, 3));
          }

          if (topByCategory.length === 0) continue;

          let combos = cartesian(topByCategory);
          if (combos.length > 27) {
            combos.sort((a, b) => {
              const avgA = a.reduce((s, p) => s + (evaluations.get(p.id)?.final_item_score || 0), 0) / a.length;
              const avgB = b.reduce((s, p) => s + (evaluations.get(p.id)?.final_item_score || 0), 0) / b.length;
              return (avgB - avgA) || tiebreakBundle(a, b);
            });
            combos = combos.slice(0, 27);
          }

          const bundleEvalLimit2 = pLimit(3);
          const comboResults = await Promise.all(
            combos.map((combo) =>
              bundleEvalLimit2(async () => {
                if (tokenBudget.exceeded) return null;
                const result = await evaluateBundle(combo, bundleCtx, { skipVibe: true });
                if (result.tokensUsed) { tokenBudget.add(result.tokensUsed); stats.tokensUsed += result.tokensUsed; }
                if (result.success && result.data) {
                  return { products: combo, ...result.data };
                }
                return null;
              })
            )
          );

          const validResults = comboResults.filter(Boolean) as Array<{
            products: CandidateProduct[];
            scores: unknown;
            final_bundle_score: number;
            verdict: string;
            analysis: unknown;
          }>;

          if (validResults.length > 0) {
            validResults.sort((a, b) => (b.final_bundle_score - a.final_bundle_score) || tiebreakBundle(a.products, b.products));
            const best = validResults[0];

            // Vibe for the winner only
            let roomVibe: unknown = undefined;
            if (!tokenBudget.exceeded) {
              const vibeRes = await generateBundleVibe(best.products, bundleCtx, best.verdict);
              if (vibeRes.tokensUsed) { tokenBudget.add(vibeRes.tokensUsed); stats.tokensUsed += vibeRes.tokensUsed; }
              if (vibeRes.success && vibeRes.data) roomVibe = vibeRes.data.room_vibe;
            }

            // Replace existing bundle for this tier
            const existingIdx = bundles.findIndex((b) => (b as { tier: string }).tier === tier);
            const newBundle = {
              tier,
              scores: best.scores,
              final_bundle_score: best.final_bundle_score,
              verdict: best.verdict,
              analysis: best.analysis,
              room_vibe: roomVibe,
              product_ids: best.products.map((p) => p.id),
              combos_evaluated: validResults.length,
              backfill_reeval: true,
            };
            if (existingIdx >= 0) {
              bundles[existingIdx] = newBundle;
            } else {
              bundles.push(newBundle);
            }
            tracer.trace({ phase: "bundle", action: "backfill_reeval", tier, score: best.final_bundle_score });
          }
        }

        reportStep({ step: "Re-evaluating bundles after backfill", status: "completed" });
      }
    }

    // ═══════════════════════════════════════════════════════════
    // Pipeline conversion metrics + score drift check
    // ═══════════════════════════════════════════════════════════
    const conversionRates = {
      searchToDedup: stats.totalRawUrls > 0 ? Math.round((stats.totalAfterDedup / stats.totalRawUrls) * 100) : 0,
      dedupToScreen: stats.totalAfterDedup > 0 ? Math.round((stats.totalAfterScreen / stats.totalAfterDedup) * 100) : 0,
      screenToExtract: stats.totalAfterScreen > 0 ? Math.round((stats.totalExtracted / stats.totalAfterScreen) * 100) : 0,
      extractToQuickScore: stats.totalExtracted > 0 ? Math.round((stats.totalQuickScored / stats.totalExtracted) * 100) : 0,
      quickToDeep: stats.totalQuickScored > 0 ? Math.round((stats.totalDeepScored / stats.totalQuickScored) * 100) : 0,
      deepToFinal: stats.totalDeepScored > 0 ? Math.round((stats.totalFinal / stats.totalDeepScored) * 100) : 0,
      overallYield: stats.totalRawUrls > 0 ? Math.round((stats.totalFinal / stats.totalRawUrls) * 100) : 0,
    };

    log.info("Pipeline conversion rates", { phase: "stats", conversionRates });

    // Identify bottlenecks — any stage dropping more than 80% is worth investigating
    const bottlenecks: string[] = [];
    if (conversionRates.screenToExtract < 20 && stats.totalAfterScreen > 10) {
      bottlenecks.push(`Extraction success rate low (${conversionRates.screenToExtract}%) — product pages may be hard to scrape`);
    }
    if (conversionRates.deepToFinal < 30 && stats.totalDeepScored > 10) {
      bottlenecks.push(`Deep score → final rate low (${conversionRates.deepToFinal}%) — scoring may be too strict or search queries are off-target`);
    }
    if (stats.totalFinal === 0 && stats.totalRawUrls > 20) {
      bottlenecks.push(`Zero final products from ${stats.totalRawUrls} URLs — search queries may not match available products`);
    }
    if (bottlenecks.length > 0) {
      log.warn("Pipeline bottlenecks detected", { phase: "stats", bottlenecks });
    }

    // Check for score drift
    const driftWarnings = checkForDrift();
    if (driftWarnings.length > 0) {
      log.warn(`Score drift detected (${driftWarnings.length} warnings)`, { phase: "drift", warnings: driftWarnings.map((w) => w.message) });
    }

    const distribution = getScoreDistributionSummary();
    if (Object.keys(distribution).length > 0) {
      log.info("Score distributions", { phase: "drift", distribution });
    }

    // Log per-phase token breakdown for cost analysis
    log.info("Token usage by phase", { phase: "stats", tokensPerPhase: stats.tokensPerPhase, totalTokens: stats.tokensUsed });

    return {
      success: true,
      data: {
        searchBrief: brief,
        candidatesByCategory,
        alsoConsidered: Object.keys(alsoConsidered).length > 0 ? alsoConsidered : undefined,
        evaluations,
        bundles,
        steps,
        validation: validationData,
        stats: { ...stats, conversionRates, bottlenecks, driftWarnings: driftWarnings.map((w) => w.message) },
        trace: tracer.getTrace(),
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Orchestration failed",
    };
  }
}
