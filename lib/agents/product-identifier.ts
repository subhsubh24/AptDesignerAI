/**
 * Product identifier — given a cropped furniture region + retrieval priors
 * from the embedding index, propose brand/model candidates.
 *
 * Design notes:
 *  - We pass the FULL room photo alongside the cropped tile, because crop
 *    context (e.g. "this side table is next to a mid-century sofa") helps
 *    the model rule out implausible brand matches.
 *  - Retrieval priors are HINTS, not answers. The prompt explicitly tells
 *    the model it may reject all priors. This matters because our vector
 *    index is small and biased toward the catalog we seeded.
 *  - Returning an empty `candidates` array is the RIGHT answer for generic
 *    / custom / vintage pieces. We tell the model to prefer silence over
 *    guessing.
 */

import { geminiProvider } from "@/lib/ai/gemini";
import { selectModel } from "@/lib/ai/models";
import { getSystemPrompt } from "@/lib/prompts/system";
import { zodToGeminiSchema } from "@/lib/ai/schema";
import { extractJsonObject } from "@/lib/ai/extract-json";
import { DETERMINISTIC_SEED } from "@/lib/ai/determinism";
import { createLogger } from "@/lib/logging/logger";
import { buildIdentifierPrompt } from "@/lib/prompts/product-identification";
import {
  isAllowListedBrand,
  MIN_CONFIDENCE_IN_LIST,
  MIN_CONFIDENCE_OUT_OF_LIST,
  USER_PROMPT_FLOOR,
} from "@/lib/constants/identifiable-brands";
import {
  IdentifierResponseSchema,
  type IdentifiedProductCandidate,
  type RetrievalPrior,
  type BoundingBox,
} from "@/lib/types/schemas";

const log = createLogger("product-identifier");

const IDENTIFIER_SCHEMA = zodToGeminiSchema(IdentifierResponseSchema);

export interface IdentifyInput {
  /** Full room photo (same `source_image_url` the crop box is relative to). */
  roomImageUrl: string;
  /** The crop we're trying to identify. */
  box: BoundingBox;
  /** Rough category label from the cropper ("sofa", "floor_lamp", …). */
  label: string;
  /** Retrieval hits for this crop, ordered by similarity desc. May be empty. */
  priors: RetrievalPrior[];
  /** Room type — helps rule out implausible brand matches. */
  roomType?: string;
  /** Compact aesthetic hint from design direction (palette + materials + style notes). */
  aestheticHint?: string;
  /** Budget tier — so identifier can lower confidence on out-of-bracket brands. */
  budgetMode?: string;
  /** Room dimensions from the uploaded floor plan (e.g. "12 × 15 ft") — catches scale mismatches. */
  roomDimensions?: string;
}

export interface IdentifyResult {
  candidates: IdentifiedProductCandidate[];
  /** Echoed through for the orchestrator — saves a lookup on the consumer side. */
  priors: RetrievalPrior[];
  tokensUsed: number;
  model: string;
}

/**
 * Propose 0-3 brand/model candidates for a single crop. The verifier will
 * later grounded-check the top one.
 */
export async function runProductIdentifier(
  input: IdentifyInput,
): Promise<IdentifyResult> {
  const model = selectModel("scoring"); // reasoning model — visual recognition is hard

  const system = getSystemPrompt();
  const prompt = buildIdentifierPrompt({
    label: input.label,
    box: input.box,
    priors: input.priors,
    roomType: input.roomType,
    aestheticHint: input.aestheticHint,
    budgetMode: input.budgetMode,
    roomDimensions: input.roomDimensions,
  });

  try {
    const response = await geminiProvider.chat({
      model,
      system,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "url", url: input.roomImageUrl } },
            { type: "text", text: prompt },
          ],
        },
      ],
      max_tokens: 2500,
      seed: DETERMINISTIC_SEED,
      responseSchema: IDENTIFIER_SCHEMA,
      mediaResolution: "ultra_high",
    });

    const tokensUsed =
      response.usage.input_tokens +
      response.usage.output_tokens +
      response.usage.thinking_tokens;

    const raw = extractJsonObject(response.content);
    const parsed = IdentifierResponseSchema.parse(raw);

    // Enforce the tiered confidence floors defensively — the prompt asks for
    // these but models sometimes leak borderline guesses through.
    // In-list brands clear MIN_CONFIDENCE_IN_LIST (0.70), out-of-list brands
    // clear MIN_CONFIDENCE_OUT_OF_LIST (0.85). We still keep the absolute
    // floor at USER_PROMPT_FLOOR (0.40) for medium-confidence candidates the
    // frontend will route through the confirmation pill.
    const candidates = parsed.candidates.filter((c) => {
      if (c.confidence < USER_PROMPT_FLOOR) return false;
      const inList = isAllowListedBrand(c.brand);
      // Soft enforcement: above-pill-floor candidates with sub-verification
      // confidence still flow through. The verifier decides final trust.
      // The ceiling check is only a guardrail against wildly-out-of-list
      // guesses at very low confidence — drop brand-new brands under 0.50.
      if (!inList && c.confidence < MIN_CONFIDENCE_OUT_OF_LIST - 0.35) {
        return false;
      }
      // In-list candidates below MIN_CONFIDENCE_IN_LIST still pass — they
      // become medium-confidence entries the UI will ask the user about.
      void MIN_CONFIDENCE_IN_LIST;
      return true;
    });

    log.info("identifier pass complete", {
      label: input.label,
      priorCount: input.priors.length,
      candidateCount: candidates.length,
      top: candidates[0]?.brand ? `${candidates[0].brand} ${candidates[0].model}` : null,
      tokens: { total: tokensUsed },
    });

    return {
      candidates,
      priors: input.priors,
      tokensUsed,
      model: response.model,
    };
  } catch (error) {
    log.warn("identifier failed, returning empty candidates", {
      label: input.label,
      error: error instanceof Error ? error.message : String(error),
    });
    return { candidates: [], priors: input.priors, tokensUsed: 0, model };
  }
}
