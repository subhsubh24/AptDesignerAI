import { geminiProvider } from "@/lib/ai/gemini";
import { selectModel } from "@/lib/ai/models";
import { resolveImageBlocks } from "@/lib/ai/resolve-image";
import { extractJsonObject } from "@/lib/ai/extract-json";
import { DETERMINISTIC_SEED } from "@/lib/ai/determinism";
import { createLogger } from "@/lib/logging/logger";
import type { AIContentBlock } from "@/lib/ai/provider";
import type { AgentResult } from "./types";

const log = createLogger("mockup-verifier");

const MAX_VERIFICATION_ATTEMPTS = 2;

export interface MockupVerification {
  matches_room: boolean;
  confidence: number;
  issues: {
    walls?: string;
    flooring?: string;
    windows?: string;
    lighting?: string;
    proportions?: string;
    furniture_placement?: string;
  };
  overall_assessment: string;
  correction_instructions?: string;
}

export interface MockupVerificationResult {
  verified: boolean;
  attempts: number;
  finalVerification: MockupVerification | null;
  finalImageData: string;
  finalImageMimeType?: string;
}

/**
 * Vision-based comparison: does the generated mockup look like the original
 * room photos with new furniture added?
 *
 * Sends original room photos + generated mockup to the text model and asks
 * for a structured comparison on walls, flooring, windows, lighting,
 * proportions. Returns pass/fail with detailed issues.
 */
export async function verifyMockupImage(
  generatedImageBase64: string,
  generatedMimeType: string,
  roomImageUrls: string[],
): Promise<AgentResult<MockupVerification>> {
  if (roomImageUrls.length === 0) {
    return { success: true, data: { matches_room: true, confidence: 0.5, issues: {}, overall_assessment: "No reference photos to compare against" } };
  }

  const model = selectModel("scoring");

  try {
    const content: AIContentBlock[] = [];

    content.push({
      type: "text",
      text: `ORIGINAL ROOM PHOTOS — these show the actual apartment. Study the walls, flooring, windows, ceiling, and room proportions carefully:`,
    });

    // Batch the (at most 4) reference photos, then interleave their numbered
    // captions. Index-preserving, so "Original photo 2" still names photo 2.
    const shownUrls = roomImageUrls.slice(0, 4);
    const shownBlocks = await resolveImageBlocks(shownUrls, { preferFilesApi: true });
    for (let i = 0; i < shownUrls.length; i++) {
      content.push({ type: "text", text: `Original photo ${i + 1}:` });
      content.push(shownBlocks[i]);
    }

    content.push({
      type: "text",
      text: `GENERATED MOCKUP — this should look like the same room above, but with new furniture placed in it:`,
    });

    content.push({
      type: "image",
      source: { type: "base64", data: generatedImageBase64, media_type: generatedMimeType },
    });

    content.push({
      type: "text",
      text: `Compare the generated mockup to the original room photos. The mockup should look like the SAME physical room — same walls, same floor, same windows, same proportions — just with different furniture.

Score each dimension and flag issues:
- walls: same color, texture, and finish?
- flooring: same material, color, and pattern?
- windows: same count, size, position on correct walls?
- lighting: consistent natural light direction from actual window positions?
- proportions: room shape and dimensions feel the same?
- furniture_placement: furniture at realistic scale, not floating or overlapping?

Return JSON:
{
  "matches_room": true/false (true if the room shell is recognizably the same apartment),
  "confidence": 0.0-1.0 (how confident you are in your assessment),
  "issues": {
    "walls": "description of mismatch" or null if fine,
    "flooring": "..." or null,
    "windows": "..." or null,
    "lighting": "..." or null,
    "proportions": "..." or null,
    "furniture_placement": "..." or null
  },
  "overall_assessment": "one sentence summary",
  "correction_instructions": "specific instructions for regeneration if matches_room is false, null if it matches"
}`,
    });

    const response = await geminiProvider.chat({
      model,
      system: "You are an expert interior design photographer. Compare room mockups against reference photos for architectural accuracy. Be strict about walls, floors, and windows matching. Furniture style differences are expected — you are only checking that the ROOM SHELL matches.",
      messages: [{ role: "user", content }],
      max_tokens: 64000,
      seed: DETERMINISTIC_SEED,
      responseMimeType: "application/json",
      thinkingConfig: { thinkingLevel: "low" },
    });

    const result = extractJsonObject<MockupVerification>(response.content);
    return { success: true, data: result, tokensUsed: response.usage.input_tokens + response.usage.output_tokens + response.usage.thinking_tokens, model: response.model };
  } catch (error) {
    log.warn("Mockup verification failed — passing through", { error: error instanceof Error ? error.message : String(error) });
    return { success: false, error: error instanceof Error ? error.message : "Verification failed" };
  }
}

