import { geminiProvider } from "@/lib/ai/gemini";
import { selectModel } from "@/lib/ai/models";
import { getSystemPrompt } from "@/lib/prompts/system";
import { getBundleEvalPrompt } from "@/lib/prompts/bundle-eval";
import { computeFinalBundleScore } from "@/lib/scoring/bundle-scorer";
import type { AIContentBlock } from "@/lib/ai/provider";
import type { AgentResult } from "./types";
import type { BundleEvaluationResult } from "@/lib/types/scoring";
import type { CandidateProduct, DiagnosisData, DesignDirection } from "@/lib/types/database";
import type { DynamicDesignProfile } from "@/lib/design-context/user-profile";

export interface BundleContext {
  roomType: string;
  roomImageUrls: string[];
  priorities?: string[];
  designProfile?: DynamicDesignProfile;
  diagnosis?: DiagnosisData;
  designDirection?: DesignDirection;
}

export async function evaluateBundle(
  products: CandidateProduct[],
  bundleCtx: BundleContext
): Promise<AgentResult<BundleEvaluationResult>> {
  const model = selectModel("bundle");
  const system = getSystemPrompt(bundleCtx.designProfile);
  const bundlePrompt = getBundleEvalPrompt(
    bundleCtx.roomType,
    bundleCtx.priorities,
    bundleCtx.diagnosis,
    bundleCtx.designDirection
  );

  // Build bundle context with visual metadata
  const bundleInfo = products
    .map((p, i) => {
      const meta = p.metadata as Record<string, unknown> | null;
      const vTags = (meta?.visual_style_tags as string[]) || [];
      const variants = (meta?.available_variants as string[]) || [];
      const lines = [
        `${i + 1}. [${p.category}] ${p.title || "Unknown"} - ${p.retailer || "Unknown retailer"} - $${p.price || "?"}`,
        `   Materials: ${p.materials?.join(", ") || "unknown"}`,
        `   Colors: ${p.colors?.join(", ") || "unknown"}`,
        `   Dimensions: ${p.dimensions ? JSON.stringify(p.dimensions) : "unknown"}`,
      ];
      if (vTags.length > 0) lines.push(`   Visual style: ${vTags.join(", ")}`);
      if (variants.length > 0) lines.push(`   Also available in: ${variants.join(", ")}`);
      return lines.join("\n");
    })
    .join("\n\n");

  const content: AIContentBlock[] = [];

  // Add room images
  for (const url of bundleCtx.roomImageUrls.slice(0, 2)) {
    content.push({ type: "image", source: { type: "url", url } });
  }

  // Add product images + lifestyle images
  for (const product of products) {
    if (product.image_url) {
      content.push({ type: "image", source: { type: "url", url: product.image_url } });
    }
    const meta = product.metadata as Record<string, unknown> | null;
    const lifestyleUrl = meta?.lifestyle_image_url as string | undefined;
    if (lifestyleUrl) {
      content.push({ type: "image", source: { type: "url", url: lifestyleUrl } });
    }
  }

  content.push({
    type: "text",
    text: `${bundlePrompt}\n\n## BUNDLE ITEMS\n${bundleInfo}\n\n**IMPORTANT**: Study ALL product images carefully. Evaluate whether these items visually work together as a cohesive set based on what you SEE — real colors, textures, proportions, and style.`,
  });

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await geminiProvider.chat({
        model,
        system,
        messages: [{ role: "user", content }],
        max_tokens: 10000,
        temperature: 0.3,
        responseMimeType: "application/json",
        thinkingConfig: { thinkingLevel: "medium" },
      });

      const parsed = JSON.parse(response.content);
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
        tokensUsed: response.usage.input_tokens + response.usage.output_tokens + response.usage.thinking_tokens,
        model: response.model,
      };
    } catch (error) {
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : "Bundle evaluation failed",
      };
    }
  }

  return { success: false, error: "Bundle evaluation failed after retries" };
}
