import { geminiProvider } from "@/lib/ai/gemini";
import { selectModel } from "@/lib/ai/models";
import { getSystemPromptCore } from "@/lib/prompts/system";
import {
  getCombinedEvalPrompt,
  type EvalContextArgs,
} from "@/lib/prompts/product-eval";
import { computeFinalItemScore, determineVerdict, groundConfidence } from "@/lib/scoring/product-scorer";
import {
  BatchCombinedEvalResponseSchema,
  CombinedEvalResponseSchema,
  QuickScoreResponseSchema,
} from "@/lib/types/schemas";
import { zodToGeminiSchema } from "@/lib/ai/schema";
import { recordProductScores } from "@/lib/scoring/drift-monitor";
import { withRetry, isRetryableError } from "@/lib/ai/retry";
import { DETERMINISTIC_SEED } from "@/lib/ai/determinism";
import { extractJsonObject } from "@/lib/ai/extract-json";
import { isGeminiCompatibleImageUrl } from "@/lib/ai/image-mime";
import { createLogger } from "@/lib/logging/logger";
import crypto from "crypto";
import type { AIContentBlock } from "@/lib/ai/provider";
import type { AgentResult } from "./types";
import type { ProductEvaluationResult } from "@/lib/types/scoring";
import type { CandidateProduct, DesignDirection, DiagnosisData, ExtractedFloorPlan } from "@/lib/types/database";
import type { DynamicDesignProfile } from "@/lib/design-context/user-profile";
import { computeProductMathScores, formatProductMathForPrompt, type ProductMathScores } from "@/lib/validation/product-math";
import { resolveLifestyleFlags } from "@/lib/validation/durability-map";
import { MATH_VETO } from "@/lib/config/pipeline";

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
  /** Structured floor plan extracted via vision model — preferred over legacy floorPlan */
  extractedFloorPlan?: ExtractedFloorPlan;
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
  /**
   * Top anchor products already confirmed in the room (sofa, area_rug, bed,
   * dining_table, etc.), formatted as short spec strings so dependent
   * categories (coffee_table, rug, nightstand) score against real found items
   * rather than abstract requirements.
   *
   * Format per entry: "title | dimensions: W×D×H | material: … | colors: …"
   */
  anchorSpecs?: Record<string, string>;
  /**
   * Room-wide harmony neighbors: top pick per category across the whole room
   * (not limited to anchor categories). Gives the scorer cross-category
   * context so material clashes (e.g. walnut sofa + rubberwood side table)
   * get caught at scoring time instead of after validation.
   */
  harmonyNeighbors?: Array<{ category: string; spec: string }>;
  /**
   * When true, the aesthetic prompt requests area_fit_note / apartment_fit_note.
   * Agentic search path sets false (not rendered in focus UI); manual-sourcing
   * evaluate routes leave default (true) because ManualScorecardView displays them.
   */
  includeFitNotes?: boolean;
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
 * Score a single product in one focused LLM call (all 8 dimensions).
 * Previously used two parallel calls (aesthetic + functional); merged into one
 * to halve deep-score token count (~120 fewer calls per run on a 5-cat × 3-tier
 * config). Context, math veto, and calibration anchors are all preserved.
 */
