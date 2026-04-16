/**
 * Maximal Marginal Relevance (MMR) re-ranking for product diversity.
 *
 * After scoring and pairwise re-ranking, the top-k products per category can
 * be redundant (same retailer, same material, same color). MMR selects a
 * diverse subset by iteratively picking the product that maximizes:
 *
 *   MMR(d) = λ × relevance(d) - (1 - λ) × max_sim(d, already_selected)
 *
 * This is the standard IR diversity technique (Carbonell & Goldstein 1998).
 * It's deterministic, O(k × n), and adds zero LLM calls.
 */
import { createLogger } from "@/lib/logging/logger";
import type { CandidateProduct } from "@/lib/types/database";
import type { ProductEvaluationResult } from "@/lib/types/scoring";

const log = createLogger("mmr-reranker");

/** Default λ: 0.7 favors relevance over diversity (0.5 = equal weight) */
const DEFAULT_LAMBDA = 0.7;

/**
 * Select top-k diverse products using MMR.
 *
 * @param products     Pre-ranked products for one category (best first)
 * @param evaluations  Map of product.id → evaluation result (for relevance scores)
 * @param k            Number of products to select
 * @param lambda       Relevance vs diversity tradeoff (0 = max diversity, 1 = pure relevance)
 * @returns            k products ordered by MMR selection order
 */
export function selectByMMR(
  products: CandidateProduct[],
  evaluations: Map<string, ProductEvaluationResult>,
  k: number = 5,
  lambda: number = DEFAULT_LAMBDA
): CandidateProduct[] {
  if (products.length === 0) return products;
  // Even when products.length <= k, we still run MMR so the output order is
  // consistent with the relevance+diversity tradeoff callers expect.

  // Effective k — cannot select more than we have
  const targetK = Math.min(k, products.length);

  // Normalize relevance scores to [0, 1] for the MMR formula
  const scores = products.map((p) => evaluations.get(p.id)?.final_item_score || 0);
  const maxScore = Math.max(...scores, 0.01);
  const minScore = Math.min(...scores);
  const range = maxScore - minScore || 1;
  const normScores = scores.map((s) => (s - minScore) / range);

  const selected: CandidateProduct[] = [];
  const selectedIndices = new Set<number>();

  // First pick: highest relevance
  let bestIdx = 0;
  for (let i = 1; i < normScores.length; i++) {
    if (normScores[i] > normScores[bestIdx]) bestIdx = i;
  }
  selected.push(products[bestIdx]);
  selectedIndices.add(bestIdx);

  // Subsequent picks: maximize MMR
  while (selected.length < targetK) {
    let bestMMR = -Infinity;
    let bestCandidate = -1;

    for (let i = 0; i < products.length; i++) {
      if (selectedIndices.has(i)) continue;

      const relevance = normScores[i];
      const maxSim = Math.max(
        ...selected.map((sel) => productSimilarity(products[i], sel))
      );
      const mmr = lambda * relevance - (1 - lambda) * maxSim;

      if (mmr > bestMMR) {
        bestMMR = mmr;
        bestCandidate = i;
      }
    }

    if (bestCandidate === -1) break;
    selected.push(products[bestCandidate]);
    selectedIndices.add(bestCandidate);
  }

  log.info(`MMR selected ${selected.length} from ${products.length} products`, {
    category: products[0]?.category ?? undefined,
    uniqueRetailers: new Set(selected.map((p) => p.retailer)).size,
    uniqueMaterials: new Set(selected.flatMap((p) => p.materials || [])).size,
  });

  return selected;
}

/**
 * Compute similarity between two products in [0, 1].
 * Higher = more redundant = should be penalized by MMR.
 *
 * Similarity is a weighted combination of:
 * - Retailer match (30%): same retailer → visually similar catalog
 * - Material overlap (30%): Jaccard similarity of materials
 * - Color overlap (20%): Jaccard similarity of colors
 * - Price proximity (20%): 1 - |Δprice| / max_price
 */
export function productSimilarity(a: CandidateProduct, b: CandidateProduct): number {
  // Retailer similarity
  const retailerSim = (a.retailer && b.retailer && a.retailer.toLowerCase() === b.retailer.toLowerCase()) ? 1.0 : 0.0;

  // Material Jaccard
  const matA = new Set((a.materials || []).map((m) => m.toLowerCase()));
  const matB = new Set((b.materials || []).map((m) => m.toLowerCase()));
  const materialSim = jaccardSimilarity(matA, matB);

  // Color Jaccard
  const colA = new Set((a.colors || []).map((c) => c.toLowerCase()));
  const colB = new Set((b.colors || []).map((c) => c.toLowerCase()));
  const colorSim = jaccardSimilarity(colA, colB);

  // Price proximity
  const pA = a.price || 0;
  const pB = b.price || 0;
  const maxP = Math.max(pA, pB, 1);
  const priceSim = 1 - Math.abs(pA - pB) / maxP;

  return 0.3 * retailerSim + 0.3 * materialSim + 0.2 * colorSim + 0.2 * priceSim;
}

/** Jaccard similarity for two sets. Returns 0 if both empty. */
function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
