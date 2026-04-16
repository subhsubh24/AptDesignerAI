import { geminiProvider } from "@/lib/ai/gemini";
import { selectModel } from "@/lib/ai/models";
import { getSystemPrompt } from "@/lib/prompts/system";
import {
  getBundleScoringPrompt,
  getBundlePairwisePrompt,
  getBundleVibePrompt,
  type BundleEvalContextArgs,
} from "@/lib/prompts/bundle-eval";
import { computeFinalBundleScore } from "@/lib/scoring/bundle-scorer";
import {
  BundleScoringResponseSchema,
  BundlePairwiseResponseSchema,
  BundleVibeResponseSchema,
} from "@/lib/types/schemas";
import { recordBundleScores } from "@/lib/scoring/drift-monitor";
import { withRetry, isRetryableError } from "@/lib/ai/retry";
import { DETERMINISTIC_SEED } from "@/lib/ai/determinism";
import { extractJsonObject } from "@/lib/ai/extract-json";
import { createLogger } from "@/lib/logging/logger";
import type { AIContentBlock } from "@/lib/ai/provider";
import type { AgentResult } from "./types";
import type { BundleEvaluationResult } from "@/lib/types/scoring";
import type { CandidateProduct, DiagnosisData, DesignDirection, ExtractedFloorPlan } from "@/lib/types/database";
import type { DynamicDesignProfile } from "@/lib/design-context/user-profile";
import { MATH_VETO } from "@/lib/config/pipeline";
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
  /** Structured floor plan extracted via vision model — preferred over legacy floorPlan */
  extractedFloorPlan?: ExtractedFloorPlan;
  lightingConditions?: string;
  windowDoorPositions?: string;
  outletPositions?: string;
  userContext?: string;
  replaceItems?: string[];
  whatShouldGo?: string[];
  identifiedContext?: string;
}

/**
 * Evaluate a bundle via three focused calls:
 *   A (scoring):  7 dimension scores + verdict + analysis
 *   B (pairwise): O(n²) pairwise conflicts between products
 *   C (vibe):     room_vibe narrative (depends on A's verdict for tone)
 *
 * A and B run in parallel (independent); C runs after A. Each pass has a
 * focused budget so no single job crowds out another within a token ceiling.
 * Math veto applied to Call A scores.
 */
