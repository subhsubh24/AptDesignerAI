import { geminiProvider } from "@/lib/ai/gemini";
import { selectModel } from "@/lib/ai/models";
import { getSystemPrompt } from "@/lib/prompts/system";
import {
  getAestheticEvalPrompt,
  getFunctionalEvalPrompt,
  type EvalContextArgs,
} from "@/lib/prompts/product-eval";
import { computeFinalItemScore, determineVerdict } from "@/lib/scoring/product-scorer";
import {
  AestheticEvalResponseSchema,
  FunctionalEvalResponseSchema,
  QuickScoreResponseSchema,
} from "@/lib/types/schemas";
import { zodToGeminiSchema } from "@/lib/ai/schema";
import { recordProductScores } from "@/lib/scoring/drift-monitor";
import { withRetry, isRetryableError } from "@/lib/ai/retry";
import { DETERMINISTIC_SEED } from "@/lib/ai/determinism";
import { extractJsonObject } from "@/lib/ai/extract-json";
import { createLogger } from "@/lib/logging/logger";
import type { AIContentBlock } from "@/lib/ai/provider";
import type { AgentResult } from "./types";
import type { ProductEvaluationResult } from "@/lib/types/scoring";
import type { CandidateProduct, DesignDirection, DiagnosisData } from "@/lib/types/database";
import type { DynamicDesignProfile } from "@/lib/design-context/user-profile";
import { computeProductMathScores, formatProductMathForPrompt, type ProductMathScores } from "@/lib/validation/product-math";
import { resolveLifestyleFlags } from "@/lib/validation/durability-map";

const log = createLogger("fit-scorer");

/** Pre-computed Gemini-compatible schema for quick-score responses. */
const QUICK_SCORE_GEMINI_SCHEMA = zodToGeminiSchema(QuickScoreResponseSchema);

export interface ScoringContext {
  roomType: string;
  budgetMode: string;
  existingItems: string[];
  roomImageUrls: string[];
  priorities?: string[];
  otherRoomsContext?: string;
  designProfile?: DynamicDesignProfile;
  diagnosis?: DiagnosisData;
  designDirection?: DesignDirection;
  userFeedbackContext?: string;
  /** Where this specific product is intended to go in the room */
  placement?: string;
  /** Overall spatial layout plan for the room */
  spatialLayout?: string;
  /** Floor plan dimensions if available */
  floorPlan?: Record<string, unknown>;
  /** Lighting conditions description */
  lightingConditions?: string;
  /** Window and door positions */
  windowDoorPositions?: string;
  /** Outlet locations */
  outletPositions?: string;
  /** User's free-text notes about their room */
  userContext?: string;
  /** Items being replaced or removed */
  replaceItems?: string[];
  /**
   * Pre-formatted "EXISTING IDENTIFIED PIECES" block from the furniture
   * identification pipeline. Empty/undefined when the feature is off — the
   * prompt stays byte-for-byte equivalent to the pre-feature shape.
   */
  identifiedContext?: string;
}

// ─── Score Calibration Anchors ────────────────────────────────
// Few-shot examples so the model has concrete reference points for what each score level means.
const CALIBRATION_ANCHORS = `
## SCORE CALIBRATION — USE THESE AS ANCHORS
Before scoring, calibrate against these reference examples. Read ALL of them first, then score.

**9-10 (Exceptional)**: A walnut coffee table with tapered legs for a mid-century living room that already has a walnut media console and warm rug. Materials match exactly, scale is perfect (48" table for 84" sofa), style is cohesive, price is fair. THIS IS RARE — reserve 9-10 for near-perfect matches.

**7-8 (Strong)**: A linen accent chair in warm ivory for a room with a leather sofa and oak floors. Style works, palette compatible, good scale. Minor concern: the exact shade might lean slightly cool vs. the warm oak — but overall a solid choice.

**5-6 (Mediocre)**: A generic gray fabric ottoman for a room that needs warmth and texture. It doesn't clash, but it doesn't solve any problems. Safe but uninspired. THIS IS AVERAGE — most okay-but-not-great products belong here.

**3-4 (Poor)**: A glossy white lacquer side table in a room with warm wood tones and matte finishes. The finish actively clashes. Or: a 5x7 rug under an L-shaped sectional that needs an 8x10. Scale is wrong.

**1-2 (Wrong)**: A farmhouse distressed dining table for a sleek modern apartment. Completely wrong style family. Or: a 4-person dining table when the client hosts dinner parties of 8.

CRITICAL: Use the FULL range. If a product is just okay, score it 5-6. If it has real problems, score it 3-4. Do NOT give everything 6-8 out of politeness.`;

