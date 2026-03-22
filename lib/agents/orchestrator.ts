import { generateSearchBrief, searchProducts } from "./shopping-researcher";
import { extractFromUrl } from "./product-extractor";
import { scoreProduct } from "./fit-scorer";
import { evaluateBundle } from "./bundle-optimizer";
import { validateProductSet } from "./validation-agent";
import type { AgentContext, AgentResult } from "./types";
import type { CandidateProduct } from "@/lib/types/database";
import type { ProductEvaluationResult } from "@/lib/types/scoring";
import type { PriceTier } from "@/lib/prompts/search-brief";

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
}

const PRICE_TIERS: PriceTier[] = ["budget", "balanced", "high_end"];
const TIER_LABELS: Record<PriceTier, string> = {
  budget: "Budget",
  balanced: "Balanced",
  high_end: "High End",
};

/**
 * Run the full agentic search loop for a room across 3 price tiers.
 * Uses Gemini Google Search + URL Context for search and extraction.
 * Validates results holistically with validation agent.
 *
 * Flow:
 * 1. Generate tiered search brief from diagnosis
 * 2. For each tier × category: search → extract → score (in parallel per category)
 * 3. Keep top 3 per category per tier
 * 4. Validate all products holistically
 * 5. If validation fails, re-search weak items
 * 6. Generate bundle from top balanced products
 */
