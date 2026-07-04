/**
 * Recorded-provider ("cassette") tier for the AI pipeline.
 *
 * The core product journey — photo → understand → diagnose → source → mockup —
 * ends in a REAL generated image. In test/CI there are no live LLM keys, so we
 * cannot call Gemini/DeepSeek for real. A cassette is a deterministic,
 * in-memory {@link AIProvider} that returns canned-but-schema-valid responses
 * per pipeline stage, so the actual agent code (prompt assembly, JSON parsing,
 * image extraction, defensive field mapping) runs end-to-end against a real
 * `AIProvider.chat()` surface and produces a REAL, decodable image — exactly
 * the money-path assertion the functional-reality gate needs, but hermetic.
 *
 * Dispatch is by request SHAPE (the only signal `chat()` receives), matched
 * against an ordered stage table:
 *   - `responseModalities` includes "Image"  → an image stage → returns
 *     {@link AIResponse.imageData} carrying a real (tiny, deterministic) PNG.
 *   - `responseMimeType === "application/json"` → a structured text stage →
 *     returns a stage-appropriate JSON body in `content`.
 *
 * Unmatched requests THROW (fail-loud): a cassette used in a test must be told
 * about every stage the code under test exercises — a silent generic fallback
 * would mask a real wiring change. Extend {@link STAGE_CASSETTES} (or pass
 * `overrides` to {@link createCassetteProvider}) when a new stage is driven.
 *
 * This module is provider-shaped and side-effect-free; it does NOT read env or
 * self-activate. Wiring it into the served app (gated so it can NEVER run in
 * production) is a separate, deliberate step.
 */

import type { AIProvider, AIResponse } from "./provider";

/** The single argument object accepted by {@link AIProvider.chat}. */
export type ChatParams = Parameters<AIProvider["chat"]>[0];

/**
 * A real 1×1 PNG (valid signature + IHDR + IDAT + IEND), base64-encoded.
 * A cassette image is canned by definition; what matters is that it is REAL,
 * decodable image bytes the pipeline can extract and pass through — proving the
 * render wiring, not a placeholder string. Consumers can decode this and assert
 * the PNG magic number + parse non-zero dimensions from the IHDR.
 */
export const CASSETTE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

/** Zero-cost usage block so recorded responses don't perturb cost accounting. */
function zeroUsage(): AIResponse["usage"] {
  return { input_tokens: 0, output_tokens: 0, thinking_tokens: 0 };
}

/** A recorded response for a matched pipeline stage. */
export interface StageCassette {
  /** Human-readable stage id, surfaced in the "no cassette matched" error. */
  id: string;
  /** True when this cassette should answer the given request shape. */
  match: (params: ChatParams) => boolean;
  /** The deterministic response to return for a matched request. */
  respond: (params: ChatParams) => AIResponse;
}

/** The deterministic mockup-prompt body ({@link MockupPromptResult} shape). */
const MOCKUP_PROMPT_BODY = {
  prompt:
    "Editorial wide-angle photograph of a warm modern living room: a cognac " +
    "leather sofa on the window wall, a low oak coffee table centered on a " +
    "wool rug, matte-black floor lamp in the reading corner, preserving the " +
    "room's existing greige walls, oak flooring, and left-hand window light.",
  negative_prompt:
    "no white walls, no showroom staging, no mirrored layout, no CGI sheen",
  style_notes: "Warm modern / Japandi-adjacent; natural materials, low contrast",
};

/**
 * Built-in stage table covering the render pipeline (mockup prompt + image).
 * Ordered most-specific first. Image is checked before JSON because an image
 * stage may also set a JSON-ish mime; the modality flag is the stronger signal.
 */
export const STAGE_CASSETTES: StageCassette[] = [
  {
    id: "mockup_image",
    match: (p) =>
      Array.isArray(p.responseModalities) &&
      p.responseModalities.some((m) => m.toLowerCase() === "image"),
    respond: () => ({
      content: "",
      model: "cassette-image",
      usage: zeroUsage(),
      imageData: { mimeType: "image/png", data: CASSETTE_PNG_BASE64 },
    }),
  },
  {
    id: "mockup_prompt",
    match: (p) => p.responseMimeType === "application/json",
    respond: () => ({
      content: JSON.stringify(MOCKUP_PROMPT_BODY),
      model: "cassette-json",
      usage: zeroUsage(),
    }),
  },
];

/**
 * Build a cassette {@link AIProvider}. Pass `overrides` to prepend extra stage
 * cassettes (matched before the built-ins) when a test drives a stage the
 * built-in table doesn't yet cover.
 */
export function createCassetteProvider(overrides: StageCassette[] = []): AIProvider {
  const table = [...overrides, ...STAGE_CASSETTES];
  return {
    async chat(params) {
      const hit = table.find((c) => c.match(params));
      if (!hit) {
        throw new Error(
          `[cassette] no recorded response for request (model=${String(
            params.model,
          )}, mime=${String(params.responseMimeType)}, modalities=${JSON.stringify(
            params.responseModalities,
          )}). Add a StageCassette for this pipeline stage.`,
        );
      }
      return hit.respond(params);
    },
  };
}

/** Default cassette covering the render pipeline stages. */
export const cassetteProvider: AIProvider = createCassetteProvider();