/**
 * Score a single product via two parallel focused calls:
 *   1. Aesthetic pass — style / palette / material / cohesion + reasoning + notes
 *   2. Functional pass — scale / function / value + confidence
 *
 * Splitting prevents the 8-dim monolith from trading one dimension off against
 * another within a single token budget. Both passes see identical context
 * (room, diagnosis, design direction, product images) so their scores are
 * rooted in the same evidence — they just focus on different questions.
 *
 * Math veto (scale / palette / material) and calibration anchors are preserved.
 */
export async function scoreProduct(
  product: CandidateProduct,
  scoringCtx: ScoringContext
): Promise<AgentResult<ProductEvaluationResult & { area_fit_note?: string; apartment_fit_note?: string }>> {
  const model = selectModel("scoring");
  const system = getSystemPrompt(scoringCtx.designProfile);

  const evalCtx: EvalContextArgs = {
    roomType: scoringCtx.roomType,
    category: product.category || "unknown",
    existingItems: scoringCtx.existingItems,
    budgetMode: scoringCtx.budgetMode,
    otherRoomsContext: scoringCtx.otherRoomsContext,
    priorities: scoringCtx.priorities,
    diagnosis: scoringCtx.diagnosis,
    designDirection: scoringCtx.designDirection,
    placement: scoringCtx.placement,
    spatialLayout: scoringCtx.spatialLayout,
    floorPlan: scoringCtx.floorPlan,
    lightingConditions: scoringCtx.lightingConditions,
    windowDoorPositions: scoringCtx.windowDoorPositions,
    outletPositions: scoringCtx.outletPositions,
    userContext: scoringCtx.userContext,
    replaceItems: scoringCtx.replaceItems,
    identifiedContext: scoringCtx.identifiedContext,
  };
  const aestheticPrompt = getAestheticEvalPrompt(evalCtx);
  const functionalPrompt = getFunctionalEvalPrompt(evalCtx);

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

  // Shared image content — both passes see the same photos.
  const sharedImages: AIContentBlock[] = [];
  for (const url of scoringCtx.roomImageUrls.slice(0, 3)) {
    sharedImages.push({ type: "image", source: { type: "url", url } });
  }
  if (product.image_url) {
    sharedImages.push({ type: "image", source: { type: "url", url: product.image_url } });
  }
  if (lifestyleImageUrl) {
    sharedImages.push({ type: "image", source: { type: "url", url: lifestyleImageUrl } });
  }

  // Compute deterministic math scores before LLM evaluation
  const lifestyleFlags = resolveLifestyleFlags(scoringCtx.designProfile?.lifestyle);
  const mathScores: ProductMathScores = computeProductMathScores(
    {
      title: product.title || undefined,
      category: product.category || undefined,
      price: product.price || undefined,
      materials: product.materials || undefined,
      colors: product.colors || undefined,
      dimensions: product.dimensions || undefined,
      description: product.description || undefined,
    },
    {
      roomType: scoringCtx.roomType,
      budgetMode: scoringCtx.budgetMode,
      recommendedPalette: scoringCtx.designDirection?.recommended_palette,
      recommendedMaterials: scoringCtx.designDirection?.recommended_materials,
      floorPlan: scoringCtx.floorPlan,
      placement: scoringCtx.placement,
      lifestyle: lifestyleFlags,
    }
  );
  const mathSection = formatProductMathForPrompt(mathScores);
  const feedbackSection = scoringCtx.userFeedbackContext
    ? `\n\n${scoringCtx.userFeedbackContext}`
    : "";

  const productTextTail = `\n\n${CALIBRATION_ANCHORS}${feedbackSection}\n\n${mathSection}\n\n## PRODUCT INFORMATION\n${productInfo}\n\n**IMPORTANT**: Study the product images carefully. Score based on what you SEE in the images — not just the text description. If a lifestyle image is included, use it to assess real-world scale and setting.`;

  const aestheticContent: AIContentBlock[] = [
    ...sharedImages,
    { type: "text", text: `${aestheticPrompt}${productTextTail}` },
  ];
  const functionalContent: AIContentBlock[] = [
    ...sharedImages,
    { type: "text", text: `${functionalPrompt}${productTextTail}` },
  ];

  // Run a single pass with retry, then merge. Failures in either pass bubble up
  // to the shared retry wrapper — but since we Promise.all, one failing retries
  // don't block the other's success.
  const runPass = async <T>(
    passName: "aesthetic" | "functional",
    content: AIContentBlock[],
    parse: (raw: unknown) => T,
  ): Promise<{ data: T; tokens: number; model: string }> => {
    let lastError: string | undefined;
    let attempt = 0;
    return await withRetry(
      async () => {
        attempt++;
        const retryContent = attempt > 1 && lastError
          ? [...content, { type: "text" as const, text: `\n\n**IMPORTANT**: Your previous response was invalid: "${lastError}". Return ONLY valid JSON matching the exact schema above.` }]
          : content;

        const response = await geminiProvider.chat({
          model,
          system,
          messages: [{ role: "user", content: retryContent }],
          // Aesthetic pass carries the reasoning + notes; functional is pure scores.
          max_tokens: passName === "aesthetic" ? 8000 : 4000,
          seed: DETERMINISTIC_SEED,
          responseMimeType: "application/json",
          thinkingConfig: { thinkingLevel: "high" },
          mediaResolution: "ultra_high",
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
          lastError = error instanceof Error ? error.message : `${passName} scoring failed`;
          log.warn(`Retry ${retryAttempt} for ${passName} pass on "${product.title}"`, {
            productId: product.id,
            durationMs: delayMs,
            error: lastError,
          });
        },
      }
    );
  };

  try {
    const [aestheticRes, functionalRes] = await Promise.all([
      runPass("aesthetic", aestheticContent, (raw) => AestheticEvalResponseSchema.parse(raw)),
      runPass("functional", functionalContent, (raw) => FunctionalEvalResponseSchema.parse(raw)),
    ]);

    // Merge into the legacy 8-dim ProductScores shape. The two passes agree on
    // product image + room image; their outputs compose without double-counting.
    const scores = {
      style_fit_score: aestheticRes.data.scores.style_fit_score,
      palette_fit_score: aestheticRes.data.scores.palette_fit_score,
      material_fit_score: aestheticRes.data.scores.material_fit_score,
      cohesion_fit_score: aestheticRes.data.scores.cohesion_fit_score,
      scale_fit_score: functionalRes.data.scores.scale_fit_score,
      function_fit_score: functionalRes.data.scores.function_fit_score,
      value_fit_score: functionalRes.data.scores.value_fit_score,
      confidence_score: functionalRes.data.scores.confidence_score,
    };

    // Math veto: cap AI dimension scores where deterministic math found violations.
    const VETO_THRESHOLD = 0.6; // from lib/config/pipeline.ts MATH_VETO.threshold
    if (mathScores.scale_fit < VETO_THRESHOLD && scores.scale_fit_score > VETO_THRESHOLD * 10) {
      log.info(`Math capping scale_fit: AI=${scores.scale_fit_score} → ${Math.round(mathScores.scale_fit * 10)}`, { product: product.title });
      scores.scale_fit_score = Math.round(mathScores.scale_fit * 10);
    }
    if (mathScores.palette_fit < VETO_THRESHOLD && scores.palette_fit_score > VETO_THRESHOLD * 10) {
      log.info(`Math capping palette_fit: AI=${scores.palette_fit_score} → ${Math.round(mathScores.palette_fit * 10)}`, { product: product.title });
      scores.palette_fit_score = Math.round(mathScores.palette_fit * 10);
    }
    if (mathScores.material_fit < VETO_THRESHOLD && scores.material_fit_score > VETO_THRESHOLD * 10) {
      log.info(`Math capping material_fit: AI=${scores.material_fit_score} → ${Math.round(mathScores.material_fit * 10)}`, { product: product.title });
      scores.material_fit_score = Math.round(mathScores.material_fit * 10);
    }

    const finalScore = computeFinalItemScore(scores, product.category || undefined);
    const verdict = determineVerdict(finalScore, scores.confidence_score);

    const categoryKey = (product.category || "unknown").toLowerCase().replace(/[\s-]+/g, "_");
    recordProductScores({
      ...scores as unknown as Record<string, number>,
      final_item_score: finalScore,
      [`${categoryKey}_final_item_score`]: finalScore,
    });

    const totalTokens = aestheticRes.tokens + functionalRes.tokens;
    log.info("Product scored (split pass)", {
      productId: product.id,
      model: aestheticRes.model,
      tokens: { total: totalTokens },
      aestheticTokens: aestheticRes.tokens,
      functionalTokens: functionalRes.tokens,
      finalScore,
      verdict,
      category: product.category || "unknown",
    });

    return {
      success: true,
      data: {
        scores,
        final_item_score: finalScore,
        verdict,
        reasoning: aestheticRes.data.reasoning,
        area_fit_note: aestheticRes.data.area_fit_note,
        apartment_fit_note: aestheticRes.data.apartment_fit_note,
      },
      tokensUsed: totalTokens,
      model: aestheticRes.model,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Scoring failed after retries";
    log.error(`Scoring failed for "${product.title}"`, { productId: product.id, error: errMsg });
    return { success: false, error: errMsg };
  }
}

export interface QuickScoreEntry {
  productId: string;
  quickScore: number;
  styleFit: number;
  scaleFit: number;
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
  budgetMode: string,
  designDirection?: DesignDirection,
  placement?: string,
  floorPlan?: Record<string, unknown>,
  diagnosis?: Record<string, unknown>,
  priorities?: string[],
  existingItems?: string[],
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
            p.dimensions && `  Dimensions: ${JSON.stringify(p.dimensions)}`,
            p.materials?.length && `  Materials: ${p.materials.join(", ")}`,
            p.colors?.length && `  Colors: ${p.colors.join(", ")}`,
            vTags.length > 0 && `  Visual style: ${vTags.join(", ")}`,
            p.description && `  Description: ${p.description.slice(0, 150)}`,
          ].filter(Boolean).join("\n");
          return info;
        })
        .join("\n\n");

      // Build design aesthetic from dynamic design direction
      const aesthetic = designDirection
        ? [
            designDirection.style_notes,
            designDirection.recommended_palette?.length && `Palette: ${designDirection.recommended_palette.join(", ")}`,
            designDirection.recommended_materials?.length && `Materials: ${designDirection.recommended_materials.join(", ")}`,
          ].filter(Boolean).join(". ")
        : "Based on apartment photos and building context";

      // Build spatial context for scale checking
      const spatialHint = [
        placement && `Intended placement: ${placement}`,
        floorPlan?.room_dimensions && `Room dimensions: ${JSON.stringify(floorPlan.room_dimensions)}`,
        floorPlan?.total_sqft && `Apartment: ~${floorPlan.total_sqft} sqft`,
      ].filter(Boolean).join("\n");

      // Build diagnosis context
      const diagnosisHint = (() => {
        if (!diagnosis) return "";
        const parts: string[] = [];
        if (diagnosis.summary) parts.push(`Room assessment: ${diagnosis.summary}`);
        const issues = [
          ...(diagnosis.scale_proportion_issues as string[] || []),
          ...(diagnosis.color_issues as string[] || []),
          ...(diagnosis.texture_material_issues as string[] || []),
        ];
        if (issues.length > 0) parts.push(`Known issues to solve: ${issues.join("; ")}`);
        return parts.length > 0 ? parts.join("\n") : "";
      })();

      // Build existing items context
      const existingHint = existingItems && existingItems.length > 0
        ? `Existing items to harmonize with: ${existingItems.join(", ")}`
        : "";

      // Build priorities context
      const prioritiesHint = priorities && priorities.length > 0
        ? `Client priorities: ${priorities.join(", ")}`
        : "";

      const prompt = `Quick-score these ${category} products for a ${roomType}. Budget mode: ${budgetMode}.

PROCESS: For each product, think step-by-step:
1. Does the product's style/material/color match the design direction? → style_fit
2. Will it physically fit in the intended space? Compare dimensions. → scale_fit
3. Is the price reasonable for what you get? → value_fit
4. How complete is the product data? → confidence

Design direction: ${aesthetic}
${spatialHint ? `\n## SPATIAL CONTEXT\n${spatialHint}` : ""}
${diagnosisHint ? `\n## ROOM DIAGNOSIS\n${diagnosisHint}` : ""}
${existingHint ? `\n## EXISTING ITEMS\n${existingHint}` : ""}
${prioritiesHint ? `\n## CLIENT PRIORITIES\n${prioritiesHint}` : ""}