/**
 * Generate a mockup image with self-correction. After initial generation,
 * verifies the result against original room photos. If the mockup doesn't
 * match the room shell, regenerates with correction instructions appended
 * to the prompt. Retries up to MAX_VERIFICATION_ATTEMPTS times.
 *
 * Fails open: if verification itself errors, returns the original image.
 */
export async function generateWithVerification(opts: {
  generateFn: (prompt: string) => Promise<AgentResult<{ image_url: string; image_mime_type?: string; prompt_used: string; provider: string }>>;
  originalPrompt: string;
  roomImageUrls: string[];
  /**
   * If true, skip the verify→regenerate loop and return the first generated
   * image. Use for non-final previews (e.g., pre-search "imagination" mockup)
   * where strict room-shell accuracy isn't worth the latency.
   */
  skipVerification?: boolean;
}): Promise<MockupVerificationResult> {
  let currentPrompt = opts.originalPrompt;
  let lastImageData = "";
  let lastMimeType: string | undefined;
  let lastVerification: MockupVerification | null = null;

  for (let attempt = 1; attempt <= MAX_VERIFICATION_ATTEMPTS + 1; attempt++) {
    const imageResult = await opts.generateFn(currentPrompt);

    if (!imageResult.success || !imageResult.data) {
      if (attempt === 1) {
        return { verified: false, attempts: attempt, finalVerification: null, finalImageData: "", finalImageMimeType: undefined };
      }
      break;
    }

    lastImageData = imageResult.data.image_url;
    lastMimeType = imageResult.data.image_mime_type;

    if (opts.skipVerification || opts.roomImageUrls.length === 0) {
      return { verified: true, attempts: attempt, finalVerification: null, finalImageData: lastImageData, finalImageMimeType: lastMimeType };
    }

    const verification = await verifyMockupImage(
      lastImageData,
      lastMimeType || "image/png",
      opts.roomImageUrls,
    );

    if (!verification.success || !verification.data) {
      log.warn("Verification call failed — accepting image as-is", { attempt });
      return { verified: true, attempts: attempt, finalVerification: null, finalImageData: lastImageData, finalImageMimeType: lastMimeType };
    }

    lastVerification = verification.data;

    if (verification.data.matches_room) {
      log.info("Mockup verified — room shell matches", {
        attempt,
        confidence: verification.data.confidence,
      });
      return { verified: true, attempts: attempt, finalVerification: verification.data, finalImageData: lastImageData, finalImageMimeType: lastMimeType };
    }

    if (attempt > MAX_VERIFICATION_ATTEMPTS) {
      log.warn("Mockup verification failed after max attempts — accepting best effort", {
        attempts: attempt,
        issues: verification.data.issues,
      });
      break;
    }

    log.warn("Mockup verification failed — regenerating with corrections", {
      attempt,
      issues: verification.data.issues,
      corrections: verification.data.correction_instructions,
    });

    const corrections = verification.data.correction_instructions || Object.values(verification.data.issues).filter(Boolean).join("; ");
    currentPrompt = `${opts.originalPrompt}\n\nCRITICAL CORRECTIONS FROM PREVIOUS ATTEMPT (the previous render did NOT match the room):\n${corrections}\n\nFix these issues. The room shell (walls, floor, windows, ceiling) must exactly match the reference photos.`;
  }

  return {
    verified: false,
    attempts: MAX_VERIFICATION_ATTEMPTS + 1,
    finalVerification: lastVerification,
    finalImageData: lastImageData,
    finalImageMimeType: lastMimeType,
  };
}
