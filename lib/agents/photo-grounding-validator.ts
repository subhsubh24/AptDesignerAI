/**
 * Photo-grounding validator — re-checks Pass A's what_should_go entries
 * against the actual room photos.
 *
 * WHY THIS EXISTS:
 * Pass A sees photos and produces what_should_go. Every downstream step
 * (reconciler, self-corrector, cross-reference filter) is text-only and
 * cannot distinguish real items from concrete-sounding hallucinations.
 * E.g. Pass A invents "Mismatched metal dining chairs" or "Plastic storage
 * bins under the console" because it expects them to exist in a living/dining
 * room — but the photos don't show them.
 *
 * This step makes ONE additional LLM call with the photos and the
 * what_should_go list, and asks: "for each entry, can you locate it in the
 * photos?" Conservative by default — keeps entries when the model is
 * uncertain. Fails open (returns original list) on error.
 *
 * SAFETY:
 * - Returns input unchanged on any error.
 * - Only drops entries the LLM explicitly says are NOT visible.
 * - Refuses to drop ALL entries (catches LLM misreads of the prompt).
 */
import type { AIContentBlock } from "@/lib/ai/provider";
import { geminiProvider } from "@/lib/ai/gemini";
import { selectModel } from "@/lib/ai/models";
import { extractJsonObject } from "@/lib/ai/extract-json";
import { DETERMINISTIC_SEED } from "@/lib/ai/determinism";
import { createLogger } from "@/lib/logging/logger";

const log = createLogger("photo-grounding-validator");

export interface PhotoGroundingResult {
  what_should_go: string[];
  dropped: Array<{ entry: string; reason: string }>;
  fellBack: boolean;
}

export interface WhatWorksGroundingResult {
  what_works: string[];
  dropped: Array<{ entry: string; reason: string }>;
  fellBack: boolean;
}

interface ValidatorOutput {
  verdicts: Array<{
    entry: string;
    visible: boolean;
    reason: string;
  }>;
}

/**
 * Validate each what_should_go entry against the room photos.
 *
 * @param whatShouldGo - List of strings from Pass A's what_should_go.
 * @param roomImageUrls - URLs of the target room's photos.
 * @param roomType - For prompt context.
 */