## PRODUCTS
${productList}

## SCORING (each 0-10) — USE THE FULL SCALE

**style_fit** — Does this match the design direction above?
- 9-10: Perfect match — materials, colors, and style align with the design direction
- 7-8: Good match — mostly aligned, minor deviations
- 5-6: Acceptable but not ideal — generic or slightly off-direction
- 3-4: Poor match — wrong style family or clashing materials/colors
- 1-2: Completely wrong — industrial when we need mid-century, chrome when we need brass, etc.

**scale_fit** — Will this physically fit in the intended space?
- Check product dimensions against room dimensions and placement context above
- 9-10: Perfect size for the space — rug covers seating area, table seats the right number, fits the wall/floor area
- 7-8: Close — might be slightly over/under but workable
- 5-6: Questionable — dimensions seem tight or product might be too small/large for the space
- 3-4: Likely wrong — product is obviously too large for the room or way too small for the area
- 1-2: Definitely wrong — e.g., king bed dimensions for a small bedroom, 5x7 rug for a large living room
- If no dimensions listed, score 5 (neutral)

**value_fit** — Is the price reasonable for what you get?
- ${budgetMode === "budget" ? "Weight this HEAVILY. Products over the tier's price range should score 3 or below." : "Balance quality and price. Premium materials at fair prices score highest."}
- If price is missing, score 5 (neutral) — do NOT assume it's good value.

