import { anthropicProvider } from "@/lib/ai/anthropic";
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
  roomImageUrls: string[]
): Promise<AgentResult<ProductEvaluationResult>> {
  const model = selectModel("scoring");
  const system = getSystemPrompt();
  const evalPrompt = getProductEvalPrompt(
    roomType,
    product.category || "unknown",
    existingItems,
    budgetMode
  );

  // Build product context
  const productInfo = [
    product.title && `Title: ${product.title}`,
    product.retailer && `Retailer: ${product.retailer}`,
    product.price && `Price: $${product.price}`,
    product.dimensions && `Dimensions: ${JSON.stringify(product.dimensions)}`,
    product.materials?.length && `Materials: ${product.materials.join(", ")}`,
    product.colors?.length && `Colors: ${product.colors.join(", ")}`,
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

  content.push({
    type: "text",
    text: `${evalPrompt}\n\n## PRODUCT INFORMATION\n${productInfo}`,
  });

  try {
    const response = await anthropicProvider.chat({
      model,
      system,
      messages: [{ role: "user", content }],
      max_tokens: 2048,
      temperature: 0.2,
    });

    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { success: false, error: "Failed to parse scoring JSON" };
    }

    const parsed = JSON.parse(jsonMatch[0]);
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
