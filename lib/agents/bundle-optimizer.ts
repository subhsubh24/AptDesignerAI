import { geminiProvider } from "@/lib/ai/gemini";
import { selectModel } from "@/lib/ai/models";
import { getSystemPrompt } from "@/lib/prompts/system";
import { getBundleEvalPrompt } from "@/lib/prompts/bundle-eval";
import { computeFinalBundleScore } from "@/lib/scoring/bundle-scorer";
import { BundleEvalResponseSchema } from "@/lib/types/schemas";
import { recordBundleScores } from "@/lib/scoring/drift-monitor";
import { withRetry, isRetryableError } from "@/lib/ai/retry";
import { extractJsonObject } from "@/lib/ai/extract-json";
import { createLogger } from "@/lib/logging/logger";
import type { AIContentBlock } from "@/lib/ai/provider";
import type { AgentResult } from "./types";
import type { BundleEvaluationResult } from "@/lib/types/scoring";
import type { CandidateProduct, DiagnosisData, DesignDirection } from "@/lib/types/database";
import type { DynamicDesignProfile } from "@/lib/design-context/user-profile";
import { computeBundleMathScores, formatBundleMathForPrompt } from "@/lib/validation/bundle-math";

const log = createLogger("bundle-optimizer");

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

  // Compute deterministic math scores for the bundle
  const bundleMathScores = computeBundleMathScores(
    products.map(p => ({
      title: p.title || undefined,
      category: p.category || undefined,
      price: p.price || undefined,
      materials: p.materials || undefined,
      colors: p.colors || undefined,
      dimensions: p.dimensions || undefined,
    })),
    {
      roomType: bundleCtx.roomType,
      recommendedPalette: bundleCtx.designDirection?.recommended_palette,
      recommendedMaterials: bundleCtx.designDirection?.recommended_materials,
      floorPlan: bundleCtx.floorPlan,
      placementMap: bundleCtx.placementMap,
      existingItems: bundleCtx.existingItems,
    }
  );
  const bundleMathSection = formatBundleMathForPrompt(bundleMathScores);

  content.push({
    type: "text",
    text: `${bundlePrompt}\n\n${bundleMathSection}\n\n## BUNDLE ITEMS\n${bundleInfo}\n\n**IMPORTANT**: Study ALL product images carefully. Evaluate whether these items visually work together as a cohesive set based on what you SEE — real colors, textures, proportions, and style.`,
  });

  let lastError: string | undefined;
  let attempt = 0;

  try {
    return await withRetry(
      async () => {
        attempt++;
        const retryContent = attempt > 1 && lastError
          ? [...content, { type: "text" as const, text: `\n\n**IMPORTANT**: Your previous response was invalid: "${lastError}". Return ONLY valid JSON matching the exact schema above. All score fields must be numbers 0-10.` }]
          : content;

        const response = await geminiProvider.chat({
          model,
          system,
          messages: [{ role: "user", content: retryContent }],
          max_tokens: 10000,
          temperature: attempt === 1 ? 0.2 : 0.35,
          responseMimeType: "application/json",
          thinkingConfig: { thinkingLevel: "high" },
        });

        const raw = extractJsonObject(response.content);
        const validated = BundleEvalResponseSchema.parse(raw);
        const scores = validated.scores;

        // Apply math veto: cap AI bundle dimension scores where math found violations
        if (bundleMathScores.palette_harmony < 0.6 && scores.palette_harmony_score > 6) {
          log.info(`Math capping palette_harmony: AI=${scores.palette_harmony_score} → ${Math.round(bundleMathScores.palette_harmony * 10)}`);
          scores.palette_harmony_score = Math.round(bundleMathScores.palette_harmony * 10);
        }
        if (bundleMathScores.material_balance < 0.6 && scores.material_balance_score > 6) {
          log.info(`Math capping material_balance: AI=${scores.material_balance_score} → ${Math.round(bundleMathScores.material_balance * 10)}`);
          scores.material_balance_score = Math.round(bundleMathScores.material_balance * 10);
        }
        if (bundleMathScores.scale_balance < 0.6 && scores.scale_balance_score > 6) {
          log.info(`Math capping scale_balance: AI=${scores.scale_balance_score} → ${Math.round(bundleMathScores.scale_balance * 10)}`);
          scores.scale_balance_score = Math.round(bundleMathScores.scale_balance * 10);
        }
        if (bundleMathScores.spatial_feasibility < 0.6 && scores.spatial_arrangement_score !== undefined && scores.spatial_arrangement_score > 6) {
          log.info(`Math capping spatial_arrangement: AI=${scores.spatial_arrangement_score} → ${Math.round(bundleMathScores.spatial_feasibility * 10)}`);
          scores.spatial_arrangement_score = Math.round(bundleMathScores.spatial_feasibility * 10);
        }
        if (bundleMathScores.completeness < 0.6 && scores.room_completion_score > 6) {
          log.info(`Math capping room_completion: AI=${scores.room_completion_score} → ${Math.round(bundleMathScores.completeness * 10)}`);
          scores.room_completion_score = Math.round(bundleMathScores.completeness * 10);
        }

        const finalScore = computeFinalBundleScore(scores);

        // Record scores for drift monitoring
        recordBundleScores(scores as unknown as Record<string, number>);

        const totalTokens = response.usage.input_tokens + response.usage.output_tokens + response.usage.thinking_tokens;
        log.info("Bundle evaluated", {
          model: response.model,
          tokens: { total: totalTokens },
          finalScore,
        });

        return {
          success: true as const,
          data: {
            scores,
            final_bundle_score: finalScore,
            verdict: validated.verdict,
            analysis: validated.analysis,
            room_vibe: validated.room_vibe,
          },
          tokensUsed: totalTokens,
          model: response.model,
        };
      },
      {
        maxAttempts: 3,
        baseDelayMs: 1500,
        maxDelayMs: 10000,
        isRetryable: (error) => {
          if (isRetryableError(error)) return true;
          if (error instanceof SyntaxError) return true;
          if (error instanceof Error && error.name === "ZodError") return true;
          return false;
        },
        onRetry: (retryAttempt, delayMs, error) => {
          lastError = error instanceof Error ? error.message : "Bundle evaluation failed";
          log.warn(`Retry ${retryAttempt}`, { durationMs: delayMs, error: lastError });
        },
      }
    );
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Bundle evaluation failed after retries";
    log.error("Bundle evaluation failed", { error: errMsg });
    return { success: false, error: errMsg };
  }
}
