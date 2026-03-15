import { openaiProvider } from "@/lib/ai/openai";
import { selectModel } from "@/lib/ai/models";
import { getSystemPrompt } from "@/lib/prompts/system";
import { getBundleEvalPrompt } from "@/lib/prompts/bundle-eval";
import { computeFinalBundleScore } from "@/lib/scoring/bundle-scorer";
import type { AIContentBlock } from "@/lib/ai/provider";
import type { AgentResult } from "./types";
import type { BundleEvaluationResult } from "@/lib/types/scoring";
import type { CandidateProduct } from "@/lib/types/database";

export async function evaluateBundle(
  products: CandidateProduct[],
  roomType: string,
  roomImageUrls: string[]
): Promise<AgentResult<BundleEvaluationResult>> {
  const model = selectModel("bundle");
  const system = getSystemPrompt();
  const bundlePrompt = getBundleEvalPrompt(roomType);

  // Build bundle context
  const bundleInfo = products
    .map(
      (p, i) =>
        `${i + 1}. [${p.category}] ${p.title || "Unknown"} - ${p.retailer || "Unknown retailer"} - $${p.price || "?"}\n   Materials: ${p.materials?.join(", ") || "unknown"}\n   Colors: ${p.colors?.join(", ") || "unknown"}\n   Dimensions: ${p.dimensions ? JSON.stringify(p.dimensions) : "unknown"}`
    )
    .join("\n\n");

  const content: AIContentBlock[] = [];

  // Add room images
  for (const url of roomImageUrls.slice(0, 2)) {
    content.push({ type: "image", source: { type: "url", url } });
  }

  // Add product images
  for (const product of products) {
    if (product.image_url) {
      content.push({ type: "image", source: { type: "url", url: product.image_url } });
    }
  }

  content.push({
    type: "text",
    text: `${bundlePrompt}\n\n## BUNDLE ITEMS\n${bundleInfo}`,
  });

  try {
    const response = await openaiProvider.chat({
      model,
      system,
      messages: [{ role: "user", content }],
      max_tokens: 4096,
      temperature: 0.3,
    });

    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { success: false, error: "Failed to parse bundle evaluation JSON" };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const scores = parsed.scores;
    const finalScore = computeFinalBundleScore(scores);

    return {
      success: true,
      data: {
        scores,
        final_bundle_score: finalScore,
        verdict: parsed.verdict,
        analysis: parsed.analysis,
      },
      tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
      model: response.model,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Bundle evaluation failed",
    };
  }
}