export async function scoreProduct(
  product: CandidateProduct,
  scoringCtx: ScoringContext
): Promise<AgentResult<ProductEvaluationResult & { area_fit_note?: string; apartment_fit_note?: string }>> {
  const model = selectModel("scoring");
  const system = getSystemPromptCore(scoringCtx.designProfile);

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
    extractedFloorPlan: scoringCtx.extractedFloorPlan,
    lightingConditions: scoringCtx.lightingConditions,
    windowDoorPositions: scoringCtx.windowDoorPositions,
    outletPositions: scoringCtx.outletPositions,
    userContext: scoringCtx.userContext,
    replaceItems: scoringCtx.replaceItems,
    identifiedContext: scoringCtx.identifiedContext,
    anchorSpecs: scoringCtx.anchorSpecs,
    harmonyNeighbors: scoringCtx.harmonyNeighbors,
  };
  const combinedPrompt = getCombinedEvalPrompt({ ...evalCtx, includeFitNotes: scoringCtx.includeFitNotes ?? true });

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

  // Room images are stable per session — hoist them into `cacheScope` so
  // Gemini context caching (when enabled) re-tokenizes them at the cheaper
  // cached rate across the many per-product scoring calls. Product-specific
  // images stay in the per-call message.
  const cachedRoomImages: AIContentBlock[] = scoringCtx.roomImageUrls
    .slice(0, 3)
    .map((url) => ({ type: "image", source: { type: "url", url } }));
  const roomSessionKey = crypto
    .createHash("sha256")
    .update(`${scoringCtx.roomType}|${scoringCtx.roomImageUrls.slice(0, 3).join("|")}`)
    .digest("hex")
    .slice(0, 16);

  const productImages: AIContentBlock[] = [];
  if (product.image_url && isGeminiCompatibleImageUrl(product.image_url)) {
    productImages.push({ type: "image", source: { type: "url", url: product.image_url } });
  }
  if (lifestyleImageUrl && isGeminiCompatibleImageUrl(lifestyleImageUrl)) {
    productImages.push({ type: "image", source: { type: "url", url: lifestyleImageUrl } });
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

  const productTextTail = `\n\n## PRODUCT INFORMATION\n${productInfo}\n\n${mathSection}${feedbackSection}\n\nBased on the room context, design direction, and product information above, score this product using the calibration anchors below.\n\n${CALIBRATION_ANCHORS}\n\nStudy the product images carefully. Score based on what you SEE in the images — not just the text description. If a lifestyle image is included, use it to assess real-world scale and setting.`;

  const combinedContent: AIContentBlock[] = [
    ...productImages,
    { type: "text", text: `${combinedPrompt}${productTextTail}` },
  ];

  let lastError: string | undefined;
  let attempt = 0;

  try {
    const combinedRes = await withRetry(
      async () => {
        attempt++;
        const retryContent = attempt > 1 && lastError
          ? [...combinedContent, { type: "text" as const, text: `\n\n**IMPORTANT**: Your previous response was invalid: "${lastError}". Return ONLY valid JSON matching the exact schema above.` }]
          : combinedContent;

        const response = await geminiProvider.chat({
          model,
          system,
          messages: [{ role: "user", content: retryContent }],
          max_tokens: 10000,
          seed: DETERMINISTIC_SEED,
          responseMimeType: "application/json",
          mediaResolution: "ultra_high",
          cacheScope:
            cachedRoomImages.length > 0
              ? { sessionKey: roomSessionKey, content: cachedRoomImages }
              : undefined,
          // No tools — math is pre-computed and injected via mathSection.
          // Dropping codeExecution lets Gemini cache the room images via
          // cacheScope, saving ~7500 image tokens per scoring call.
        });

        const raw = extractJsonObject(response.content);
        const data = CombinedEvalResponseSchema.parse(raw);
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
          lastError = error instanceof Error ? error.message : "scoring failed";
          log.warn(`Retry ${retryAttempt} for scoring "${product.title}"`, {
            productId: product.id,
            durationMs: delayMs,
            error: lastError,
          });
        },
      }
    );

    const scores = { ...combinedRes.data.scores };

    // Math veto: cap AI dimension scores where deterministic math found violations.
    const VETO_THRESHOLD = MATH_VETO.threshold;
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
    // Ground the LLM confidence against objective data-quality signals so
    // sparse products (no dimensions, no image) can't reach strong_yes.
    const groundedConfidence = groundConfidence(scores.confidence_score, {
      hasProductImage: productImages.length > 0,
      hasDimensions: !!(product.dimensions?.width || product.dimensions?.height || product.dimensions?.diameter),
      hasMaterials: (product.materials?.length ?? 0) > 0,
      hasPrice: !!product.price,
      hasDescription: !!(product.description?.length),
      hasRoomImages: scoringCtx.roomImageUrls.length > 0,
      mathValidationRan: true,
    });
    scores.confidence_score = groundedConfidence;
    const verdict = determineVerdict(finalScore, groundedConfidence);

    const categoryKey = (product.category || "unknown").toLowerCase().replace(/[\s-]+/g, "_");
    recordProductScores({
      ...scores as unknown as Record<string, number>,
      final_item_score: finalScore,
      [`${categoryKey}_final_item_score`]: finalScore,
    });

    log.info("Product scored (combined pass)", {
      productId: product.id,
      model: combinedRes.model,
      tokens: { total: combinedRes.tokens },
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
        reasoning: combinedRes.data.reasoning,
        area_fit_note: combinedRes.data.area_fit_note,
        apartment_fit_note: combinedRes.data.apartment_fit_note,
      },
      tokensUsed: combinedRes.tokens,
      model: combinedRes.model,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Scoring failed after retries";
    log.error(`Scoring failed for "${product.title}"`, { productId: product.id, error: errMsg });
    return { success: false, error: errMsg };
  }
}

