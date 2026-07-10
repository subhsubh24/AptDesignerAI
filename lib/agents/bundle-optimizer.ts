import { geminiProvider } from "@/lib/ai/gemini";
import { selectModel } from "@/lib/ai/models";
import { getSystemPromptCore } from "@/lib/prompts/system";
import {
  getBundleScoringPrompt,
  getBundleVibePrompt,
  type BundleEvalContextArgs,
} from "@/lib/prompts/bundle-eval";
import { computeFinalBundleScore } from "@/lib/scoring/bundle-scorer";
import {
  BundleScoringResponseSchema,
  BundleVibeResponseSchema,
} from "@/lib/types/schemas";
import { recordBundleScores } from "@/lib/scoring/drift-monitor";
import { withRetry, isRetryableError } from "@/lib/ai/retry";
import { DETERMINISTIC_SEED } from "@/lib/ai/determinism";
import { extractJsonObject } from "@/lib/ai/extract-json";
import { createLogger } from "@/lib/logging/logger";
import { isGeminiCompatibleImageUrl } from "@/lib/ai/image-mime";
import type { AIContentBlock } from "@/lib/ai/provider";
import type { AgentResult } from "./types";
import type { BundleEvaluationResult } from "@/lib/types/scoring";
import type { CandidateProduct, DiagnosisData, DesignDirection, ExtractedFloorPlan } from "@/lib/types/database";
import type { DynamicDesignProfile } from "@/lib/design-context/user-profile";
import { MATH_VETO } from "@/lib/config/pipeline";
import { computeBundleMathScores, formatBundleMathForPrompt } from "@/lib/validation/bundle-math";

const log = createLogger("bundle-optimizer");

// Process-memory cache for bundle vibe narratives. Same sorted product-id set
// + verdict + room-image key → same vibe output, so we skip a 20-60K token
// call on duplicate evaluations (common during backfill re-eval on unchanged
// combos and during manual-path re-visits within the same process).
type VibePayload = NonNullable<Awaited<ReturnType<typeof generateBundleVibe>>["data"]>;
const VIBE_CACHE_MAX = 200;
const vibeCache = new Map<string, VibePayload>();
function vibeCacheKey(
  products: CandidateProduct[],
  bundleCtx: BundleContext,
  verdict: string,
): string {
  const ids = products.map((p) => p.id).sort().join("|");
  const images = [...bundleCtx.roomImageUrls].sort().slice(0, 2).join("|");
  return `${bundleCtx.roomType}::${ids}::${verdict}::${images}`;
}

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
 * Deterministic pre-filter that drops obviously bad combos BEFORE the 15K-token
 * LLM evaluation call. Three cheap signals:
 *   1. Math overall score (palette + material + scale + spatial + completeness + price)
 *   2. Same-retailer dominance (one retailer contributing > maxSameRetailerRatio)
 *   3. Wood-species or warm/cool-metal clashes (already inside material_balance)
 *
 * The filter is *permissive*: we always keep at least `minKept` combos (sorted
 * by math.overall desc) so that even a noisy catalog still produces a winner.
 * Target: drop 50–70% of the 27 combos, saving ~400–500K tokens per tier.
 */
export interface BundlePrefilterResult {
  kept: CandidateProduct[][];
  dropped: number;
  reasons: Record<string, number>;
}

// Deterministic tiebreaker for combo ranking: two combos with an identical
// math.overall must sort in a stable order. Without it, Array.sort leaves
// equal-score combos in input order — which depends on upstream async
// completion order — so the top-N kept set (and thus the chosen bundle) can
// differ run-to-run, violating the determinism contract. Key by the combo's
// sorted product ids (stable + unique), mirroring vibeCacheKey above.
function comboTiebreak(a: CandidateProduct[], b: CandidateProduct[]): number {
  const ak = a.map((p) => p.id).sort().join("|");
  const bk = b.map((p) => p.id).sort().join("|");
  return ak.localeCompare(bk);
}

