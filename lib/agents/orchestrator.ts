import {
  generateSearchBrief,
  searchProducts,
  deduplicateCandidates,
  quickScreenCandidates,
  type SearchCandidate,
  type SearchBrief,
} from "./shopping-researcher";
import { extractFromUrl } from "./product-extractor";
import { scoreProduct, quickScoreProducts } from "./fit-scorer";
import { evaluateBundle } from "./bundle-optimizer";
import { validateProductSet } from "./validation-agent";
import { PipelineTracer } from "./pipeline-trace";
import type { AgentContext, AgentResult } from "./types";
import type { CandidateProduct } from "@/lib/types/database";
import type { ProductEvaluationResult } from "@/lib/types/scoring";
import type { PriceTier } from "@/lib/prompts/search-brief";

// ─── Types ─────────────────────────────────────────────────────

export interface OrchestrationStep {
  step: string;
  status: "pending" | "running" | "completed" | "failed";
  data?: unknown;
}

export interface OrchestrationResult {
  searchBrief: unknown;
  candidatesByCategory: Record<string, CandidateProduct[]>;
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

/** Default cap: 1.5M tokens per search run (~$3-4 on Gemini pricing). */
const DEFAULT_TOKEN_CAP = 1_500_000;

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
  };

  function reportStep(step: OrchestrationStep) {
    // Attach running stats to every step event for real-time progress
    const enriched = { ...step, data: { ...(step.data as Record<string, unknown> || {}), stats: { ...stats } } };
    steps.push(step);
    onStep?.(enriched);
    console.log(`[orchestrator] ${step.status}: ${step.step}`);
  }

  try {
    // ═══════════════════════════════════════════════════════════
    // PHASE 1: Generate search brief (5 queries × 3 tiers × N categories)
    // ═══════════════════════════════════════════════════════════
    reportStep({ step: "Generating intensive search brief", status: "running" });
    const briefResult = await generateSearchBrief(
      ctx.roomType, missingCategories, ctx.budgetMode, categoryHints,
      ctx.designProfile, ctx.designDirection, ctx.priorities,
      ctx.keepItems, ctx.spatialLayout, ctx.roomSummary
    );
    if (!briefResult.success || !briefResult.data) {
      reportStep({ step: "Generating intensive search brief", status: "failed", data: { error: briefResult.error } });
      console.error("[orchestrator] Search brief failed:", briefResult.error);
      return { success: false, error: briefResult.error || "Failed to generate search brief" };
    }
    const brief: SearchBrief = briefResult.data;
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

    stats.totalSearchQueries = searchTasks.length;

    // Run all searches with concurrency limit of 15 (Flash Lite is fast)
    const searchLimit = pLimit(15);
    const searchResultsByCategory: Record<string, Record<PriceTier, SearchCandidate[]>> = {};
    let searchesCompleted = 0;

    const searchPromises = searchTasks.map((task) =>
      searchLimit(async () => {
        tracer.trace({ phase: "search", action: "query", category: task.category, tier: task.tier, metadata: { query: task.query, angle: task.angle } });
        const result = await searchProducts(task.query, 10, task.tier, task.category);
        const candidates = result.success ? (result.data || []) : [];
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

    // Count raw URLs and deduplicate per category+tier
    const dedupedByCategory: Record<string, Record<PriceTier, SearchCandidate[]>> = {};

    for (const [category, tierResults] of Object.entries(searchResultsByCategory)) {
      dedupedByCategory[category] = { budget: [], balanced: [], high_end: [] };
      for (const tier of PRICE_TIERS) {
        const raw = tierResults[tier].filter((c) => c.url && isLikelyProductUrl(c.url));
        stats.totalRawUrls += raw.length;
        const deduped = deduplicateCandidates(raw);
        stats.totalAfterDedup += deduped.length;
        dedupedByCategory[category][tier] = deduped;
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
            const screenResult = await quickScreenCandidates(candidates, category, tier, requirements, ctx.designDirection);
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
              // Fail open: keep all candidates
              screenedByCategory[category][tier] = candidates;
              stats.totalAfterScreen += candidates.length;
            }
          })()
        );
      }
    }

    await Promise.all(screenPromises);

    reportStep({
      step: "Quick-screening candidates",
      status: "completed",
      data: { screened: stats.totalAfterScreen },
    });

    // ═══════════════════════════════════════════════════════════
    // PHASE 4: Extract all screened URLs with URL Context
    // ═══════════════════════════════════════════════════════════
    reportStep({ step: "Extracting product details from websites", status: "running" });

    const extractLimit = pLimit(10);
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
                const extractResult = await extractFromUrl(candidate.url);
                if (extractResult.tokensUsed) { tokenBudget.add(extractResult.tokensUsed); stats.tokensUsed += extractResult.tokensUsed; }
                if (!extractResult.success || !extractResult.data) {
                  tracer.traceError("extract", candidate.url, extractResult.error || "extraction failed");
                  extractedSoFar++;
                  return;
                }
                if (!extractResult.data.title && !extractResult.data.price) {
                  tracer.traceFilter("extract", "", candidate.url, "no title or price");
                  extractedSoFar++;
                  return;
                }
                // Confidence gate: skip products with no meaningful data
                const hasSubstance = extractResult.data.title
                  && (extractResult.data.price || extractResult.data.materials?.length || extractResult.data.description);
                if (!hasSubstance) {
                  tracer.traceFilter("extract", "", candidate.url, "insufficient substance");
                  extractedSoFar++;
                  return;
                }

                // Price range filter: skip if price is way outside tier range
                const catBriefForPrice = brief.categories.find((c) => c.category === category);
                const priceRange = catBriefForPrice?.tiers[tier]?.price_range;
                if (priceRange && extractResult.data.price) {
                  if (extractResult.data.price > priceRange.max * 2) {
                    tracer.traceFilter("extract", "", candidate.url, `price $${extractResult.data.price} above 2x max $${priceRange.max}`);
                    extractedSoFar++;
                    return;
                  }
                  if (extractResult.data.price < priceRange.min * 0.3) {
                    tracer.traceFilter("extract", "", candidate.url, `price $${extractResult.data.price} below 0.3x min $${priceRange.min}`);
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
                  },
                  status: "pending",
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                };

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

    // Deduplicate extracted products by title+retailer within each tier
    for (const [category, tierResults] of Object.entries(extractedByCategory)) {
      for (const tier of PRICE_TIERS) {
        const seen = new Set<string>();
        extractedByCategory[category][tier] = tierResults[tier].filter((p) => {
          const key = `${(p.title || "").toLowerCase().trim()}|${(p.retailer || "").toLowerCase().trim()}`;
          if (seen.has(key)) return false;
          seen.add(key);
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

    // ═══════════════════════════════════════════════════════════
    // PHASE 5b: Deep score top candidates with Pro (images, 8 dims)
    // ═══════════════════════════════════════════════════════════
    reportStep({ step: "Deep-scoring top candidates", status: "running" });

    const deepScoreLimit = pLimit(5);
    const deepScorePromises: Promise<void>[] = [];
    let totalToDeepScore = 0;

    for (const [category, tierResults] of Object.entries(extractedByCategory)) {
      for (const tier of PRICE_TIERS) {
        let products = tierResults[tier];

        // Sort by quick score, keep top 8 per tier (or all if ≤8)
        products.sort((a, b) => {
          const scoreA = quickScoresByProduct.get(a.id) || 0;
          const scoreB = quickScoresByProduct.get(b.id) || 0;
          return scoreB - scoreA;
        });

        // Filter out low-confidence products (quick score confidence < 4)
        products = products.filter((p) => {
          const qs = quickScoresByProduct.get(p.id);
          if (qs !== undefined && qs < 4) {
            tracer.traceFilter("quick_score", p.id, p.product_url || "", `quickScore ${qs} < 4`);
            return false;
          }
          return true;
        });

        // Keep top 8 or those with quickScore >= 6, whichever is more
        const passThreshold = products.filter((p) => (quickScoresByProduct.get(p.id) || 0) >= 6);
        const topN = products.slice(0, 8);
        const toScore = passThreshold.length > topN.length ? passThreshold.slice(0, 12) : topN;
        totalToDeepScore += toScore.length;

        for (const product of toScore) {
          deepScorePromises.push(
            deepScoreLimit(async () => {
              if (tokenBudget.exceeded) {
                tracer.traceFilter("deep_score", product.id, product.product_url || "", "token budget exceeded");
                return;
              }
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
                placement: ctx.placementMap?.[product.category || ""],
                spatialLayout: ctx.spatialLayout,
                floorPlan: ctx.floorPlan,
                lightingConditions: ctx.lightingConditions,
                windowDoorPositions: ctx.windowDoorPositions,
                outletPositions: ctx.outletPositions,
              });
              if (scoreResult.tokensUsed) { tokenBudget.add(scoreResult.tokensUsed); stats.tokensUsed += scoreResult.tokensUsed; }
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

    if (tokenBudget.exceeded) {
      console.warn(`[orchestrator] Token budget exceeded (${stats.tokensUsed.toLocaleString()}/${DEFAULT_TOKEN_CAP.toLocaleString()}), skipping validation and bundles`);
      reportStep({ step: "Token budget exceeded — returning scored results", status: "completed" });
      return {
        success: true,
        data: {
          searchBrief: brief,
          candidatesByCategory,
          evaluations,
          bundles: [],
          steps,
          stats,
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
    // Organize final results: top 5 per tier per category
    // ═══════════════════════════════════════════════════════════
    for (const [category, tierResults] of Object.entries(extractedByCategory)) {
      const kept: CandidateProduct[] = [];

      for (const tier of PRICE_TIERS) {
        const products = tierResults[tier].filter((p) => evaluations.has(p.id));
        products.sort((a, b) => {
          const scoreA = evaluations.get(a.id)?.final_item_score || 0;
          const scoreB = evaluations.get(b.id)?.final_item_score || 0;
          return scoreB - scoreA;
        });
        kept.push(...products.slice(0, 5));
      }

      candidatesByCategory[category] = kept;
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
      }
    );

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
              (p) => p.title?.toLowerCase() === flag.title.toLowerCase() || p.category === flag.category
            );
            if (idx !== -1) {
              console.log(`[orchestrator] Removing "${flag.title}" — harmony ${flag.harmony_score}/10: ${flag.reason}`);
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
                console.log(`[orchestrator] Penalizing "${flag.title}" by ${penalty} (harmony ${flag.harmony_score}/10) — ${existing.final_item_score.toFixed(1)} → ${penalized.toFixed(1)}`);
                evaluations.set(product.id, { ...existing, final_item_score: penalized });
              }
            }
          }
        }

        if (clashingProducts.length > 0 || weakProducts.length > 0) {
          console.log(`[orchestrator] Validation enforcement: dropped ${clashingProducts.length}, penalized ${weakProducts.length}`);
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
      lightingConditions: ctx.lightingConditions,
      windowDoorPositions: ctx.windowDoorPositions,
      outletPositions: ctx.outletPositions,
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
          return scoreB - scoreA;
        });
        if (tierFiltered.length > 0) topByCategory.push(tierFiltered.slice(0, 3));
      }

      if (topByCategory.length === 0) return null;

      // Generate full cartesian product of top candidates across categories
      // e.g. 3 categories × 3 options each = up to 27 combos
      function cartesian(arrays: CandidateProduct[][]): CandidateProduct[][] {
        if (arrays.length === 0) return [[]];
        const [first, ...rest] = arrays;
        const restCombos = cartesian(rest);
        const result: CandidateProduct[][] = [];
        for (const item of first) {
          for (const combo of restCombos) {
            result.push([item, ...combo]);
          }
        }
        return result;
      }

      let combos = cartesian(topByCategory);

      // Safety cap: if more than 27 combos, keep only top 27 by average individual score
      if (combos.length > 27) {
        combos.sort((a, b) => {
          const avgA = a.reduce((s, p) => s + (evaluations.get(p.id)?.final_item_score || 0), 0) / a.length;
          const avgB = b.reduce((s, p) => s + (evaluations.get(p.id)?.final_item_score || 0), 0) / b.length;
          return avgB - avgA;
        });
        combos = combos.slice(0, 27);
      }

      // Evaluate all combos with concurrency limit
      const bundleEvalLimit = pLimit(3);
      const comboResults = await Promise.all(
        combos.map((combo) =>
          bundleEvalLimit(async () => {
            if (tokenBudget.exceeded) return null;
            const result = await evaluateBundle(combo, bundleCtx);
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

      if (validResults.length === 0) return null;

      // Pick the best bundle
      validResults.sort((a, b) => b.final_bundle_score - a.final_bundle_score);
      const best = validResults[0];
      for (const r of validResults) {
        tracer.trace({ phase: "bundle", action: "evaluated", tier, score: r.final_bundle_score, metadata: { verdict: r.verdict } });
      }
      tracer.trace({ phase: "bundle", action: "selected", tier, score: best.final_bundle_score, metadata: { product_ids: best.products.map((p) => p.id) } });
      return {
        tier,
        scores: best.scores,
        final_bundle_score: best.final_bundle_score,
        verdict: best.verdict,
        analysis: best.analysis,
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

    if (weakTiers.length > 0 && !tokenBudget.exceeded) {
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
          const backfillQuery = `best ${wt.category} for ${styleHint} ${TIER_LABELS[wt.tier]} price 2025`;
          const searchResult = await searchProducts(backfillQuery, 10, wt.tier, wt.category);
          if (!searchResult.success || !searchResult.data) return;

          const filtered = searchResult.data.filter((c) => c.url && isLikelyProductUrl(c.url));
          const deduped = deduplicateCandidates(filtered);

          // Extract top 5 backfill candidates
          for (const candidate of deduped.slice(0, 5)) {
            try {
              const extractResult = await extractFromUrl(candidate.url);
              if (!extractResult.success || !extractResult.data) continue;
              if (!extractResult.data.title && !extractResult.data.price) continue;

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
                placement: ctx.placementMap?.[product.category || ""],
                spatialLayout: ctx.spatialLayout,
                floorPlan: ctx.floorPlan,
                lightingConditions: ctx.lightingConditions,
                windowDoorPositions: ctx.windowDoorPositions,
                outletPositions: ctx.outletPositions,
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
              return scoreB - scoreA;
            });
            if (tierFiltered.length > 0) topByCategory.push(tierFiltered.slice(0, 3));
          }

          if (topByCategory.length === 0) continue;

          // Simplified cartesian for backfill re-eval (same logic, capped at 27)
          function cartesianBackfill(arrays: CandidateProduct[][]): CandidateProduct[][] {
            if (arrays.length === 0) return [[]];
            const [first, ...rest] = arrays;
            const restCombos = cartesianBackfill(rest);
            const result: CandidateProduct[][] = [];
            for (const item of first) {
              for (const combo of restCombos) {
                result.push([item, ...combo]);
              }
            }
            return result;
          }

          let combos = cartesianBackfill(topByCategory);
          if (combos.length > 27) {
            combos.sort((a, b) => {
              const avgA = a.reduce((s, p) => s + (evaluations.get(p.id)?.final_item_score || 0), 0) / a.length;
              const avgB = b.reduce((s, p) => s + (evaluations.get(p.id)?.final_item_score || 0), 0) / b.length;
              return avgB - avgA;
            });
            combos = combos.slice(0, 27);
          }

          const bundleEvalLimit2 = pLimit(3);
          const comboResults = await Promise.all(
            combos.map((combo) =>
              bundleEvalLimit2(async () => {
                if (tokenBudget.exceeded) return null;
                const result = await evaluateBundle(combo, bundleCtx);
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
            validResults.sort((a, b) => b.final_bundle_score - a.final_bundle_score);
            const best = validResults[0];
            // Replace existing bundle for this tier
            const existingIdx = bundles.findIndex((b) => (b as { tier: string }).tier === tier);
            const newBundle = {
              tier,
              scores: best.scores,
              final_bundle_score: best.final_bundle_score,
              verdict: best.verdict,
              analysis: best.analysis,
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

    return {
      success: true,
      data: {
        searchBrief: brief,
        candidatesByCategory,
        evaluations,
        bundles,
        steps,
        validation: validationData,
        stats,
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
