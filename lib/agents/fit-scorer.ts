import { geminiProvider } from "@/lib/ai/gemini";
import { selectModel } from "@/lib/ai/models";
import { getSystemPrompt } from "@/lib/prompts/system";
import { getProductEvalPrompt } from "@/lib/prompts/product-eval";
import { computeFinalItemScore, determineVerdict } from "@/lib/scoring/product-scorer";
import type { AIContentBlock } from "@/lib/ai/provider";
import type { AgentResult } from "./types";
import type { ProductEvaluationResult } from "@/lib/types/scoring";
import type { CandidateProduct } from "@/lib/types/database";

export async function scoreProduct(
  product: CandidateProduct,
  roomType: string,
  budgetMode: string,
  existingItems: string[],
  roomImageUrls: string[],
  otherRoomsContext?: string
): Promise<AgentResult<ProductEvaluationResult & { area_fit_note?: string; apartment_fit_note?: string }>> {
  const model = selectModel("scoring");
  const system = getSystemPrompt();
  const evalPrompt = getProductEvalPrompt(
    roomType,
    product.category || "unknown",
    existingItems,
    budgetMode,
    otherRoomsContext
  );

  // Extract visual metadata from product metadata
  const meta = product.metadata as Record<string, unknown> | null;
  const visualTags = (meta?.visual_style_tags as string[]) || [];
  const availableVariants = (meta?.available_variants as string[]) || [];
  const lifestyleImageUrl = meta?.lifestyle_image_url as string | undefined;

  // Build product context
  const productInfo = [
    product.title && `Title: ${product.title}`,
    product.retailer && `Retailer: ${product.retailer}`,
    product.price && `Price: $${product.price}`,
    product.dimensions && `Dimensions: ${JSON.stringify(product.dimensions)}`,
    product.materials?.length && `Materials: ${product.materials.join(", ")}`,
    product.colors?.length && `Colors: ${product.colors.join(", ")}`,
    visualTags.length > 0 && `Visual style (from product images): ${visualTags.join(", ")}`,
    availableVariants.length > 0 && `Other available options: ${availableVariants.join(", ")}`,
    product.description && `Description: ${product.description}`,
  ]
    .filter(Boolean)
    .join("\n");

  const content: AIContentBlock[] = [];

  // Add room images for context
  for (const url of roomImageUrls.slice(0, 2)) {
    content.push({ type: "image", source: { type: "url", url } });
  }

  // Add product image if available
  if (product.image_url) {
    content.push({ type: "image", source: { type: "url", url: product.image_url } });
  }

  // Add lifestyle/room-setting image if available — helps assess scale and style in context
  if (lifestyleImageUrl) {
    content.push({ type: "image", source: { type: "url", url: lifestyleImageUrl } });
  }

  content.push({
    type: "text",
    text: `${evalPrompt}\n\n## PRODUCT INFORMATION\n${productInfo}\n\n**IMPORTANT**: Study the product images carefully. Score based on what you SEE in the images (actual color, texture, proportions, style) — not just the text description. If a lifestyle image is included, use it to assess real-world scale and how the product looks in a room setting.`,
  });

  try {
    const response = await geminiProvider.chat({
      model,
      system,
      messages: [{ role: "user", content }],
      max_tokens: 2048,
      temperature: 0.2,
      responseMimeType: "application/json",
    });

    const parsed = JSON.parse(response.content);
    const scores = parsed.scores;
    const finalScore = computeFinalItemScore(scores);
    const verdict = determineVerdict(finalScore, scores.confidence_score);

    return {
      success: true,
      data: {
        scores,
        final_item_score: finalScore,
        verdict,
        reasoning: parsed.reasoning,
        area_fit_note: parsed.area_fit_note,
        apartment_fit_note: parsed.apartment_fit_note,
      },
      tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
      model: response.model,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Scoring failed",
    };
  }
}

export interface QuickScoreEntry {
  productId: string;
  quickScore: number;
  styleFit: number;
  valueFit: number;
  confidence: number;
}

/**
 * Quick-score a batch of products using Flash model (no images).
 * Returns a simplified 3-dimension score to filter before deep scoring.
 * Batches 5-8 products per call for efficiency.
 */
export async function quickScoreProducts(
  products: CandidateProduct[],
  category: string,
  roomType: string,
  budgetMode: string
): Promise<AgentResult<QuickScoreEntry[]>> {
  if (products.length === 0) {
    return { success: true, data: [] };
  }

  const BATCH_SIZE = 8;
  const batches: CandidateProduct[][] = [];
  for (let i = 0; i < products.length; i += BATCH_SIZE) {
    batches.push(products.slice(i, i + BATCH_SIZE));
  }

  const allScores: QuickScoreEntry[] = [];

  const batchResults = await Promise.all(
    batches.map(async (batch) => {
      const productList = batch
        .map((p, i) => {
          const pMeta = p.metadata as Record<string, unknown> | null;
          const vTags = (pMeta?.visual_style_tags as string[]) || [];
          const info = [
            `[${i}] ${p.title || "Unknown"}`,
            p.retailer && `  Retailer: ${p.retailer}`,
            p.price && `  Price: $${p.price}`,
            p.materials?.length && `  Materials: ${p.materials.join(", ")}`,
            p.colors?.length && `  Colors: ${p.colors.join(", ")}`,
            vTags.length > 0 && `  Visual style: ${vTags.join(", ")}`,
            p.description && `  Description: ${p.description.slice(0, 150)}`,
          ].filter(Boolean).join("\n");
          return info;
        })
        .join("\n\n");

      const prompt = `Quick-score these ${category} products for a ${roomType}. Budget mode: ${budgetMode}.

Design aesthetic: modern warm, walnut/cream/taupe, sophisticated, urban. No boho, no farmhouse, no overly industrial.

## PRODUCTS
${productList}

## SCORING (each 0-10)
- **style_fit**: Does this match the modern warm aesthetic? Penalize wrong styles.
- **value_fit**: Is the price reasonable for what you get? ${budgetMode === "budget" ? "Weight heavily." : "Balance quality and price."}
- **confidence**: How confident are you based on the available information?

Return JSON:
{
  "scores": [
    { "index": number, "style_fit": number, "value_fit": number, "confidence": number }
  ]
}`;

      try {
        const response = await geminiProvider.chat({
          model: selectModel("quick_score"),
          system: "You are a quick product screener for interior design. Score products on style fit and value. Be strict — a 7+ means genuinely good.",
          messages: [{ role: "user", content: prompt }],
          max_tokens: 2048,
          temperature: 0.1,
          responseMimeType: "application/json",
        });

        const parsed = JSON.parse(response.content);
        const entries: QuickScoreEntry[] = [];
        for (const score of parsed.scores || []) {
          if (score.index >= 0 && score.index < batch.length) {
            const avg = (score.style_fit + score.value_fit + score.confidence) / 3;
            entries.push({
              productId: batch[score.index].id,
              quickScore: Math.round(avg * 10) / 10,
              styleFit: score.style_fit,
              valueFit: score.value_fit,
              confidence: score.confidence,
            });
          }
        }
        return entries;
      } catch {
        // On failure, give all products a passing score (fail open)
        return batch.map((p) => ({
          productId: p.id,
          quickScore: 6,
          styleFit: 6,
          valueFit: 6,
          confidence: 5,
        }));
      }
    })
  );

  for (const entries of batchResults) {
    allScores.push(...entries);
  }

  return { success: true, data: allScores };
}
