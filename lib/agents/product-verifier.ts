/**
 * Product verifier — takes the identifier's top candidate for a crop and does
 * a grounded Google Search + page-read to confirm (or reject) it.
 *
 * Also enriches the entry with canonical product data we want stored alongside:
 * dimensions, materials, colors, price range, canonical product URL, and a
 * canonical product image URL. If verification fails, we RETURN the candidate
 * unenriched with `verified=false` so the caller can still show "possible
 * match" UI — we never silently drop.
 */

import { geminiProvider } from "@/lib/ai/gemini";
import { selectModel } from "@/lib/ai/models";
import { getSystemPrompt } from "@/lib/prompts/system";
import { extractJsonObject } from "@/lib/ai/extract-json";
import { DETERMINISTIC_SEED } from "@/lib/ai/determinism";
import { createLogger } from "@/lib/logging/logger";
import { buildVerifierPrompt } from "@/lib/prompts/product-identification";
import {
  IdentifiedProductEnrichedSchema,
  type IdentifiedProductCandidate,
  type IdentifiedProductEnriched,
  type RetrievalPrior,
} from "@/lib/types/schemas";
import { z } from "zod";

const log = createLogger("product-verifier");

/** Minimum grounded match score to flip `verified` true. */
const MATCH_THRESHOLD = 0.75;

/**
 * Enrichment schema — stricter than VerifierResponseSchema and adds the
 * canonical data we want to store alongside the identification.
 */
const EnrichedVerifierSchema = z.object({
  verified: z.boolean(),
  match_score: z.coerce.number().min(0).max(1),
  mismatch_notes: z.array(z.string()).default([]),
  canonical_url: z.string().nullable().optional(),
  source_urls: z.array(z.string()).default([]),
  dimensions: z
    .object({
      width_in: z.coerce.number().optional(),
      depth_in: z.coerce.number().optional(),
      height_in: z.coerce.number().optional(),
    })
    .nullable()
    .optional(),
  materials: z.array(z.string()).default([]),
  colors: z.array(z.string()).default([]),
  price_range: z
    .object({
      min: z.coerce.number(),
      max: z.coerce.number(),
      currency: z.string().default("USD"),
    })
    .nullable()
    .optional(),
  image_url: z.string().nullable().optional(),
});

export interface VerifyInput {
  candidate: IdentifiedProductCandidate;
  /** Same room photo the crop came from — shown to the model for side-by-side check. */
  roomImageUrl: string;
  /** The cropper's `source_image_url` — echoed onto the enriched result. */
  sourceImageUrl: string;
  /** Full set of priors, copied through onto the enriched result. */
  priors: RetrievalPrior[];
  /** Room type — sanity check against the candidate brand's typical usage. */
  roomType?: string;
  /** Compact aesthetic hint from design direction — flag realism mismatches. */
  aestheticHint?: string;
  /** Budget tier — flags out-of-bracket identifications. */
  budgetMode?: string;
  /** Room dimensions from the uploaded floor plan — catches scale mismatches. */
  roomDimensions?: string;
}

export interface VerifyResult {
  enriched: IdentifiedProductEnriched;
  tokensUsed: number;
  model: string;
}

/**
 * Ask the model to (a) grounded-search for the candidate on the brand's site
 * and major retailers, (b) compare the room photo to the canonical product
 * image, and (c) return a structured verification + enrichment.
 *
 * Gemini can't combine grounding + responseSchema in all cases — when it
 * can't, we fall back to parsing free-text JSON. This mirrors shopping-researcher.ts.
 */
