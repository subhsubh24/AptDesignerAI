/**
 * Replacement inference: if Pass B's shopping list contains a major furniture
 * category that ALREADY exists in the room AND the user didn't say to keep it,
 * the existing version is implicitly being replaced. Add a what_should_go
 * stub for it so the Replace section reflects what's actually happening.
 *
 * WHY THIS EXISTS:
 * Pass A produces what_should_go from photos but is sometimes too vague
 * ("generic rental furniture", "general clutter") — those vague entries get
 * correctly filtered by the cleanup steps, leaving an empty Replace section.
 * Meanwhile Pass B is buying a brand new sofa, coffee table, and media
 * console — that's a replacement signal. This step makes that signal
 * explicit in what_should_go.
 *
 * SAFETY:
 * - Only fires when the room demonstrably has the category (Pass A's text
 *   describes it in summary / design_direction / spatial_layout / what_works).
 * - Skips categories the user explicitly wants to keep (with synonyms).
 * - Skips categories already represented in what_should_go or what_works.
 * - Uses generic display labels — never invents specific item details.
 */

import type { AIContentBlock } from "@/lib/ai/provider";
import { geminiProvider } from "@/lib/ai/gemini";
import { selectModel } from "@/lib/ai/models";
import { extractJsonObject } from "@/lib/ai/extract-json";
import { DETERMINISTIC_SEED } from "@/lib/ai/determinism";
import { createLogger } from "@/lib/logging/logger";

const log = createLogger("infer-replacements");

const REPLACEABLE_CATEGORIES: Array<{ cats: readonly string[]; display: string; aliases: readonly string[] }> = [
  { cats: ["sofa"], display: "sofa", aliases: ["sofa", "couch", "sectional", "loveseat", "settee"] },
  { cats: ["coffee_table"], display: "coffee table", aliases: ["coffee table"] },
  { cats: ["dining_table"], display: "dining table", aliases: ["dining table"] },
  { cats: ["media_console", "tv_stand", "tv_console", "entertainment_center"], display: "media console / TV stand", aliases: ["media console", "tv stand", "tv console", "entertainment center"] },
  { cats: ["area_rug"], display: "area rug", aliases: ["rug", "carpet", "area rug"] },
  { cats: ["accent_chair", "armchair"], display: "accent chair", aliases: ["accent chair", "armchair"] },
  { cats: ["dining_chairs"], display: "dining chairs", aliases: ["dining chair"] },
  { cats: ["dresser", "bureau"], display: "dresser", aliases: ["dresser", "bureau"] },
  { cats: ["nightstand"], display: "nightstand", aliases: ["nightstand", "bedside"] },
  { cats: ["bed_frame", "bed"], display: "bed frame", aliases: ["bed frame", "headboard"] },
  { cats: ["desk"], display: "desk", aliases: ["desk", "workspace"] },
  { cats: ["ottoman"], display: "ottoman", aliases: ["ottoman", "footstool", "pouf"] },
];

interface AnalysisShape {
  summary?: string;
  design_direction?: string;
  spatial_layout?: string;
  what_works?: string[];
  what_should_go?: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- shape from Pass B
  what_it_needs?: Array<Record<string, any>>;
}

export interface InferredReplacement {
  entry: string;
  category: string;
  matchedAlias: string;
}