export function prefilterBundleCombos(
  combos: CandidateProduct[][],
  bundleCtx: BundleContext,
  opts: { minKept?: number; mathFloor?: number; maxSameRetailerRatio?: number } = {},
): BundlePrefilterResult {
  const minKept = opts.minKept ?? 6;
  const mathFloor = opts.mathFloor ?? 0.45;
  const maxSameRetailerRatio = opts.maxSameRetailerRatio ?? 0.75;

  if (combos.length <= minKept) {
    return { kept: combos, dropped: 0, reasons: {} };
  }

  const scored = combos.map((combo) => {
    const math = computeBundleMathScores(
      combo.map((p) => ({
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
      },
    );

    // Retailer dominance check
    const retailerCounts = new Map<string, number>();
    for (const p of combo) {
      const r = (p.retailer || "unknown").toLowerCase();
      retailerCounts.set(r, (retailerCounts.get(r) || 0) + 1);
    }
    const topRetailerCount = Math.max(...retailerCounts.values(), 0);
    const retailerDominance = combo.length > 0 ? topRetailerCount / combo.length : 0;

    return { combo, math, retailerDominance };
  });

  const reasons: Record<string, number> = {};
  const surviving: typeof scored = [];
  for (const s of scored) {
    if (s.math.overall < mathFloor) {
      reasons.math_floor = (reasons.math_floor || 0) + 1;
      continue;
    }
    if (s.retailerDominance > maxSameRetailerRatio && s.combo.length >= 3) {
      reasons.retailer_dominance = (reasons.retailer_dominance || 0) + 1;
      continue;
    }
    surviving.push(s);
  }

  // Sort by math.overall desc (stable tiebreak on combo id) so the best combos survive
  surviving.sort((a, b) => (b.math.overall - a.math.overall) || comboTiebreak(a.combo, b.combo));

  // Guarantee minKept: if filter was too aggressive, fall back to top-N by math.overall
  if (surviving.length < minKept) {
    scored.sort((a, b) => (b.math.overall - a.math.overall) || comboTiebreak(a.combo, b.combo));
    return {
      kept: scored.slice(0, Math.min(combos.length, Math.max(minKept, surviving.length))).map((s) => s.combo),
      dropped: combos.length - Math.min(combos.length, Math.max(minKept, surviving.length)),
      reasons: { fallback_topN: 1 },
    };
  }

  return {
    kept: surviving.map((s) => s.combo),
    dropped: combos.length - surviving.length,
    reasons,
  };
}

/**
 * Evaluate a bundle via two focused calls:
 *   A (scoring): 7 dimension scores + verdict + analysis
 *   B (vibe):    room_vibe narrative (depends on A's verdict for tone)
 *
 * B runs after A. Math veto applied to Call A scores. Pairwise-conflict
 * output was removed — it was never consumed downstream.
 */
export interface EvaluateBundleOptions {
  /**
   * Skip the room-vibe pass. The vibe call produces a narrative block that
   * doesn't feed into `final_bundle_score`, so scoring-only callers (e.g.
   * ranking 20+ combos to pick a winner) can turn it off to save tokens.
   * Run vibe separately on just the winning combo via `generateBundleVibe`.
   */
  skipVibe?: boolean;
}

export async function evaluateBundle(
  products: CandidateProduct[],
  bundleCtx: BundleContext,
  options: EvaluateBundleOptions = {}
): Promise<AgentResult<BundleEvaluationResult>> {
  const model = selectModel("bundle");
  const system = getSystemPromptCore(bundleCtx.designProfile);

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
    if (product.image_url && isGeminiCompatibleImageUrl(product.image_url)) {
      sharedImages.push({ type: "image", source: { type: "url", url: product.image_url } });
    }
    // Lifestyle images omitted from bundle evaluation — product images
    // are sufficient for style/color/material comparison, and each
    // lifestyle image adds ~2500 tokens across 81+ bundle calls.
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
          thinkingConfig: { thinkingLevel: "low" },
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
    const scoringRes = await runPass("scoring", getBundleScoringPrompt(evalCtx), 64000, (raw) => BundleScoringResponseSchema.parse(raw));
    const vibeRes = options.skipVibe
      ? null
      : await runPass(
          "vibe",
          getBundleVibePrompt(evalCtx, scoringRes.data.verdict),
          64000,
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

    const totalTokens = scoringRes.tokens + (vibeRes?.tokens ?? 0);

    log.info("Bundle evaluated (split pass)", {
      model: scoringRes.model,
      tokens: { total: totalTokens },
      scoringTokens: scoringRes.tokens,
      vibeTokens: vibeRes?.tokens ?? 0,
      vibeSkipped: !!options.skipVibe,
      finalScore,
    });

    return {
      success: true,
      data: {
        scores,
        final_bundle_score: finalScore,
        verdict: scoringRes.data.verdict,
        analysis: scoringRes.data.analysis,
        room_vibe: vibeRes?.data.room_vibe,
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

/**
 * Generate just the room-vibe narrative for a bundle. Used by callers that
 * evaluate many combos with `skipVibe: true` and then produce the vibe only
 * for the winning combo — keeps the narrative quality without paying vibe
 * tokens on 20+ losing combos.
 */
export async function generateBundleVibe(
  products: CandidateProduct[],
  bundleCtx: BundleContext,
  verdict: string,
): Promise<AgentResult<{ room_vibe: { vibe_summary: string; style_keywords: string[]; color_story: string; mood: string } | undefined }>> {
  const cacheKey = vibeCacheKey(products, bundleCtx, verdict);
  const cached = vibeCache.get(cacheKey);
  if (cached) {
    // LRU bump
    vibeCache.delete(cacheKey);
    vibeCache.set(cacheKey, cached);
    return { success: true, data: cached, tokensUsed: 0 };
  }

  const model = selectModel("bundle");
  const system = getSystemPromptCore(bundleCtx.designProfile);

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

  const bundleInfo = products
    .map((p, i) => {
      const meta = p.metadata as Record<string, unknown> | null;
      const vTags = (meta?.visual_style_tags as string[]) || [];
      const lines = [
        `${i + 1}. [${p.category}] ${p.title || "Unknown"} - ${p.retailer || "Unknown retailer"} - $${p.price || "?"}`,
        `   Materials: ${p.materials?.join(", ") || "unknown"}`,
        `   Colors: ${p.colors?.join(", ") || "unknown"}`,
      ];
      if (vTags.length > 0) lines.push(`   Visual style: ${vTags.join(", ")}`);
      return lines.join("\n");
    })
    .join("\n\n");

  const sharedImages: AIContentBlock[] = [];
  for (const url of bundleCtx.roomImageUrls.slice(0, 2)) {
    sharedImages.push({ type: "image", source: { type: "url", url } });
  }
  for (const product of products) {
    if (product.image_url) {
      sharedImages.push({ type: "image", source: { type: "url", url: product.image_url } });
    }
  }

  const promptText = `${getBundleVibePrompt(evalCtx, verdict)}\n\n## BUNDLE ITEMS\n${bundleInfo}\n\n**IMPORTANT**: Study the images and capture how these items feel together in the actual room.`;

  try {
    let lastError: string | undefined;
    let attempt = 0;
    const res = await withRetry(
      async () => {
        attempt++;
        const content: AIContentBlock[] = [
          ...sharedImages,
          { type: "text", text: promptText },
        ];
        const retryContent = attempt > 1 && lastError
          ? [...content, { type: "text" as const, text: `\n\n**IMPORTANT**: Your previous response was invalid: "${lastError}". Return ONLY valid JSON.` }]
          : content;
        const response = await geminiProvider.chat({
          model,
          system,
          messages: [{ role: "user", content: retryContent }],
          max_tokens: 16000,
          seed: DETERMINISTIC_SEED,
          responseMimeType: "application/json",
          thinkingConfig: { thinkingLevel: "low" },
        });
        const raw = extractJsonObject(response.content);
        const data = BundleVibeResponseSchema.parse(raw);
        const tokens = response.usage.input_tokens + response.usage.output_tokens + response.usage.thinking_tokens;
        return { data, tokens };
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
          lastError = error instanceof Error ? error.message : "Vibe pass failed";
          log.warn(`Retry ${retryAttempt} for standalone vibe pass`, { durationMs: delayMs, error: lastError });
        },
      }
    );
    const payload = { room_vibe: res.data.room_vibe };
    if (vibeCache.size >= VIBE_CACHE_MAX) {
      // Drop oldest entry — Map preserves insertion order.
      const firstKey = vibeCache.keys().next().value;
      if (firstKey !== undefined) vibeCache.delete(firstKey);
    }
    vibeCache.set(cacheKey, payload);
    return {
      success: true,
      data: payload,
      tokensUsed: res.tokens,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Vibe generation failed after retries";
    log.warn("Vibe generation failed (non-fatal)", { error: errMsg });
    return { success: false, error: errMsg };
  }
}