export async function evaluateBundle(
  products: CandidateProduct[],
  bundleCtx: BundleContext
): Promise<AgentResult<BundleEvaluationResult>> {
  const model = selectModel("bundle");
  const system = getSystemPrompt(bundleCtx.designProfile);

  const evalCtx: BundleEvalContextArgs = {
    roomType: bundleCtx.roomType,
    priorities: bundleCtx.priorities,
    diagnosis: bundleCtx.diagnosis,
    designDirection: bundleCtx.designDirection,
    spatialLayout: bundleCtx.spatialLayout,
    placementMap: bundleCtx.placementMap,
    floorPlan: bundleCtx.floorPlan,
    extractedFloorPlan: bundleCtx.extractedFloorPlan,
    lightingConditions: bundleCtx.lightingConditions,
    windowDoorPositions: bundleCtx.windowDoorPositions,
    outletPositions: bundleCtx.outletPositions,
    existingItems: bundleCtx.existingItems,
    userContext: bundleCtx.userContext,
    replaceItems: bundleCtx.replaceItems,
    whatShouldGo: bundleCtx.whatShouldGo,
    identifiedContext: bundleCtx.identifiedContext,
  };

  // Build bundle product description (shared across all three calls)
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

  // Shared image context for all three calls
  const sharedImages: AIContentBlock[] = [];
  for (const url of bundleCtx.roomImageUrls.slice(0, 2)) {
    sharedImages.push({ type: "image", source: { type: "url", url } });
  }
  for (const product of products) {
    if (product.image_url) {
      sharedImages.push({ type: "image", source: { type: "url", url: product.image_url } });
    }
    const meta = product.metadata as Record<string, unknown> | null;
    const lifestyleUrl = meta?.lifestyle_image_url as string | undefined;
    if (lifestyleUrl) {
      sharedImages.push({ type: "image", source: { type: "url", url: lifestyleUrl } });
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
  const productTail = `\n\n${bundleMathSection}\n\n## BUNDLE ITEMS\n${bundleInfo}\n\n**IMPORTANT**: Study ALL product images carefully. Evaluate based on what you SEE — real colors, textures, proportions, and style.`;

  // Generic single-pass runner with retry
  const runPass = async <T>(
    passName: "scoring" | "pairwise" | "vibe",
    promptText: string,
    maxTokens: number,
    parse: (raw: unknown) => T,
  ): Promise<{ data: T; tokens: number; model: string }> => {
    let lastError: string | undefined;
    let attempt = 0;
    return await withRetry(
      async () => {
        attempt++;
        const baseContent: AIContentBlock[] = [
          ...sharedImages,
          { type: "text" as const, text: `${promptText}${productTail}` },
        ];
        const retryContent = attempt > 1 && lastError
          ? [...baseContent, { type: "text" as const, text: `\n\n**IMPORTANT**: Your previous response was invalid: "${lastError}". Return ONLY valid JSON matching the exact schema above.` }]
          : baseContent;

        const response = await geminiProvider.chat({
          model,
          system,
          messages: [{ role: "user", content: retryContent }],
          max_tokens: maxTokens,
          seed: DETERMINISTIC_SEED,
          responseMimeType: "application/json",
          thinkingConfig: { thinkingLevel: "high" },
        });

        const raw = extractJsonObject(response.content);
        const data = parse(raw);
        const tokens = response.usage.input_tokens + response.usage.output_tokens + response.usage.thinking_tokens;
        return { data, tokens, model: response.model };
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
          lastError = error instanceof Error ? error.message : `Bundle ${passName} failed`;
          log.warn(`Retry ${retryAttempt} for bundle ${passName} pass`, { durationMs: delayMs, error: lastError });
        },
      }
    );
  };

  try {
    // Calls A + B run in parallel; C runs after A (vibe tone uses A's verdict).
    const [scoringRes, pairwiseRes] = await Promise.all([
      runPass("scoring", getBundleScoringPrompt(evalCtx), 5000, (raw) => BundleScoringResponseSchema.parse(raw)),
      runPass("pairwise", getBundlePairwisePrompt(evalCtx), 3000, (raw) => BundlePairwiseResponseSchema.parse(raw)),
    ]);
    const vibeRes = await runPass(
      "vibe",
      getBundleVibePrompt(evalCtx, scoringRes.data.verdict),
      2500,
      (raw) => BundleVibeResponseSchema.parse(raw),
    );

    const scores = scoringRes.data.scores;

    // Apply math veto: cap AI bundle dimension scores where math found violations
    const VETO_T = MATH_VETO.threshold;
    if (bundleMathScores.palette_harmony < VETO_T && scores.palette_harmony_score > VETO_T * 10) {
      log.info(`Math capping palette_harmony: AI=${scores.palette_harmony_score} → ${Math.round(bundleMathScores.palette_harmony * 10)}`);
      scores.palette_harmony_score = Math.round(bundleMathScores.palette_harmony * 10);
    }
    if (bundleMathScores.material_balance < VETO_T && scores.material_balance_score > VETO_T * 10) {
      log.info(`Math capping material_balance: AI=${scores.material_balance_score} → ${Math.round(bundleMathScores.material_balance * 10)}`);
      scores.material_balance_score = Math.round(bundleMathScores.material_balance * 10);
    }
    if (bundleMathScores.scale_balance < VETO_T && scores.scale_balance_score > VETO_T * 10) {
      log.info(`Math capping scale_balance: AI=${scores.scale_balance_score} → ${Math.round(bundleMathScores.scale_balance * 10)}`);
      scores.scale_balance_score = Math.round(bundleMathScores.scale_balance * 10);
    }
    if (bundleMathScores.spatial_feasibility < VETO_T && scores.spatial_arrangement_score !== undefined && scores.spatial_arrangement_score > VETO_T * 10) {
      log.info(`Math capping spatial_arrangement: AI=${scores.spatial_arrangement_score} → ${Math.round(bundleMathScores.spatial_feasibility * 10)}`);
      scores.spatial_arrangement_score = Math.round(bundleMathScores.spatial_feasibility * 10);
    }
    if (bundleMathScores.completeness < VETO_T && scores.room_completion_score > VETO_T * 10) {
      log.info(`Math capping room_completion: AI=${scores.room_completion_score} → ${Math.round(bundleMathScores.completeness * 10)}`);
      scores.room_completion_score = Math.round(bundleMathScores.completeness * 10);
    }
    if (bundleMathScores.price_coherence < VETO_T && scores.practicality_score > VETO_T * 10) {
      log.info(`Math capping practicality (price_coherence): AI=${scores.practicality_score} → ${Math.round(bundleMathScores.price_coherence * 10)}`);
      scores.practicality_score = Math.round(bundleMathScores.price_coherence * 10);
    }

    const finalScore = computeFinalBundleScore(scores);

    recordBundleScores({
      ...scores as unknown as Record<string, number>,
      final_bundle_score: finalScore,
    });

    const totalTokens = scoringRes.tokens + pairwiseRes.tokens + vibeRes.tokens;

    if (pairwiseRes.data.pairwise_conflicts.length > 0) {
      log.info("Bundle pairwise conflicts detected", {
        count: pairwiseRes.data.pairwise_conflicts.length,
        conflicts: pairwiseRes.data.pairwise_conflicts.map(c => `${c.product_a} ↔ ${c.product_b}: ${c.compatibility}/10 (${c.conflict_type})`),
      });
    }

    log.info("Bundle evaluated (split pass)", {
      model: scoringRes.model,
      tokens: { total: totalTokens },
      scoringTokens: scoringRes.tokens,
      pairwiseTokens: pairwiseRes.tokens,
      vibeTokens: vibeRes.tokens,
      finalScore,
    });

    return {
      success: true,
      data: {
        scores,
        final_bundle_score: finalScore,
        verdict: scoringRes.data.verdict,
        analysis: scoringRes.data.analysis,
        room_vibe: vibeRes.data.room_vibe,
        pairwise_conflicts: pairwiseRes.data.pairwise_conflicts,
      },
      tokensUsed: totalTokens,
      model: scoringRes.model,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Bundle evaluation failed after retries";
    log.error("Bundle evaluation failed", { error: errMsg });
    return { success: false, error: errMsg };
  }
}
