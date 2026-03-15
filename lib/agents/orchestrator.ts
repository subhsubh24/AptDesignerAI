import { generateSearchBrief, searchProducts } from "./shopping-researcher";
import { extractFromUrl } from "./product-extractor";
import { scoreProduct } from "./fit-scorer";
import { evaluateBundle } from "./bundle-optimizer";
import type { AgentContext, AgentResult } from "./types";
import type { CandidateProduct } from "@/lib/types/database";
import type { ProductEvaluationResult } from "@/lib/types/scoring";

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
}

/**
 * Run the full agentic search loop for a room.
 *
 * Flow:
 * 1. Generate search brief from diagnosis
 * 2. Search each missing category
 * 3. Extract product data from results
 * 4. Score each candidate
 * 5. Keep top candidates per category
 * 6. Generate 2-3 bundles
 * 7. Score bundles holistically
 *
 * Stopping criteria:
 * - Max 5 search rounds per category
 * - Max 20 candidates per category
 * - Stop if enough high-scoring candidates found (3+ with score >= 6.5)
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
  }

  try {
    // Step 1: Generate search brief
    reportStep({ step: "Generating search brief", status: "running" });
    const briefResult = await generateSearchBrief(
      ctx.roomType,
      missingCategories,
      ctx.budgetMode
    );
    if (!briefResult.success || !briefResult.data) {
      reportStep({ step: "Generating search brief", status: "failed" });
      return { success: false, error: "Failed to generate search brief" };
    }
    reportStep({ step: "Generating search brief", status: "completed", data: briefResult.data });

    // Step 2: Search each category
    for (const categoryBrief of briefResult.data.categories) {
      const category = categoryBrief.category;
      candidatesByCategory[category] = [];

      for (const query of categoryBrief.search_queries.slice(0, 3)) {
        reportStep({ step: `Searching: ${query}`, status: "running" });
        const searchResult = await searchProducts(query, 5);
        if (searchResult.success && searchResult.data) {
          reportStep({ step: `Searching: ${query}`, status: "completed", data: { count: searchResult.data.length } });

          // Step 3: Extract product data from each result
          for (const candidate of searchResult.data.slice(0, 5)) {
            reportStep({ step: `Extracting: ${candidate.title}`, status: "running" });
            const extractResult = await extractFromUrl(candidate.url);
            if (extractResult.success && extractResult.data) {
              const product: CandidateProduct = {
                id: crypto.randomUUID(),
                room_id: ctx.roomId,
                search_session_id: null,
                title: extractResult.data.title,
                category: extractResult.data.category || category,
                retailer: extractResult.data.retailer,
                product_url: candidate.url,
                image_url: extractResult.data.image_url,
                local_image_path: null,
                price: extractResult.data.price,
                dimensions: extractResult.data.dimensions,
                materials: extractResult.data.materials,
                colors: extractResult.data.colors,
                description: extractResult.data.description,
                source_type: "agentic_search",
                metadata: null,
                status: "pending",
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              };
              candidatesByCategory[category].push(product);
              reportStep({ step: `Extracting: ${candidate.title}`, status: "completed" });
            } else {
              reportStep({ step: `Extracting: ${candidate.title}`, status: "failed" });
            }
          }
        } else {
          reportStep({ step: `Searching: ${query}`, status: "failed" });
        }

        // Stopping criteria: enough candidates for this category
        if (candidatesByCategory[category].length >= 10) break;
      }

      // Step 4: Score candidates for this category
      for (const product of candidatesByCategory[category]) {
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
          reportStep({ step: `Scoring: ${product.title}`, status: "completed", data: { score: scoreResult.data.final_item_score } });
        } else {
          reportStep({ step: `Scoring: ${product.title}`, status: "failed" });
        }
      }

      // Keep only top candidates per category (sorted by score)
      candidatesByCategory[category].sort((a, b) => {
        const scoreA = evaluations.get(a.id)?.final_item_score || 0;
        const scoreB = evaluations.get(b.id)?.final_item_score || 0;
        return scoreB - scoreA;
      });
      candidatesByCategory[category] = candidatesByCategory[category].slice(0, 5);
    }

    // Step 5: Generate bundles from top candidates
    reportStep({ step: "Generating bundles", status: "running" });
    const topProducts: CandidateProduct[] = [];
    for (const [, products] of Object.entries(candidatesByCategory)) {
      if (products[0]) topProducts.push(products[0]);
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
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Orchestration failed",
    };
  }
}