export async function verifyWhatShouldGoAgainstPhotos(
  whatShouldGo: string[],
  roomImageUrls: string[],
  roomType: string,
): Promise<PhotoGroundingResult> {
  const original = [...whatShouldGo];

  if (whatShouldGo.length === 0 || roomImageUrls.length === 0) {
    return { what_should_go: original, dropped: [], fellBack: false };
  }

  try {
    const model = selectModel("scoring");

    const promptText = `You are verifying that a list of items is actually visible in photos of a ${roomType}.

ITEMS TO VERIFY (each one was claimed to exist in the room):
${whatShouldGo.map((e, i) => `${i + 1}. ${e}`).join("\n")}

YOUR JOB
========
For EACH item above, look at the photos and determine: is this item actually visible in the photos?

Rules:
- Return visible: true if you can clearly locate the item in at least one photo.
- Return visible: false ONLY if you are confident the item is NOT in any of the photos.
- When uncertain (item could be partially obscured, in a corner you can't see clearly, or referenced abstractly), return visible: true. We are conservative — don't drop real items.
- Furniture synonyms count: a "sectional" matches "sofa" / "couch"; a "media console" matches "TV stand"; etc.
- Color/material descriptors don't have to match perfectly — focus on whether the OBJECT exists, not whether the description is exactly right.
- Items described abstractly ("loose clutter", "general visual noise") with no concrete object → visible: false (these are not specific objects).

OUTPUT FORMAT (strict JSON, no prose):
{
  "verdicts": [
    { "entry": "<exact entry text from above>", "visible": true|false, "reason": "<one short sentence: where you saw it, OR why you couldn't find it>" }
  ]
}

Return one verdict per input entry, in the same order.`;

    const content: AIContentBlock[] = [{ type: "text", text: promptText }];
    for (const url of roomImageUrls) {
      content.push({ type: "image", source: { type: "url", url } });
    }

    const response = await geminiProvider.chat({
      model,
      system:
        "You are a visual verification agent. Your only job is to check whether each named item is actually present in the provided room photos. Be conservative — keep items when uncertain.",
      messages: [{ role: "user", content }],
      max_tokens: 4096,
      seed: DETERMINISTIC_SEED,
      responseMimeType: "application/json",
      thinkingConfig: { thinkingLevel: "low" },
    });

    const parsed = extractJsonObject<ValidatorOutput>(response.content);
    if (!parsed || !Array.isArray(parsed.verdicts)) {
      log.warn("Photo-grounding validator returned unparseable JSON — falling back to original");
      return { what_should_go: original, dropped: [], fellBack: true };
    }

    // Build a verdict lookup, then walk the input in order to preserve ordering.
    const verdictByEntry = new Map<string, { visible: boolean; reason: string }>();
    for (const v of parsed.verdicts) {
      if (typeof v.entry === "string") {
        verdictByEntry.set(v.entry, {
          visible: v.visible !== false, // default to true (conservative)
          reason: typeof v.reason === "string" ? v.reason : "",
        });
      }
    }

    const kept: string[] = [];
    const dropped: Array<{ entry: string; reason: string }> = [];
    for (const entry of original) {
      const verdict = verdictByEntry.get(entry);
      if (!verdict || verdict.visible) {
        kept.push(entry);
      } else {
        dropped.push({ entry, reason: verdict.reason });
      }
    }

    // Refuse to drop EVERYTHING — almost always means LLM misread the prompt.
    if (original.length > 0 && kept.length === 0) {
      log.warn("Photo-grounding validator dropped ALL entries — falling back", {
        originalCount: original.length,
      });
      return { what_should_go: original, dropped: [], fellBack: true };
    }

    if (dropped.length > 0) {
      log.info("Photo-grounding validator dropped hallucinated entries", {
        droppedCount: dropped.length,
        keptCount: kept.length,
        dropped: dropped.map((d) => `${d.entry} (${d.reason})`),
      });
    }

    return { what_should_go: kept, dropped, fellBack: false };
  } catch (err) {
    log.warn("Photo-grounding validator threw — falling back to original", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { what_should_go: original, dropped: [], fellBack: true };
  }
}

/**
 * Validate each what_works entry against the room photos.
 *
 * Same approach as verifyWhatShouldGoAgainstPhotos but ALSO drops architectural
 * elements (roller shades, built-in flooring, walls, ceiling) because Keep
 * should only list movable furniture/decor — not parts of the building.
 *
 * Conservative defaults: keeps when uncertain, refuses to drop ALL, fails open.
 */
export async function verifyWhatWorksAgainstPhotos(
  whatWorks: string[],
  roomImageUrls: string[],
  roomType: string,
): Promise<WhatWorksGroundingResult> {
  const original = [...whatWorks];

  if (whatWorks.length === 0 || roomImageUrls.length === 0) {
    return { what_works: original, dropped: [], fellBack: false };
  }

  try {
    const model = selectModel("scoring");

    const promptText = `You are verifying that a list of items is actually visible in photos of a ${roomType}.

ITEMS TO VERIFY (each one was claimed to exist in the room):
${whatWorks.map((e, i) => `${i + 1}. ${e}`).join("\n")}

YOUR JOB
========
For EACH item above, decide whether it should be in a "Keep" list. Return visible: true ONLY if BOTH conditions hold:
  (a) The item is clearly visible in at least one photo, AND
  (b) The item is movable furniture or decor — NOT an architectural / built-in element.

Return visible: false if:
  - The item is NOT in any photo (hallucinated furniture).
  - The item IS visible but it's an architectural feature, not movable furniture.
    Examples: window shades / roller shades / blinds / curtains attached to the building, hardwood/LVP/laminate flooring, walls, ceiling, built-in cabinetry, kitchen counters, kitchen appliances, light fixtures hard-wired into the ceiling. These belong to the building, not the user's furniture set.

When uncertain about visibility (item could be partially obscured), return visible: true. We are conservative — don't drop real items.

Furniture synonyms count: a "sectional" matches "sofa" / "couch"; a "media console" matches "TV stand"; etc.
Color/material descriptors don't have to match perfectly — focus on whether the OBJECT exists, not whether the description is exactly right.

OUTPUT FORMAT (strict JSON, no prose):
{
  "verdicts": [
    { "entry": "<exact entry text from above>", "visible": true|false, "reason": "<one short sentence>" }
  ]
}

Return one verdict per input entry, in the same order.`;

    const content: AIContentBlock[] = [{ type: "text", text: promptText }];
    for (const url of roomImageUrls) {
      content.push({ type: "image", source: { type: "url", url } });
    }

    const response = await geminiProvider.chat({
      model,
      system:
        "You are a visual verification agent. Your only job is to check whether each named item is actually present in the provided room photos AND is movable furniture or decor (not architecture). Be conservative — keep items when uncertain.",
      messages: [{ role: "user", content }],
      max_tokens: 4096,
      seed: DETERMINISTIC_SEED,
      responseMimeType: "application/json",
      thinkingConfig: { thinkingLevel: "low" },
    });

    const parsed = extractJsonObject<ValidatorOutput>(response.content);
    if (!parsed || !Array.isArray(parsed.verdicts)) {
      log.warn("what_works grounding validator returned unparseable JSON — falling back to original");
      return { what_works: original, dropped: [], fellBack: true };
    }

    const verdictByEntry = new Map<string, { visible: boolean; reason: string }>();
    for (const v of parsed.verdicts) {
      if (typeof v.entry === "string") {
        verdictByEntry.set(v.entry, {
          visible: v.visible !== false,
          reason: typeof v.reason === "string" ? v.reason : "",
        });
      }
    }

    const kept: string[] = [];
    const dropped: Array<{ entry: string; reason: string }> = [];
    for (const entry of original) {
      const verdict = verdictByEntry.get(entry);
      if (!verdict || verdict.visible) {
        kept.push(entry);
      } else {
        dropped.push({ entry, reason: verdict.reason });
      }
    }

    if (original.length > 0 && kept.length === 0) {
      log.warn("what_works grounding validator dropped ALL entries — falling back", {
        originalCount: original.length,
      });
      return { what_works: original, dropped: [], fellBack: true };
    }

    if (dropped.length > 0) {
      log.info("what_works grounding validator dropped hallucinated/architectural entries", {
        droppedCount: dropped.length,
        keptCount: kept.length,
        dropped: dropped.map((d) => `${d.entry} (${d.reason})`),
      });
    }

    return { what_works: kept, dropped, fellBack: false };
  } catch (err) {
    log.warn("what_works grounding validator threw — falling back to original", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { what_works: original, dropped: [], fellBack: true };
  }
}
