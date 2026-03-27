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
  };
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
  const stats = {
    totalSearchQueries: 0,
    totalRawUrls: 0,
    totalAfterDedup: 0,
    totalAfterScreen: 0,
    totalExtracted: 0,
    totalQuickScored: 0,
    totalDeepScored: 0,
    totalFinal: 0,
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
      ctx.designProfile, ctx.designDirection, ctx.priorities
    );
    if (!briefResult.success || !briefResult.data) {
      reportStep({ step: "Generating intensive search brief", status: "failed" });
      return { success: false, error: "Failed to generate search brief" };
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

    // Run all searches with concurrency limit of 15
    const searchLimit = pLimit(15);
    const searchResultsByCategory: Record<string, Record<PriceTier, SearchCandidate[]>> = {};
    let searchesCompleted = 0;

    const searchPromises = searchTasks.map((task) =>
      searchLimit(async () => {
        const result = await searchProducts(task.query, 10, task.tier);
        searchesCompleted++;
        // Report progress every 5 searches
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
          candidates: result.success ? (result.data || []) : [],
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
                if (!extractResult.success || !extractResult.data) {
                  extractedSoFar++;
                  return;
                }
                if (!extractResult.data.title && !extractResult.data.price) {
                  extractedSoFar++;
                  return;
                }
                // Confidence gate: skip products with no meaningful data
                const hasSubstance = extractResult.data.title
                  && (extractResult.data.price || extractResult.data.materials?.length || extractResult.data.description);
                if (!hasSubstance) {
                  extractedSoFar++;
                  return;
                }

                // Price range filter: skip if price is way outside tier range
                const catBriefForPrice = brief.categories.find((c) => c.category === category);
                const priceRange = catBriefForPrice?.tiers[tier]?.price_range;
                if (priceRange && extractResult.data.price) {
                  if (extractResult.data.price > priceRange.max * 2) {
                    extractedSoFar++;
                    return;
                  }
                  if (extractResult.data.price < priceRange.min * 0.3) {
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
              } catch {
                // Skip failed extractions
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
            const result = await quickScoreProducts(products, category, ctx.roomType, ctx.budgetMode, ctx.designDirection);
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
          return qs === undefined || qs >= 4; // keep unscored (fail-open) and scored >= 4
        });

        // Keep top 8 or those with quickScore >= 6, whichever is more
        const passThreshold = products.filter((p) => (quickScoresByProduct.get(p.id) || 0) >= 6);
        const topN = products.slice(0, 8);
        const toScore = passThreshold.length > topN.length ? passThreshold.slice(0, 12) : topN;
        totalToDeepScore += toScore.length;

        for (const product of toScore) {
          deepScorePromises.push(
            deepScoreLimit(async () => {
              const scoreResult = await scoreProduct(product, {
                roomType: ctx.roomType,
                budgetMode: ctx.budgetMode,
                existingItems: ctx.keepItems,
                roomImageUrls: ctx.imageUrls,
                priorities: ctx.priorities,
                designProfile: ctx.designProfile,
                diagnosis: ctx.diagnosis,
                designDirection: ctx.designDirection,
              });
              if (scoreResult.success && scoreResult.data) {
                evaluations.set(product.id, scoreResult.data);
                stats.totalDeepScored++;
                // Report progress on every scored product
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
      }
    );

    let validationData: { isValid: boolean; confidence: number; issues: string[] } | undefined;
    if (validationResult.success && validationResult.data) {
      validationData = {
        isValid: validationResult.data.isValid,
        confidence: validationResult.data.confidence,
        issues: validationResult.data.issues,
      };
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
      designProfile: ctx.designProfile,
      diagnosis: ctx.diagnosis,
      designDirection: ctx.designDirection,
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

      // Generate candidate bundles: default (top-1 each) + 2 alternatives
      const combos: CandidateProduct[][] = [];

      // Combo 0: top-1 from each category (baseline)
      combos.push(topByCategory.map((cats) => cats[0]));

      // Combo 1: swap in #2 from the category with the weakest top pick
      if (topByCategory.some((cats) => cats.length >= 2)) {
        const baseline = topByCategory.map((cats) => cats[0]);
        let weakestIdx = 0;
        let weakestScore = Infinity;
        for (let i = 0; i < baseline.length; i++) {
          const score = evaluations.get(baseline[i].id)?.final_item_score || 0;
          if (score < weakestScore && topByCategory[i].length >= 2) {
            weakestScore = score;
            weakestIdx = i;
          }
        }
        if (topByCategory[weakestIdx].length >= 2) {
          const alt = [...baseline];
          alt[weakestIdx] = topByCategory[weakestIdx][1];
          combos.push(alt);
        }
      }

      // Combo 2: swap in #2 from the category with the strongest top pick (diversity)
      if (topByCategory.some((cats) => cats.length >= 2)) {
        const baseline = topByCategory.map((cats) => cats[0]);
        let strongestIdx = 0;
        let strongestScore = -1;
        for (let i = 0; i < baseline.length; i++) {
          const score = evaluations.get(baseline[i].id)?.final_item_score || 0;
          if (score > strongestScore && topByCategory[i].length >= 2) {
            strongestScore = score;
            strongestIdx = i;
          }
        }
        if (topByCategory[strongestIdx].length >= 2 && strongestIdx !== (combos.length > 1 ? combos[1].findIndex((p, i) => p !== combos[0][i]) : -1)) {
          const alt = [...baseline];
          alt[strongestIdx] = topByCategory[strongestIdx][1];
          combos.push(alt);
        }
      }

      // Evaluate all combos, pick the one with the highest bundle score
      const comboResults = await Promise.all(
        combos.map(async (combo) => {
          const result = await evaluateBundle(combo, bundleCtx);
          if (result.success && result.data) {
            return { products: combo, ...result.data };
          }
          return null;
        })
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

    if (weakTiers.length > 0) {
      reportStep({
        step: `Backfilling ${weakTiers.length} weak tier(s)`,
        status: "running",
        data: { weakTiers: weakTiers.map((t) => `${t.category}/${t.tier}`) },
      });

      // Run targeted backfill searches for weak tiers
      const backfillSearchLimit = pLimit(10);
      const backfillPromises = weakTiers.map((wt) =>
        backfillSearchLimit(async () => {
          const backfillQuery = `best ${wt.category} for modern apartment ${TIER_LABELS[wt.tier]} price 2025`;
          const searchResult = await searchProducts(backfillQuery, 10, wt.tier);
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
                designProfile: ctx.designProfile,
                diagnosis: ctx.diagnosis,
                designDirection: ctx.designDirection,
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
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Orchestration failed",
    };
  }
}