export function inferReplacementsFromGap(
  analysis: AnalysisShape,
  keepItems: string[],
): InferredReplacement[] {
  if (!Array.isArray(analysis.what_it_needs) || analysis.what_it_needs.length === 0) {
    return [];
  }

  // The room context — anywhere Pass A might have mentioned existing furniture.
  // Include what_should_go: items there are definitely in the room (being removed).
  const roomContext = [
    String(analysis.summary || ""),
    String(analysis.design_direction || ""),
    String(analysis.spatial_layout || ""),
    ...(Array.isArray(analysis.what_works) ? (analysis.what_works as string[]) : []),
    ...(Array.isArray(analysis.what_should_go) ? (analysis.what_should_go as string[]) : []),
  ].join(" ").toLowerCase();

  const removeText = (Array.isArray(analysis.what_should_go) ? (analysis.what_should_go as string[]).join(" ") : "").toLowerCase();
  const keepText = keepItems.join(" ").toLowerCase();

  // For what_works, only check each entry's HEAD (before the em-dash) to avoid
  // false positives from placement context like "lamp — behind the sofa"
  // matching "sofa" and suppressing sofa replacement inference.
  const worksHeads = (Array.isArray(analysis.what_works) ? (analysis.what_works as string[]) : [])
    .map((e) => {
      const sep = e.match(/\s[—–-]\s|:\s/);
      return (sep ? e.slice(0, sep.index) : e).toLowerCase();
    });

  const inferred: InferredReplacement[] = [];
  const seenCategories = new Set<string>();

  for (const need of analysis.what_it_needs) {
    const cat = String(need.category || "").toLowerCase();
    if (!cat || seenCategories.has(cat)) continue;

    const match = REPLACEABLE_CATEGORIES.find((r) => r.cats.includes(cat));
    if (!match) continue;

    seenCategories.add(cat);

    // Does the room actually have this category? Pass A must have mentioned it.
    const matchedAlias = match.aliases.find((a) => roomContext.includes(a));
    if (!matchedAlias) continue;

    // Did the user explicitly say to keep this category?
    const userKeepsIt = match.aliases.some((a) => keepText.includes(a));
    if (userKeepsIt) continue;

    // Is it already represented in what_should_go or what_works?
    const alreadyInRemove = match.aliases.some((a) => removeText.includes(a));
    const alreadyInWorks = worksHeads.some((head) =>
      match.aliases.some((a) => head.includes(a)),
    );
    if (alreadyInRemove || alreadyInWorks) continue;

    const newTitle = String(need.search_title || "").trim();
    const reason = newTitle
      ? `being replaced by ${newTitle}`
      : `being replaced with the new ${match.display} below`;
    inferred.push({
      entry: `Existing ${match.display} — ${reason}`,
      category: cat,
      matchedAlias,
    });
  }

  if (inferred.length > 0) {
    log.info("Inferred replacement entries from Pass B / room gap (deterministic fallback)", {
      count: inferred.length,
      categories: inferred.map((i) => i.category),
    });
  }

  return inferred;
}

interface LLMReplacementVerdict {
  category: string;
  existing_item_visible: boolean;
  existing_description: string;
  reason: string;
}

interface LLMReplacementOutput {
  verdicts: LLMReplacementVerdict[];
}