export async function runProductVerifier(input: VerifyInput): Promise<VerifyResult> {
  const model = selectModel("validation"); // grounding quality matters, use reasoning tier
  const system = getSystemPrompt();

  const { candidate } = input;
  const prompt = buildVerifierPrompt({
    candidate,
    matchThreshold: MATCH_THRESHOLD,
    roomType: input.roomType,
    aestheticHint: input.aestheticHint,
    budgetMode: input.budgetMode,
    roomDimensions: input.roomDimensions,
  });

  let content = "";
  let tokensUsed = 0;
  let respModel = model;

  try {
    // Combined grounding + structured output first (same pattern as shopping-researcher.ts).
    let response;
    try {
      response = await geminiProvider.chat({
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
        max_tokens: 10000,
        seed: DETERMINISTIC_SEED,
        tools: [{ googleSearch: {} as Record<string, never> }],
        responseMimeType: "application/json",
      });
    } catch (schemaErr) {
      log.warn("verifier structured+grounding call failed, falling back to text", {
        error: schemaErr instanceof Error ? schemaErr.message : String(schemaErr),
      });
      response = await geminiProvider.chat({
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
        max_tokens: 10000,
        seed: DETERMINISTIC_SEED,
        tools: [{ googleSearch: {} as Record<string, never> }],
      });
    }
    content = response.content;
    tokensUsed =
      response.usage.input_tokens +
      response.usage.output_tokens +
      response.usage.thinking_tokens;
    respModel = response.model;

    // Opportunistically pull source_urls from groundingMetadata if the model
    // forgets to populate it.
    const groundingSources =
      response.groundingMetadata?.sources.map((s) => s.uri).filter(Boolean) ?? [];

    const raw = extractJsonObject(content);
    const parsed = EnrichedVerifierSchema.parse(raw);

    const finalSources = parsed.source_urls.length > 0 ? parsed.source_urls : groundingSources;

    const enriched: IdentifiedProductEnriched = IdentifiedProductEnrichedSchema.parse({
      brand: candidate.brand,
      model: candidate.model,
      variant: candidate.variant ?? null,
      category: candidate.category,
      // Once the verifier has actually inspected the source, its match_score
      // is the authoritative signal — the prior identifier confidence was a
      // guess. Previously we took the max of the two, which meant a lucky
      // high prior could override a moderate verifier result and leave us
      // over-confident on borderline matches. When the verifier disagrees
      // (verified=false), take the lower of the two to bias toward caution.
      confidence: parsed.verified
        ? parsed.match_score
        : Math.min(candidate.confidence, parsed.match_score),
      verified: parsed.verified && parsed.match_score >= MATCH_THRESHOLD,
      user_confirmed: null,
      canonical_url: parsed.canonical_url ?? null,
      source_urls: finalSources.slice(0, 5),
      dimensions: parsed.dimensions ?? null,
      materials: parsed.materials,
      colors: parsed.colors,
      price_range: parsed.price_range ?? null,
      image_url: parsed.image_url ?? null,
      evidence: candidate.evidence,
      distinguishing_features: candidate.distinguishing_features,
      retrieval_priors: input.priors,
      correction_source: "model",
      embedding_written_back: false,
      bounding_box: candidate.bounding_box ?? null,
      source_image_url: input.sourceImageUrl,
    });

    log.info("verifier pass complete", {
      brand: candidate.brand,
      model: candidate.model,
      verified: enriched.verified,
      matchScore: parsed.match_score,
      tokens: { total: tokensUsed },
    });

    return { enriched, tokensUsed, model: respModel };
  } catch (error) {
    log.warn("verifier failed, returning unverified candidate", {
      brand: candidate.brand,
      model: candidate.model,
      error: error instanceof Error ? error.message : String(error),
    });
    // Preserve schema guarantees by building the minimal valid enriched entry.
    const enriched: IdentifiedProductEnriched = IdentifiedProductEnrichedSchema.parse({
      brand: candidate.brand,
      model: candidate.model,
      variant: candidate.variant ?? null,
      category: candidate.category,
      confidence: candidate.confidence,
      verified: false,
      user_confirmed: null,
      canonical_url: null,
      source_urls: [],
      dimensions: null,
      materials: [],
      colors: [],
      price_range: null,
      image_url: null,
      evidence: candidate.evidence,
      distinguishing_features: candidate.distinguishing_features,
      retrieval_priors: input.priors,
      correction_source: "model",
      embedding_written_back: false,
      bounding_box: candidate.bounding_box ?? null,
      source_image_url: input.sourceImageUrl,
    });
    return { enriched, tokensUsed, model };
  }
}
