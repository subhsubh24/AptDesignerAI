import { geminiProvider } from "@/lib/ai/gemini";
import { selectModel } from "@/lib/ai/models";
import { getSystemPrompt } from "@/lib/prompts/system";
import { getBundleEvalPrompt } from "@/lib/prompts/bundle-eval";
import { computeFinalBundleScore } from "@/lib/scoring/bundle-scorer";
import { BundleEvalResponseSchema } from "@/lib/types/schemas";
import { recordBundleScores } from "@/lib/scoring/drift-monitor";
import type { AIContentBlock } from "@/lib/ai/provider";
import type { AgentResult } from "./types";
import type { BundleEvaluationResult } from "@/lib/types/scoring";
import type { CandidateProduct, DiagnosisData, DesignDirection } from "@/lib/types/database";
import type { DynamicDesignProfile } from "@/lib/design-context/user-profile";

export interface BundleContext {
  roomType: string;
  roomImageUrls: string[];
  priorities?: string[];
  existingItems?: string[];
  designProfile?: DynamicDesignProfile;
  diagnosis?: DiagnosisData;
  designDirection?: DesignDirection;
  spatialLayout?: string;
  placementMap?: Record<string, string>;
  floorPlan?: Record<string, unknown>;
  lightingConditions?: string;
  windowDoorPositions?: string;
  outletPositions?: string;
  userContext?: string;
  replaceItems?: string[];
  whatShouldGo?: string[];
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
    bundleCtx.designDirection,
    bundleCtx.spatialLayout,
    bundleCtx.placementMap,
    bundleCtx.floorPlan,
    bundleCtx.lightingConditions,
    bundleCtx.windowDoorPositions,
    bundleCtx.outletPositions,
    bundleCtx.existingItems,
    bundleCtx.userContext,
    bundleCtx.replaceItems,
    bundleCtx.whatShouldGo
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

  let lastError: string | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // On retry: include error context and bump temperature
      const retryContent = attempt > 0 && lastError
        ? [...content, { type: "text" as const, text: `\n\n**IMPORTANT**: Your previous response was invalid: "${lastError}". Return ONLY valid JSON matching the exact schema above. All score fields must be numbers 0-10.` }]
        : content;

      const response = await geminiProvider.chat({
        model,
        system,
        messages: [{ role: "user", content: retryContent }],
        max_tokens: 10000,
        temperature: attempt === 0 ? 0.2 : 0.35,
        responseMimeType: "application/json",
        thinkingConfig: { thinkingLevel: "high" },
      });

      const raw = JSON.parse(response.content);
      const validated = BundleEvalResponseSchema.parse(raw);
      const scores = validated.scores;
      const finalScore = computeFinalBundleScore(scores);

      // Record scores for drift monitoring
      recordBundleScores(scores as unknown as Record<string, number>);

      return {
        success: true,
        data: {
          scores,
          final_bundle_score: finalScore,
          verdict: validated.verdict,
          analysis: validated.analysis,
          room_vibe: validated.room_vibe,
        },
        tokensUsed: response.usage.input_tokens + response.usage.output_tokens + response.usage.thinking_tokens,
        model: response.model,
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Bundle evaluation failed";
      if (attempt === 0) {
        console.warn(`[bundle-optimizer] Attempt 1 failed: ${lastError}`);
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      return {
        success: false,
        error: lastError,
      };
    }
  }

  return { success: false, error: "Bundle evaluation failed after retries" };
}
