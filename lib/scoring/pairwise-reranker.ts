/**
 * Pairwise re-ranking for product candidates.
 *
 * After deep scoring, products within a category often cluster in the 6.5–7.5
 * range — the LLM is better at pointwise "rate this" than at making fine
 * distinctions. Pairwise comparison ("which is better, A or B?") exploits the
 * model's comparative strength: it only needs to decide a preference, not
 * assign an absolute number.
 *
 * Implementation: for each category, take top-N deep-scored products, run all
 * C(N,2) pairs through the LLM in batched calls, count wins per product, and
 * re-rank by win count (tie-break: original deep score).
 */
import { getProvider } from "@/lib/ai/provider-factory";
import { selectModel } from "@/lib/ai/models";
import { DETERMINISTIC_SEED } from "@/lib/ai/determinism";
import { extractJsonObject } from "@/lib/ai/extract-json";
import { createLogger } from "@/lib/logging/logger";
import type { CandidateProduct } from "@/lib/types/database";
import type { ProductEvaluationResult } from "@/lib/types/scoring";

const log = createLogger("pairwise-reranker");

/** Maximum products per category to include in pairwise comparison */
const MAX_CANDIDATES = 8;

/** Maximum pairs per LLM call (keeps prompts focused) */
const PAIRS_PER_BATCH = 6;

export interface PairwiseContext {
  roomType: string;
  category: string;
  designDirection?: string;
  palette?: string[];
  existingItems?: string[];
}

interface PairResult {
  pair_index: number;
  winner: "A" | "B";
  confidence: number; // 1-5, 5 = obvious choice
  reason: string;
}

/**
 * Re-rank products within a single category using pairwise LLM comparisons.
 *
 * @param products    Deep-scored products for one category (already sorted by score)
 * @param evaluations Map of product.id → evaluation result
 * @param ctx         Room/category context for the comparison prompt
 * @returns           Products re-ordered by pairwise win count, then deep score
 */
export async function pairwiseRerank(
  products: CandidateProduct[],
  evaluations: Map<string, ProductEvaluationResult>,
  ctx: PairwiseContext
): Promise<CandidateProduct[]> {
  // Not enough products to benefit from pairwise comparison
  if (products.length <= 2) return products;

  const candidates = products.slice(0, MAX_CANDIDATES);
  const pairs = generatePairs(candidates);

  if (pairs.length === 0) return products;

  log.info(`Pairwise re-ranking ${candidates.length} products for ${ctx.category}`, {
    pairs: pairs.length,
  });

  // Batch pairs into manageable chunks
  const batches: Array<[number, CandidateProduct, CandidateProduct][]> = [];
  for (let i = 0; i < pairs.length; i += PAIRS_PER_BATCH) {
    batches.push(pairs.slice(i, i + PAIRS_PER_BATCH));
  }

  // Run batches in parallel
  const winCounts = new Map<string, number>();
  for (const c of candidates) winCounts.set(c.id, 0);

  const batchResults = await Promise.all(
    batches.map((batch) => runPairwiseBatch(batch, candidates, evaluations, ctx))
  );

  for (const results of batchResults) {
    for (const result of results) {
      const [, productA, productB] = pairs[result.pair_index];
      const winner = result.winner === "A" ? productA : productB;
      winCounts.set(winner.id, (winCounts.get(winner.id) || 0) + 1);
    }
  }

  // Sort by win count descending, then original deep score, then a stable id
  // tiebreak so equal wins + equal score never depend on input/Map ordering
  // (determinism contract — matches tiebreakProduct() used elsewhere).
  const ranked = [...candidates].sort((a, b) => {
    const winsA = winCounts.get(a.id) || 0;
    const winsB = winCounts.get(b.id) || 0;
    if (winsB !== winsA) return winsB - winsA;
    const scoreA = evaluations.get(a.id)?.final_item_score || 0;
    const scoreB = evaluations.get(b.id)?.final_item_score || 0;
    if (scoreB !== scoreA) return scoreB - scoreA;
    return a.id.localeCompare(b.id);
  });

  // Append any products beyond MAX_CANDIDATES that weren't re-ranked
  const remaining = products.slice(MAX_CANDIDATES);

  log.info(`Pairwise re-ranking complete for ${ctx.category}`, {
    topProduct: ranked[0]?.title?.slice(0, 50),
    topWins: winCounts.get(ranked[0]?.id || "") || 0,
    totalPairs: pairs.length,
  });

  return [...ranked, ...remaining];
}