/**
 * Batch deep-score multiple products in a single LLM call.
 *
 * Works on products sharing the same ScoringContext — typically one
 * (category, tier) cell at a time, where anchor specs, harmony
 * neighbors, room images, and design context are identical.
 *
 * Tradeoff vs per-product: one call amortizes the context and room-image
 * tokens across the batch (~2500 tokens saved per duplicated item), and
 * cuts LLM round-trips 2-3x. The model may be slightly less focused per
 * product, so we cap batch size at 3 and keep per-product product images
 * side-by-side so each product still gets direct visual attention.
 *
 * Returns per-product results keyed by product.id. Math veto and
 * confidence grounding are applied per-product after the LLM call,
 * identical to scoreProduct.
 */
export async function scoreProducts(
  products: CandidateProduct[],
  scoringCtx: ScoringContext,
  batchSize: number = 3,
): Promise<{
  results: Map<string, AgentResult<ProductEvaluationResult & { area_fit_note?: string; apartment_fit_note?: string }>>;
  tokensUsed: number;
}> {
  const results = new Map<
    string,
    AgentResult<ProductEvaluationResult & { area_fit_note?: string; apartment_fit_note?: string }>
  >();
  let totalTokens = 0;

  if (products.length === 0) return { results, tokensUsed: 0 };
  if (products.length === 1) {
    const r = await scoreProduct(products[0], scoringCtx);
    results.set(products[0].id, r);
    return { results, tokensUsed: r.tokensUsed ?? 0 };
  }

  const batches: CandidateProduct[][] = [];
  for (let i = 0; i < products.length; i += batchSize) {
    batches.push(products.slice(i, i + batchSize));
  }

  const model = selectModel("scoring");
  const system = getSystemPromptCore(scoringCtx.designProfile);

  const cachedRoomImages: AIContentBlock[] = scoringCtx.roomImageUrls
    .slice(0, 3)
    .map((url) => ({ type: "image" as const, source: { type: "url" as const, url } }));
  const roomSessionKey = crypto
    .createHash("sha256")
    .update(`${scoringCtx.roomType}|${scoringCtx.roomImageUrls.slice(0, 3).join("|")}`)
    .digest("hex")
    .slice(0, 16);

  const lifestyleFlags = resolveLifestyleFlags(scoringCtx.designProfile?.lifestyle);

  const batchResults = await Promise.all(
    batches.map(async (batch) => {
      // Build a single base eval prompt (room context, design direction,
      // scoring calibration, etc.) — shared across all products in batch.
      const evalCtx: EvalContextArgs = {
        roomType: scoringCtx.roomType,
        category: batch[0].category || "unknown",
        existingItems: scoringCtx.existingItems,
        budgetMode: scoringCtx.budgetMode,
        otherRoomsContext: scoringCtx.otherRoomsContext,
        priorities: scoringCtx.priorities,
        diagnosis: scoringCtx.diagnosis,
        designDirection: scoringCtx.designDirection,
        placement: scoringCtx.placement,
        spatialLayout: scoringCtx.spatialLayout,
        floorPlan: scoringCtx.floorPlan,
        extractedFloorPlan: scoringCtx.extractedFloorPlan,
        lightingConditions: scoringCtx.lightingConditions,
        windowDoorPositions: scoringCtx.windowDoorPositions,
        outletPositions: scoringCtx.outletPositions,
        userContext: scoringCtx.userContext,
        replaceItems: scoringCtx.replaceItems,
        identifiedContext: scoringCtx.identifiedContext,
        anchorSpecs: scoringCtx.anchorSpecs,
        harmonyNeighbors: scoringCtx.harmonyNeighbors,
      };
      const basePrompt = getCombinedEvalPrompt({
        ...evalCtx,
        includeFitNotes: scoringCtx.includeFitNotes ?? true,
      });

      // Build per-product blocks: each gets an index, its images, and
      // its text info (title, price, materials, math section).
      const perProductMath: ProductMathScores[] = [];
      const productBlocks: AIContentBlock[] = [];
      const productTextParts: string[] = [];

      for (let idx = 0; idx < batch.length; idx++) {
        const product = batch[idx];
        const meta = product.metadata as Record<string, unknown> | null;
        const visualTags = (meta?.visual_style_tags as string[]) || [];
        const availableVariants = (meta?.available_variants as string[]) || [];
        const lifestyleImageUrl = meta?.lifestyle_image_url as string | undefined;

        const productInfo = [
          product.title && `Title: ${product.title}`,
          product.retailer && `Retailer: ${product.retailer}`,
          product.price && `Price: $${product.price}`,
          product.dimensions && `Dimensions: ${JSON.stringify(product.dimensions)}`,
          product.materials?.length && `Materials: ${product.materials.join(", ")}`,
          product.colors?.length && `Colors: ${product.colors.join(", ")}`,
          visualTags.length > 0 && `Visual style: ${visualTags.join(", ")}`,
          availableVariants.length > 0 && `Other options: ${availableVariants.join(", ")}`,
          product.description && `Description: ${product.description}`,
        ]
          .filter(Boolean)
          .join("\n");

        // Product images inserted as vision blocks before the text marker.
        if (product.image_url && isGeminiCompatibleImageUrl(product.image_url)) {
          productBlocks.push({ type: "image", source: { type: "url", url: product.image_url } });
        }
        if (lifestyleImageUrl && isGeminiCompatibleImageUrl(lifestyleImageUrl)) {
          productBlocks.push({ type: "image", source: { type: "url", url: lifestyleImageUrl } });
        }

        const math: ProductMathScores = computeProductMathScores(
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
        perProductMath.push(math);

        productTextParts.push(
          `### PRODUCT [${idx}]\n${productInfo}\n\n${formatProductMathForPrompt(math)}`,
        );
      }

      const feedbackSection = scoringCtx.userFeedbackContext
        ? `\n\n${scoringCtx.userFeedbackContext}`
        : "";

      const batchTail = `

## PRODUCTS TO SCORE
Score each of the ${batch.length} products below INDEPENDENTLY. Return one entry per product in the "products" array, with "index" matching the [N] tag. Use the calibration anchors — do NOT inflate scores or cluster them.

${productTextParts.join("\n\n")}${feedbackSection}

<output_contract>
Return JSON ONLY matching this shape (no prose, no markdown fences):

{
  "products": [
    {
      "index": 0,
      "scores": { "style_fit_score": n, "palette_fit_score": n, "material_fit_score": n, "cohesion_fit_score": n, "scale_fit_score": n, "function_fit_score": n, "value_fit_score": n, "confidence_score": n },
      "reasoning": { "top_reasons": ["..."], "risks": ["..."], "suggestions": ["..."] }${scoringCtx.includeFitNotes ? `,
      "area_fit_note": "...",
      "apartment_fit_note": "..."` : ""}
    }
    // ... one entry per product, index 0..${batch.length - 1}
  ]
}
</output_contract>`;

      const messageContent: AIContentBlock[] = [
        ...productBlocks,
        { type: "text", text: `${basePrompt}${batchTail}` },
      ];

      let lastError: string | undefined;
      let attempt = 0;

      try {
        const res = await withRetry(
          async () => {
            attempt++;
            const retryContent = attempt > 1 && lastError
              ? [...messageContent, { type: "text" as const, text: `\n\n**IMPORTANT**: Your previous response was invalid: "${lastError}". Return ONLY valid JSON matching the exact schema above, with exactly ${batch.length} entries in "products".` }]
              : messageContent;

            const response = await geminiProvider.chat({
              model,
              system,
              messages: [{ role: "user", content: retryContent }],
              max_tokens: 10000 + batch.length * 3000,
              seed: DETERMINISTIC_SEED,
              responseMimeType: "application/json",
              mediaResolution: "ultra_high",
              cacheScope:
                cachedRoomImages.length > 0
                  ? { sessionKey: roomSessionKey, content: cachedRoomImages }
                  : undefined,
              // No tools — math is pre-computed. Lets room images hit cache.
            });

            const raw = extractJsonObject(response.content);
            const data = BatchCombinedEvalResponseSchema.parse(raw);
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
              lastError = error instanceof Error ? error.message : "batch scoring failed";
              log.warn(`Retry ${retryAttempt} for batch scoring (${batch.length} products)`, {
                durationMs: delayMs,
                error: lastError,
              });
            },
          }
        );

        return { res, batch, perProductMath };
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : "Batch scoring failed";
        log.warn("Batch scoring failed — falling back to per-product", {
          error: errMsg,
          batchSize: batch.length,
        });
        return { res: null, batch, perProductMath, error: errMsg };
      }
    }),
  );

  // Post-process each batch: apply math veto, ground confidence, store
  // per-product result. If the batch call failed, fall back to scoreProduct
  // for each product in that batch so we don't lose coverage.
  for (const br of batchResults) {
    if (!br.res) {
      for (const product of br.batch) {
        const single = await scoreProduct(product, scoringCtx);
        results.set(product.id, single);
        if (single.tokensUsed) totalTokens += single.tokensUsed;
      }
      continue;
    }

    const { res, batch, perProductMath } = br;
    totalTokens += res.tokens;

    // Build index → entry map so we tolerate missing or reordered entries.
    const entryByIdx = new Map<number, typeof res.data.products[number]>();
    for (const entry of res.data.products) {
      entryByIdx.set(entry.index, entry);
    }

    for (let idx = 0; idx < batch.length; idx++) {
      const product = batch[idx];
      const entry = entryByIdx.get(idx);
      if (!entry) {
        // Model skipped this product — fall back to per-product call.
        log.warn("Batch missing product entry — falling back", {
          productId: product.id,
          expectedIndex: idx,
        });
        const single = await scoreProduct(product, scoringCtx);
        results.set(product.id, single);
        if (single.tokensUsed) totalTokens += single.tokensUsed;
        continue;
      }

      const math = perProductMath[idx];
      const scores = { ...entry.scores };

      const VETO_THRESHOLD = MATH_VETO.threshold;
      if (math.scale_fit < VETO_THRESHOLD && scores.scale_fit_score > VETO_THRESHOLD * 10) {
        scores.scale_fit_score = Math.round(math.scale_fit * 10);
      }
      if (math.palette_fit < VETO_THRESHOLD && scores.palette_fit_score > VETO_THRESHOLD * 10) {
        scores.palette_fit_score = Math.round(math.palette_fit * 10);
      }
      if (math.material_fit < VETO_THRESHOLD && scores.material_fit_score > VETO_THRESHOLD * 10) {
        scores.material_fit_score = Math.round(math.material_fit * 10);
      }

      const finalScore = computeFinalItemScore(scores, product.category || undefined);
      const hasProductImage =
        !!(product.image_url && isGeminiCompatibleImageUrl(product.image_url));
      const groundedConfidence = groundConfidence(scores.confidence_score, {
        hasProductImage,
        hasDimensions: !!(product.dimensions?.width || product.dimensions?.height || product.dimensions?.diameter),
        hasMaterials: (product.materials?.length ?? 0) > 0,
        hasPrice: !!product.price,
        hasDescription: !!(product.description?.length),
        hasRoomImages: scoringCtx.roomImageUrls.length > 0,
        mathValidationRan: true,
      });
      scores.confidence_score = groundedConfidence;
      const verdict = determineVerdict(finalScore, groundedConfidence);

      const categoryKey = (product.category || "unknown").toLowerCase().replace(/[\s-]+/g, "_");
      recordProductScores({
        ...(scores as unknown as Record<string, number>),
        final_item_score: finalScore,
        [`${categoryKey}_final_item_score`]: finalScore,
      });

      results.set(product.id, {
        success: true,
        data: {
          scores,
          final_item_score: finalScore,
          verdict,
          reasoning: entry.reasoning,
          area_fit_note: entry.area_fit_note,
          apartment_fit_note: entry.apartment_fit_note,
        },
        tokensUsed: Math.round(res.tokens / batch.length),
        model: res.model,
      });
    }

    log.info("Batch scored", {
      batchSize: batch.length,
      model: res.model,
      perProductTokens: Math.round(res.tokens / batch.length),
      totalTokens: res.tokens,
    });
  }

  return { results, tokensUsed: totalTokens };
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

      // Quick-score context is intentionally minimal — just style/spatial/placement.
      // Full diagnosis and priorities are re-applied in deep-score; shipping them
      // here inflates every batch by ~500-800 tokens for no screening gain.

      const prompt = `Quick-score these ${category} products for a ${roomType}. Budget mode: ${budgetMode}.

PROCESS: For each product, think step-by-step:
1. Does the product's style/material/color match the design direction? → style_fit
2. Will it physically fit in the intended space? Compare dimensions. → scale_fit
3. Is the price reasonable for what you get? → value_fit
4. How complete is the product data? → confidence

Design direction: ${aesthetic}
${spatialHint ? `\n## SPATIAL CONTEXT\n${spatialHint}` : ""}

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

      // Build visual content: include product images for visual pre-filtering.
      // Skip images whose URL ends in a Gemini-incompatible extension (TIFF,
      // BMP, SVG, RAW) — sending them triggers a 400 that fails the whole batch.
      const qsContent: AIContentBlock[] = [];
      for (const p of batch) {
        if (p.image_url && isGeminiCompatibleImageUrl(p.image_url)) {
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
              max_tokens: 10000,
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