export async function inferReplacementsFromPhotos(
  analysis: AnalysisShape,
  keepItems: string[],
  roomImageUrls: string[],
  roomType: string,
): Promise<InferredReplacement[]> {
  if (!Array.isArray(analysis.what_it_needs) || analysis.what_it_needs.length === 0) {
    return [];
  }

  if (roomImageUrls.length === 0) {
    log.info("No room photos — falling back to deterministic inference");
    return inferReplacementsFromGap(analysis, keepItems);
  }

  const seenCategories = new Set<string>();
  const candidateNeeds: Array<{ category: string; search_title: string; display: string }> = [];
  for (const need of analysis.what_it_needs) {
    const cat = String(need.category || "").toLowerCase();
    if (!cat || seenCategories.has(cat)) continue;
    const match = REPLACEABLE_CATEGORIES.find((r) => r.cats.includes(cat));
    if (!match) continue;
    seenCategories.add(cat);

    const keepText = keepItems.join(" ").toLowerCase();
    const userKeepsIt = match.aliases.some((a) => keepText.includes(a));
    if (userKeepsIt) continue;

    const removeText = (Array.isArray(analysis.what_should_go) ? (analysis.what_should_go as string[]).join(" ") : "").toLowerCase();
    const alreadyInRemove = match.aliases.some((a) => removeText.includes(a));
    if (alreadyInRemove) continue;

    candidateNeeds.push({
      category: cat,
      search_title: String(need.search_title || ""),
      display: match.display,
    });
  }

  if (candidateNeeds.length === 0) return [];

  try {
    const model = selectModel("scoring");

    const promptText = `You are verifying which furniture items in a ${roomType} are being REPLACED by new purchases.

SHOPPING LIST (new items being purchased):
${candidateNeeds.map((n, i) => `${i + 1}. Category: ${n.category} — "${n.search_title}"`).join("\n")}

YOUR JOB
========
For EACH item in the shopping list above, look at the room photos and determine:
Is there an EXISTING version of this furniture type currently visible in the room?

If yes → the new purchase is REPLACING the existing item.
If no → the new purchase is being ADDED (no existing item to replace).

Rules:
- Focus on the FURNITURE TYPE, not color/material/style. A grey fabric sofa is the same type as a leather sofa.
- Be specific about what you see: "dark grey fabric sectional visible against the back wall."
- Return existing_item_visible: false if you genuinely cannot see that furniture type in ANY of the photos.
- When uncertain, return false — we only want to flag clear replacements.
- Furniture synonyms count: "sectional" = "sofa" = "couch"; "media console" = "TV stand"; "rug" = "carpet"; etc.

OUTPUT FORMAT (strict JSON, no prose):
{
  "verdicts": [
    {
      "category": "<category from shopping list>",
      "existing_item_visible": true|false,
      "existing_description": "<brief description of the existing item you see, or empty string if not visible>",
      "reason": "<one sentence: where you saw it, or why it's not present>"
    }
  ]
}

Return one verdict per shopping list item, in the same order.`;

    const content: AIContentBlock[] = [{ type: "text", text: promptText }];
    for (const url of roomImageUrls) {
      content.push({ type: "image", source: { type: "url", url } });
    }

    const response = await geminiProvider.chat({
      model,
      system: "You are a visual verification agent. Your job is to look at room photos and identify which existing furniture items are being replaced by new purchases. Be accurate — only confirm items you can clearly see.",
      messages: [{ role: "user", content }],
      max_tokens: 4096,
      seed: DETERMINISTIC_SEED,
      responseMimeType: "application/json",
      thinkingConfig: { thinkingLevel: "low" },
    });

    const parsed = extractJsonObject<LLMReplacementOutput>(response.content);
    if (!parsed || !Array.isArray(parsed.verdicts)) {
      log.warn("LLM replacement inference returned unparseable JSON — falling back to deterministic");
      return inferReplacementsFromGap(analysis, keepItems);
    }

    const verdictByCategory = new Map<string, LLMReplacementVerdict>();
    for (const v of parsed.verdicts) {
      if (typeof v.category === "string") {
        verdictByCategory.set(v.category.toLowerCase(), v);
      }
    }

    const inferred: InferredReplacement[] = [];
    for (const candidate of candidateNeeds) {
      const verdict = verdictByCategory.get(candidate.category);
      if (!verdict || !verdict.existing_item_visible) continue;

      const existingDesc = (verdict.existing_description || "").trim();
      const newTitle = candidate.search_title.trim();
      const entryHead = existingDesc
        ? `Existing ${candidate.display} (${existingDesc})`
        : `Existing ${candidate.display}`;
      const reason = newTitle
        ? `being replaced by ${newTitle}`
        : `being replaced with the new ${candidate.display} below`;

      inferred.push({
        entry: `${entryHead} — ${reason}`,
        category: candidate.category,
        matchedAlias: candidate.display,
      });
    }

    if (inferred.length > 0) {
      log.info("LLM-verified replacement entries from room photos", {
        count: inferred.length,
        categories: inferred.map((i) => i.category),
      });
    }

    return inferred;
  } catch (err) {
    log.warn("LLM replacement inference threw — falling back to deterministic", {
      error: err instanceof Error ? err.message : String(err),
    });
    return inferReplacementsFromGap(analysis, keepItems);
  }
}