/** Generate all C(n,2) pairs with indices for tracking. */
function generatePairs(
  products: CandidateProduct[]
): Array<[number, CandidateProduct, CandidateProduct]> {
  const pairs: Array<[number, CandidateProduct, CandidateProduct]> = [];
  let idx = 0;
  for (let i = 0; i < products.length; i++) {
    for (let j = i + 1; j < products.length; j++) {
      // Randomize position (A vs B) to control position bias.
      // Use a deterministic swap based on product IDs so results are reproducible.
      const swap = (products[i].id + products[j].id).length % 2 === 0;
      if (swap) {
        pairs.push([idx++, products[j], products[i]]);
      } else {
        pairs.push([idx++, products[i], products[j]]);
      }
    }
  }
  return pairs;
}

/** Format a product's key attributes for comparison. */
function formatProductForComparison(
  product: CandidateProduct,
  evaluation: ProductEvaluationResult | undefined
): string {
  const parts = [
    product.title && `Title: ${product.title}`,
    product.retailer && `Retailer: ${product.retailer}`,
    product.price != null && `Price: $${product.price}`,
    product.dimensions && `Dimensions: ${formatDimensions(product.dimensions)}`,
    product.materials?.length && `Materials: ${product.materials.join(", ")}`,
    product.colors?.length && `Colors: ${product.colors.join(", ")}`,
    evaluation && `Deep-score breakdown: style=${evaluation.scores.style_fit_score}, palette=${evaluation.scores.palette_fit_score}, material=${evaluation.scores.material_fit_score}, scale=${evaluation.scores.scale_fit_score}, function=${evaluation.scores.function_fit_score}, cohesion=${evaluation.scores.cohesion_fit_score}, value=${evaluation.scores.value_fit_score}`,
  ].filter(Boolean);
  return parts.join("\n");
}

function formatDimensions(d: { width?: number; depth?: number; height?: number; diameter?: number; unit: string }): string {
  const parts = [];
  if (d.width) parts.push(`W:${d.width}`);
  if (d.depth) parts.push(`D:${d.depth}`);
  if (d.height) parts.push(`H:${d.height}`);
  if (d.diameter) parts.push(`Ø:${d.diameter}`);
  return parts.join("×") + (d.unit === "cm" ? "cm" : '"');
}

/** Run one batch of pairwise comparisons. */
async function runPairwiseBatch(
  batch: Array<[number, CandidateProduct, CandidateProduct]>,
  _candidates: CandidateProduct[],
  evaluations: Map<string, ProductEvaluationResult>,
  ctx: PairwiseContext
): Promise<PairResult[]> {
  const pairsText = batch.map(([idx, a, b]) => {
    const aText = formatProductForComparison(a, evaluations.get(a.id));
    const bText = formatProductForComparison(b, evaluations.get(b.id));
    return `--- PAIR ${idx} ---\nPRODUCT A:\n${aText}\n\nPRODUCT B:\n${bText}`;
  }).join("\n\n");

  const prompt = `You are comparing furniture products for a ${ctx.roomType} (category: ${ctx.category}).
${ctx.designDirection ? `Design direction: ${ctx.designDirection}` : ""}
${ctx.palette?.length ? `Target palette: ${ctx.palette.join(", ")}` : ""}
${ctx.existingItems?.length ? `Existing items to coordinate with: ${ctx.existingItems.join("; ")}` : ""}

For each pair below, decide which product is the BETTER choice for this room. Consider:
- How well it fits the design direction and palette
- Material quality and appropriateness
- Scale/proportion for the room
- Value for money
- How well it coordinates with existing items

${pairsText}

Return a JSON array with one object per pair:
[
  {
    "pair_index": ${batch[0][0]},
    "winner": "A" or "B",
    "confidence": 1-5 (5 = obvious choice, 1 = coin flip),
    "reason": "one sentence why"
  }
]`;

  try {
    const response = await getProvider("quick_score").chat({
      model: selectModel("quick_score"),
      system: "You are a furniture comparison expert. Be decisive — always pick a winner, even if close. Return ONLY valid JSON.",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 8000,
      seed: DETERMINISTIC_SEED,
      responseMimeType: "application/json",
      thinkingConfig: { thinkingLevel: "minimal" },
    });

    const parsed = extractJsonObject<PairResult[]>(response.content);
    if (!Array.isArray(parsed)) {
      log.warn("Pairwise batch returned non-array", { preview: response.content.slice(0, 100) });
      return [];
    }
    return parsed.filter(
      (r) => typeof r.pair_index === "number" && (r.winner === "A" || r.winner === "B")
    );
  } catch (err) {
    log.warn("Pairwise batch failed", { error: err instanceof Error ? err.message : String(err) });
    return [];
  }
}