export async function runAgenticSearch(
  ctx: AgentContext,
  missingCategories: string[],
  onStep?: (step: OrchestrationStep) => void
): Promise<AgentResult<OrchestrationResult>> {
  const steps: OrchestrationStep[] = [];
  const candidatesByCategory: Record<string, CandidateProduct[]> = {};
  const evaluations = new Map<string, ProductEvaluationResult>();

  function reportStep(step: OrchestrationStep) {
    steps.push(step);
    onStep?.(step);
    console.log(`[orchestrator] ${step.status}: ${step.step}`);
  }

  try {
    // Step 1: Generate tiered search brief
    reportStep({ step: "Generating tiered search brief", status: "running" });
    const briefResult = await generateSearchBrief(
      ctx.roomType,
      missingCategories,
      ctx.budgetMode
    );
    if (!briefResult.success || !briefResult.data) {
      reportStep({ step: "Generating tiered search brief", status: "failed" });
      return { success: false, error: "Failed to generate search brief" };
    }
    reportStep({ step: "Generating tiered search brief", status: "completed", data: briefResult.data });

    // Step 2: Search each category across all tiers IN PARALLEL
    const categorySearchPromises = briefResult.data.categories.map(async (categoryBrief) => {
      const category = categoryBrief.category;
      const categoryProducts: CandidateProduct[] = [];

      // Search all 3 tiers in parallel for this category
      const tierPromises = PRICE_TIERS.map(async (tier) => {
        const tierBrief = categoryBrief.tiers[tier];
        if (!tierBrief) return [];

        reportStep({ step: `Searching ${TIER_LABELS[tier]} ${category}`, status: "running" });

        const tierProducts: CandidateProduct[] = [];

        // Use first query per tier
        for (const query of tierBrief.search_queries.slice(0, 1)) {
          const searchResult = await searchProducts(query, 5, tier);
          if (!searchResult.success || !searchResult.data) continue;

          reportStep({
            step: `Searching ${TIER_LABELS[tier]} ${category}`,
            status: "completed",
            data: { count: searchResult.data.length },
          });

          // Filter to likely product pages
          const productCandidates = searchResult.data.filter((c) => {
            const url = c.url.toLowerCase();
            if (url.endsWith(".pdf")) return false;
            if (/\/(collections|category|categories|all-|shop-all|browse)\b/i.test(url)) return false;
            return true;
          });

          // Extract top 2 results per tier
          for (const candidate of productCandidates.slice(0, 2)) {
            reportStep({ step: `Extracting: ${candidate.title}`, status: "running" });
            const extractResult = await extractFromUrl(candidate.url);
            if (extractResult.success && extractResult.data) {
              if (!extractResult.data.title && !extractResult.data.price) {
                reportStep({ step: `Extracting: ${candidate.title}`, status: "failed", data: { reason: "no product data" } });
                continue;
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
                metadata: { price_tier: tier },
                status: "pending",
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              };
              tierProducts.push(product);
              reportStep({ step: `Extracting: ${candidate.title}`, status: "completed" });
            } else {
              reportStep({ step: `Extracting: ${candidate.title}`, status: "failed" });
            }
          }
        }

        return tierProducts;
      });

      const tierResults = await Promise.all(tierPromises);
      for (const products of tierResults) {
        categoryProducts.push(...products);
      }

      // Score all candidates for this category
      for (const product of categoryProducts) {
        reportStep({ step: `Scoring: ${product.title}`, status: "running" });
        const scoreResult = await scoreProduct(
          product,
          ctx.roomType,
          ctx.budgetMode,
          ctx.keepItems,
          ctx.imageUrls
        );
        if (scoreResult.success && scoreResult.data) {
          evaluations.set(product.id, scoreResult.data);
          reportStep({
            step: `Scoring: ${product.title}`,
            status: "completed",
            data: { score: scoreResult.data.final_item_score },
          });
        } else {
          reportStep({ step: `Scoring: ${product.title}`, status: "failed" });
        }
      }

      return { category, products: categoryProducts };
    });

    const categoryResults = await Promise.all(categorySearchPromises);

    // Organize results
    for (const { category, products } of categoryResults) {
      candidatesByCategory[category] = products;

      // Sort and keep top 3 per tier
      const byTier: Record<PriceTier, CandidateProduct[]> = {
        budget: [],
        balanced: [],
        high_end: [],
      };
      for (const product of products) {
        const tier = (product.metadata as { price_tier: PriceTier })?.price_tier || "balanced";
        byTier[tier].push(product);
      }

      const kept: CandidateProduct[] = [];
      for (const tier of PRICE_TIERS) {
        byTier[tier].sort((a, b) => {
          const scoreA = evaluations.get(a.id)?.final_item_score || 0;
          const scoreB = evaluations.get(b.id)?.final_item_score || 0;
          return scoreB - scoreA;
        });
        kept.push(...byTier[tier].slice(0, 3));
      }
      candidatesByCategory[category] = kept;
    }

    // Step 3: Validate all products holistically
    reportStep({ step: "Validating all recommendations", status: "running" });
    const allProducts = Object.values(candidatesByCategory).flat();
    const validationResult = await validateProductSet(
      allProducts.map((p) => ({
        title: p.title || "Unknown",
        category: p.category || "unknown",
        tier: ((p.metadata as { price_tier?: string })?.price_tier) || "balanced",
        materials: p.materials || undefined,
        colors: p.colors || undefined,
        price: p.price || undefined,
        description: p.description || undefined,
      })),
      {
        roomType: ctx.roomType,
        designDirection: "Based on apartment photos and building context",
        existingItems: ctx.keepItems,
      }
    );

    let validationData: { isValid: boolean; confidence: number; issues: string[] } | undefined;
    if (validationResult.success && validationResult.data) {
      validationData = {
        isValid: validationResult.data.isValid,
        confidence: validationResult.data.confidence,
        issues: validationResult.data.issues,
      };
      reportStep({
        step: "Validating all recommendations",
        status: "completed",
        data: validationData,
      });
    } else {
      reportStep({ step: "Validating all recommendations", status: "failed" });
    }

    // Step 4: Generate bundles from top candidates
    reportStep({ step: "Generating bundles", status: "running" });
    const topProducts: CandidateProduct[] = [];
    for (const [, products] of Object.entries(candidatesByCategory)) {
      const balancedProducts = products.filter(
        (p) => (p.metadata as { price_tier: string })?.price_tier === "balanced"
      );
      const sorted = balancedProducts.sort((a, b) => {
        const scoreA = evaluations.get(a.id)?.final_item_score || 0;
        const scoreB = evaluations.get(b.id)?.final_item_score || 0;
        return scoreB - scoreA;
      });
      if (sorted[0]) topProducts.push(sorted[0]);
    }

    let bundleResult = null;
    if (topProducts.length > 0) {
      bundleResult = await evaluateBundle(topProducts, ctx.roomType, ctx.imageUrls);
    }
    reportStep({ step: "Generating bundles", status: "completed", data: bundleResult?.data });

    return {
      success: true,
      data: {
        searchBrief: briefResult.data,
        candidatesByCategory,
        evaluations,
        bundles: bundleResult?.data ? [bundleResult.data] : [],
        steps,
        validation: validationData,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Orchestration failed",
    };
  }
}
