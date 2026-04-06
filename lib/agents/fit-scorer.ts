import { geminiProvider } from "@/lib/ai/gemini";
import { selectModel } from "@/lib/ai/models";
import { getSystemPrompt } from "@/lib/prompts/system";
import { getProductEvalPrompt } from "@/lib/prompts/product-eval";
import { computeFinalItemScore, determineVerdict } from "@/lib/scoring/product-scorer";
import { ProductEvalResponseSchema, QuickScoreResponseSchema } from "@/lib/types/schemas";
import { zodToGeminiSchema } from "@/lib/ai/schema";
import { recordProductScores } from "@/lib/scoring/drift-monitor";
import { withRetry, isRetryableError } from "@/lib/ai/retry";
import { extractJsonObject } from "@/lib/ai/extract-json";
import { createLogger } from "@/lib/logging/logger";
import type { AIContentBlock } from "@/lib/ai/provider";
import type { AgentResult } from "./types";
import type { ProductEvaluationResult } from "@/lib/types/scoring";
import type { CandidateProduct, DesignDirection, DiagnosisData } from "@/lib/types/database";
import type { DynamicDesignProfile } from "@/lib/design-context/user-profile";
import { computeProductMathScores, formatProductMathForPrompt, type ProductMathScores } from "@/lib/validation/product-math";

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
 * Score a single product with the Pro model using extended thinking.
 * Includes score calibration anchors and optional user feedback context.
 * Retries once on failure before returning error.
 */
export async function scoreProduct(
  product: CandidateProduct,
  scoringCtx: ScoringContext
): Promise<AgentResult<ProductEvaluationResult & { area_fit_note?: string; apartment_fit_note?: string }>> {
  const model = selectModel("scoring");
  const system = getSystemPrompt(scoringCtx.designProfile);
  const evalPrompt = getProductEvalPrompt(
    scoringCtx.roomType,
    product.category || "unknown",
    scoringCtx.existingItems,
    scoringCtx.budgetMode,
    scoringCtx.otherRoomsContext,
    scoringCtx.priorities,
    scoringCtx.diagnosis,
    scoringCtx.designDirection,
    scoringCtx.placement,
    scoringCtx.spatialLayout,
    scoringCtx.floorPlan,
    scoringCtx.lightingConditions,
    scoringCtx.windowDoorPositions,
    scoringCtx.outletPositions,
    scoringCtx.userContext,
    scoringCtx.replaceItems
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

  // Add room images for context (up to 3 for better spatial understanding)
  for (const url of scoringCtx.roomImageUrls.slice(0, 3)) {
    content.push({ type: "image", source: { type: "url", url } });
  }

  // Add product image if available
  if (product.image_url) {
    content.push({ type: "image", source: { type: "url", url: product.image_url } });
  }

  // Add lifestyle/room-setting image if available
  if (lifestyleImageUrl) {
    content.push({ type: "image", source: { type: "url", url: lifestyleImageUrl } });
  }

  // Compute deterministic math scores before LLM evaluation
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
    }
  );
  const mathSection = formatProductMathForPrompt(mathScores);

  // Build the full prompt with calibration anchors and optional user feedback
  const feedbackSection = scoringCtx.userFeedbackContext
    ? `\n\n${scoringCtx.userFeedbackContext}`
    : "";

  content.push({
    type: "text",
    text: `${evalPrompt}\n\n${CALIBRATION_ANCHORS}${feedbackSection}\n\n${mathSection}\n\n## PRODUCT INFORMATION\n${productInfo}\n\n**IMPORTANT**: Study the product images carefully. Score based on what you SEE in the images (actual color, texture, proportions, style) — not just the text description. If a lifestyle image is included, use it to assess real-world scale and how the product looks in a room setting.`,
  });

  // Attempt scoring with retry (exponential backoff for API errors,
  // prompt-level retry for parse errors)
  let lastError: string | undefined;
  let attempt = 0;

  try {
    const result = await withRetry(
      async () => {
        attempt++;
        // On retry: include previous error context and bump temperature slightly
        const retryContent = attempt > 1 && lastError
          ? [...content, { type: "text" as const, text: `\n\n**IMPORTANT**: Your previous response was invalid: "${lastError}". Please return ONLY valid JSON matching the exact schema above. Ensure all score fields are numbers 0-10.` }]
          : content;

        const response = await geminiProvider.chat({
          model,
          system,
          messages: [{ role: "user", content: retryContent }],
          max_tokens: 16000,
          temperature: attempt === 1 ? 0.2 : 0.35,
          responseMimeType: "application/json",
          thinkingConfig: { thinkingLevel: "high" },
        });

        const raw = extractJsonObject(response.content);
        const validated = ProductEvalResponseSchema.parse(raw);
        const scores = validated.scores;

        // Apply math veto: cap AI dimension scores where math found violations
        // Threshold is configurable via MATH_VETO config
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

        // Record scores for drift monitoring
        recordProductScores(scores as unknown as Record<string, number>);

        const totalTokens = response.usage.input_tokens + response.usage.output_tokens + response.usage.thinking_tokens;
        log.info("Product scored", {
          productId: product.id,
          model: response.model,
          tokens: { input: response.usage.input_tokens, output: response.usage.output_tokens, thinking: response.usage.thinking_tokens, total: totalTokens },
          finalScore,
          verdict,
          category: product.category || "unknown",
        });

        return {
          success: true as const,
          data: {
            scores,
            final_item_score: finalScore,
            verdict,
            reasoning: validated.reasoning,
            area_fit_note: validated.area_fit_note,
            apartment_fit_note: validated.apartment_fit_note,
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
          // Retry both API errors and parse errors (with corrected prompt on next attempt)
          if (isRetryableError(error)) return true;
          // Also retry JSON parse / Zod validation errors (model returned bad format)
          if (error instanceof SyntaxError) return true;
          if (error instanceof Error && error.name === "ZodError") return true;
          return false;
        },
        onRetry: (retryAttempt, delayMs, error) => {
          lastError = error instanceof Error ? error.message : "Scoring failed";
          log.warn(`Retry ${retryAttempt} for "${product.title}"`, {
            productId: product.id,
            durationMs: delayMs,
            error: lastError,
          });
        },
      }
    );

    return result;
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
              temperature: 0.1,
              responseSchema: QUICK_SCORE_GEMINI_SCHEMA,
            });

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
        return entries;
      } catch (qsErr) {
        const errMsg = qsErr instanceof Error ? qsErr.message : "Quick score failed";
        log.warn("Quick score failed for batch, applying conservative defaults", { category, error: errMsg });
        return batch.map((p) => ({
          productId: p.id,
          quickScore: 3,
          styleFit: 3,
          scaleFit: 3,
          valueFit: 3,
          confidence: 1,
        }));
      }
    })
  );

  for (const entries of batchResults) {
    allScores.push(...entries);
  }

  return { success: true, data: allScores };
}
