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

    const searchPromises = searchTasks.map((task) =>
      searchLimit(async () => {
        const result = await searchProducts(task.query, 10, task.tier);
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
            const screenResult = await quickScreenCandidates(candidates, category, tier, requirements);
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
                if (!extractResult.success || !extractResult.data) return;
                if (!extractResult.data.title && !extractResult.data.price) return;

                // Price range filter: skip if price is way outside tier range
                const catBriefForPrice = brief.categories.find((c) => c.category === category);
                const priceRange = catBriefForPrice?.tiers[tier]?.price_range;
                if (priceRange && extractResult.data.price) {
                  if (extractResult.data.price > priceRange.max * 2) return;
                  if (extractResult.data.price < priceRange.min * 0.3) return;
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
            const result = await quickScoreProducts(products, category, ctx.roomType, ctx.budgetMode);
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

    for (const [category, tierResults] of Object.entries(extractedByCategory)) {
      for (const tier of PRICE_TIERS) {
        let products = tierResults[tier];

        // Sort by quick score, keep top 8 per tier (or all if ≤8)
        products.sort((a, b) => {
          const scoreA = quickScoresByProduct.get(a.id) || 0;
          const scoreB = quickScoresByProduct.get(b.id) || 0;
          return scoreB - scoreA;
        });

        // Keep top 8 or those with quickScore >= 6, whichever is more
        const passThreshold = products.filter((p) => (quickScoresByProduct.get(p.id) || 0) >= 6);
        const topN = products.slice(0, 8);
        const toScore = passThreshold.length > topN.length ? passThreshold.slice(0, 12) : topN;

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

    // Generate bundles for each tier
    reportStep({ step: "Generating bundles", status: "running" });
    const bundles: unknown[] = [];

    const bundlePromises = PRICE_TIERS.map(async (tier) => {
      const tierProducts: CandidateProduct[] = [];
      for (const products of Object.values(candidatesByCategory)) {
        const tierFiltered = products.filter(
          (p) => (p.metadata as { price_tier: string })?.price_tier === tier
        );
        tierFiltered.sort((a, b) => {
          const scoreA = evaluations.get(a.id)?.final_item_score || 0;
          const scoreB = evaluations.get(b.id)?.final_item_score || 0;
          return scoreB - scoreA;
        });
        if (tierFiltered[0]) tierProducts.push(tierFiltered[0]);
      }

      if (tierProducts.length > 0) {
        const bundleResult = await evaluateBundle(tierProducts, {
                roomType: ctx.roomType,
                roomImageUrls: ctx.imageUrls,
                priorities: ctx.priorities,
                designProfile: ctx.designProfile,
                diagnosis: ctx.diagnosis,
                designDirection: ctx.designDirection,
              });
        if (bundleResult.success && bundleResult.data) {
          return { tier, ...bundleResult.data };
        }
      }
      return null;
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
