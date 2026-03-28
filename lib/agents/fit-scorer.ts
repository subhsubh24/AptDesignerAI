import { geminiProvider } from "@/lib/ai/gemini";
import { selectModel } from "@/lib/ai/models";
import { getSystemPrompt } from "@/lib/prompts/system";
import { getProductEvalPrompt } from "@/lib/prompts/product-eval";
import { computeFinalItemScore, determineVerdict } from "@/lib/scoring/product-scorer";
import type { AIContentBlock } from "@/lib/ai/provider";
import type { AgentResult } from "./types";
import type { ProductEvaluationResult } from "@/lib/types/scoring";
import type { CandidateProduct, DesignDirection, DiagnosisData } from "@/lib/types/database";
import type { DynamicDesignProfile } from "@/lib/design-context/user-profile";

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
}

// ─── Score Calibration Anchors ────────────────────────────────
// Few-shot examples so the model has concrete reference points for what each score level means.
const CALIBRATION_ANCHORS = `
## SCORE CALIBRATION — USE THESE AS ANCHORS
Before scoring, calibrate against these reference examples:

**9-10 (Exceptional fit)**: A walnut coffee table with tapered legs for a mid-century modern living room that already has a walnut media console and warm-toned rug. Materials match, scale is perfect for the seating area, style is cohesive, price is fair.

**7-8 (Strong fit)**: A linen upholstered accent chair in a warm neutral tone for a room with a leather sofa and wood floors. Style works, palette compatible, but the specific shade might not be ideal — needs to be seen in person.

**5-6 (Mediocre)**: A generic gray fabric ottoman for a room that needs warmth and texture. It doesn't clash, but it doesn't solve any problems either. It's safe but uninspired — a missed opportunity.

**3-4 (Poor fit)**: A glossy white lacquer side table in a room with warm wood tones and matte finishes. The material and finish actively clash with the existing palette. It would look out of place.

**1-2 (Wrong)**: A farmhouse-style distressed wood dining table for a sleek modern apartment with clean lines and contemporary finishes. Completely wrong style family.

Use these anchors to ensure your scores are grounded and consistent.`;

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
    scoringCtx.designDirection
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
  for (const url of scoringCtx.roomImageUrls.slice(0, 2)) {
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

  // Build the full prompt with calibration anchors and optional user feedback
  const feedbackSection = scoringCtx.userFeedbackContext
    ? `\n\n${scoringCtx.userFeedbackContext}`
    : "";

  content.push({
    type: "text",
    text: `${evalPrompt}\n\n${CALIBRATION_ANCHORS}${feedbackSection}\n\n## PRODUCT INFORMATION\n${productInfo}\n\n**IMPORTANT**: Study the product images carefully. Score based on what you SEE in the images (actual color, texture, proportions, style) — not just the text description. If a lifestyle image is included, use it to assess real-world scale and how the product looks in a room setting.`,
  });

  // Attempt scoring with retry on failure
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await geminiProvider.chat({
        model,
        system,
        messages: [{ role: "user", content }],
        max_tokens: 16000,
        temperature: 0.2,
        responseMimeType: "application/json",
        thinkingConfig: { thinkingLevel: "medium" },
      });

      const parsed = JSON.parse(response.content);
      const scores = parsed.scores;
      if (!scores || typeof scores.confidence_score !== "number") {
        throw new Error("Invalid scoring response: missing scores or confidence_score");
      }
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
        tokensUsed: response.usage.input_tokens + response.usage.output_tokens + response.usage.thinking_tokens,
        model: response.model,
      };
    } catch (error) {
      if (attempt === 0) {
        // Retry after brief delay
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : "Scoring failed",
      };
    }
  }

  return { success: false, error: "Scoring failed after retries" };
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
  budgetMode: string,
  designDirection?: DesignDirection
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

      // Build design aesthetic from dynamic design direction
      const aesthetic = designDirection
        ? [
            designDirection.style_notes,
            designDirection.recommended_palette?.length && `Palette: ${designDirection.recommended_palette.join(", ")}`,
            designDirection.recommended_materials?.length && `Materials: ${designDirection.recommended_materials.join(", ")}`,
          ].filter(Boolean).join(". ")
        : "Based on apartment photos and building context";

      const prompt = `Quick-score these ${category} products for a ${roomType}. Budget mode: ${budgetMode}.

Design direction: ${aesthetic}

## PRODUCTS
${productList}

## SCORING (each 0-10) — USE THE FULL SCALE

**style_fit** — Does this match the design direction above?
- 9-10: Perfect match — materials, colors, and style align with the design direction
- 7-8: Good match — mostly aligned, minor deviations
- 5-6: Acceptable but not ideal — generic or slightly off-direction
- 3-4: Poor match — wrong style family or clashing materials/colors
- 1-2: Completely wrong — industrial when we need mid-century, chrome when we need brass, etc.

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
    { "index": number, "style_fit": number, "value_fit": number, "confidence": number }
  ]
}`;

      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const response = await geminiProvider.chat({
            model: selectModel("quick_score"),
            system: "You are a quick product screener for interior design. Score products on style fit and value. Be strict — a 7+ means genuinely good. Return ONLY the JSON scores, no explanations.",
            messages: [{ role: "user", content: prompt }],
            max_tokens: 1500,
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
          if (attempt === 0) {
            await new Promise((r) => setTimeout(r, 1000));
            continue;
          }
          // On second failure, give all products a conservative score (fail open but cautious)
          return batch.map((p) => ({
            productId: p.id,
            quickScore: 5,
            styleFit: 5,
            valueFit: 5,
            confidence: 3,
          }));
        }
      }
      // Unreachable but satisfies TypeScript
      return batch.map((p) => ({
        productId: p.id,
        quickScore: 6,
        styleFit: 6,
        valueFit: 6,
        confidence: 5,
      }));
    })
  );

  for (const entries of batchResults) {
    allScores.push(...entries);
  }

  return { success: true, data: allScores };
}