**confidence** — How reliable is the product data?
- 9-10: Complete info — title, price, materials, colors, dimensions, description all present
- 7-8: Mostly complete — missing one field
- 5-6: Partial — have title and maybe price, but materials/colors unclear
- 3-4: Minimal — only title and retailer, everything else missing or vague

## IMPORTANT: SCORE RELATIVE TO EACH OTHER
Within this batch, use the full 0-10 range. The best product should score 7+. The worst should score 4 or below. Do NOT give everything 5-7 — differentiate clearly.

Return JSON:
{
  "scores": [
    { "index": number, "style_fit": number, "scale_fit": number, "value_fit": number, "confidence": number }
  ]
}`;

      // Build visual content: include product images for visual pre-filtering
      const qsContent: AIContentBlock[] = [];
      for (const p of batch) {
        if (p.image_url) {
          qsContent.push({ type: "image", source: { type: "url", url: p.image_url } });
        }
      }
      qsContent.push({ type: "text", text: prompt });

      let lastQsError: string | undefined;
      let batchTokens = 0;
      try {
        const entries = await withRetry(
          async () => {
            const retryHint = lastQsError
              ? `\n\nPrevious response was invalid: "${lastQsError}". Return ONLY valid JSON with the exact schema above.`
              : "";

            const response = await geminiProvider.chat({
              model: selectModel("quick_score"),
              system: "You are a quick product screener for interior design. Score products on style fit and value. Be strict — a 7+ means genuinely good. If product images are provided, use them to verify style, color, and material claims. Return ONLY the JSON scores, no explanations.",
              messages: [{ role: "user", content: [...qsContent, { type: "text" as const, text: retryHint }] }],
              max_tokens: 1500,
              seed: DETERMINISTIC_SEED,
              responseSchema: QUICK_SCORE_GEMINI_SCHEMA,
              mediaResolution: "ultra_high",
            });

            batchTokens += response.usage.input_tokens + response.usage.output_tokens + response.usage.thinking_tokens;
            const raw = extractJsonObject(response.content);
            const validated = QuickScoreResponseSchema.parse(raw);
            const result: QuickScoreEntry[] = [];
            for (const scoreEntry of validated.scores) {
              if (scoreEntry.index >= 0 && scoreEntry.index < batch.length) {
                const scaleFit = scoreEntry.scale_fit ?? 5;
                // Gate: if ANY dimension is critically low (≤ 2), the product
                // is physically impossible or fundamentally wrong — cap the
                // quick score so it cannot sneak past the deep-score threshold.
                const minDim = Math.min(scoreEntry.style_fit, scaleFit, scoreEntry.value_fit);
                const avg = (scoreEntry.style_fit + scaleFit + scoreEntry.value_fit + scoreEntry.confidence) / 4;
                const quickScore = minDim <= 2
                  ? Math.min(Math.round(avg * 10) / 10, minDim)
                  : Math.round(avg * 10) / 10;
                result.push({
                  productId: batch[scoreEntry.index].id,
                  quickScore,
                  styleFit: scoreEntry.style_fit,
                  scaleFit,
                  valueFit: scoreEntry.value_fit,
                  confidence: scoreEntry.confidence,
                });
              }
            }
            return result;
          },
          {
            maxAttempts: 2,
            baseDelayMs: 1000,
            isRetryable: (error) => {
              lastQsError = error instanceof Error ? error.message : "Quick score failed";
              if (isRetryableError(error)) return true;
              if (error instanceof SyntaxError) return true;
              if (error instanceof Error && error.name === "ZodError") return true;
              return false;
            },
            onRetry: (retryAttempt, delayMs) => {
              log.warn(`Quick-score retry ${retryAttempt}`, { category, durationMs: delayMs });
            },
          }
        );
        return { entries, tokensUsed: batchTokens };
      } catch (qsErr) {
        const errMsg = qsErr instanceof Error ? qsErr.message : "Quick score failed";
        log.warn("Quick score failed for batch, applying conservative defaults", { category, error: errMsg });
        return {
          entries: batch.map((p) => ({
            productId: p.id,
            quickScore: 3,
            styleFit: 3,
            scaleFit: 3,
            valueFit: 3,
            confidence: 1,
          })),
          tokensUsed: batchTokens,
        };
      }
    })
  );

  let totalTokens = 0;
  for (const { entries, tokensUsed } of batchResults) {
    allScores.push(...entries);
    totalTokens += tokensUsed;
  }

  return { success: true, data: allScores, tokensUsed: totalTokens };
}
