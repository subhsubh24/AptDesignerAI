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
  droppedEntries?: string[],
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
    ...(Array.isArray(droppedEntries) ? droppedEntries : []),
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
      ? `being replaced by ${newTitle.length > 80 ? newTitle.slice(0, 77) + "..." : newTitle}`
      : `being replaced with the new ${match.display} below`;
    inferred.push({
      entry: `Existing ${match.display} — ${reason}`,
      category: cat,
      matchedAlias,
    });
  }

  if (inferred.length > 0) {
    log.info("Inferred replacement entries from Pass B / room gap", {
      count: inferred.length,
      categories: inferred.map((i) => i.category),
    });
  }

  return inferred;
}
