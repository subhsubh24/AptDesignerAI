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
}

export interface IdentifyResult {
  candidates: IdentifiedProductCandidate[];
  /** Echoed through for the orchestrator — saves a lookup on the consumer side. */
  priors: RetrievalPrior[];
  tokensUsed: number;
  model: string;
}

function formatPriors(priors: RetrievalPrior[]): string {
  if (priors.length === 0) {
    return "(no retrieval matches — rely on visual reasoning alone)";
  }
  return priors
    .map(
      (p, i) =>
        `${i + 1}. ${p.brand} — ${p.model} (visual similarity: ${p.similarity.toFixed(2)})`,
    )
    .join("\n");
}

function formatBox(box: BoundingBox): string {
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  return `x=${pct(box.x)} y=${pct(box.y)} w=${pct(box.w)} h=${pct(box.h)}`;
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

  const prompt = `You are identifying a specific piece of FURNITURE in a room photo.

## THE PIECE
- Rough category: ${input.label}
- Bounding box in the photo (normalized, top-left origin): ${formatBox(input.box)}

## RETRIEVAL HINTS (visual nearest-neighbors from our product catalog)
${formatPriors(input.priors)}

These hints may be WRONG. The catalog only covers some brands. Treat them
as "here's what LOOKS similar" — not as ground truth.

## YOUR TASK
Return 0 to 3 \`candidates\`, ordered by confidence descending. For each:
  - \`brand\`: manufacturer (e.g. "West Elm", "Article", "Herman Miller")
  - \`model\`: product name (e.g. "Haven Sectional", "Ceni Sofa", "Eames Lounge")
  - \`variant\`: size/color variant if obvious, else null
  - \`category\`: one of ${"sofa|chair|table|bed|storage|lighting|rug|art|other".replace(/\|/g, " | ")}
  - \`confidence\`: 0..1 — be strict, see rules below
  - \`evidence\`: 1 sentence naming the specific visual cues (arm shape, leg
    profile, cushion construction, shade geometry, etc.) that drove the guess
  - \`distinguishing_features\`: 2-4 short phrases the verifier can grounded-check
  - \`bounding_box\`: echo \`${formatBox(input.box)}\` as { x, y, w, h } in [0,1]

## CONFIDENCE RULES — BE STRICT
- 0.85-1.0: you are nearly certain — distinctive silhouette, visible branding,
  or a perfect retrieval match.
- 0.65-0.85: strong visual match but brand is not visually distinctive.
- 0.40-0.65: plausible but could be a lookalike from another brand.
- Below 0.40: DO NOT emit — drop the candidate.

If nothing reaches 0.40, return \`"candidates": []\`. Empty is the CORRECT
answer for generic, custom, vintage, or low-visibility pieces.

Return ONLY JSON.`;

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

    // Drop anything below 0.4 defensively — the prompt asks for this but
    // models sometimes leak borderline guesses through.
    const candidates = parsed.candidates.filter((c) => c.confidence >= 0.4);

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
