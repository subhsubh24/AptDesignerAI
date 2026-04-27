/**
 * Post-analysis constraint validator for area-analysis output.
 *
 * Performs deterministic checks on area-analysis output to catch cases where
 * the LLM ignored explicit user instructions:
 * - Recommending items the user explicitly excluded (e.g., "don't need curtains")
 * - Recommending NEW versions of items the user wants to keep (e.g., "keep the arc lamp")
 * - Putting keep items in "what_should_go"
 * - Missing items the user explicitly requested
 *
 * This runs AFTER the LLM analysis, before the harmony validation loop.
 * It patches the output to fix violations rather than re-running the LLM.
 */

import { parseUserContext, type ParsedUserContext } from "@/lib/utils/parse-user-context";
import { createLogger } from "@/lib/logging/logger";

const log = createLogger("area-analysis-validator");

export interface AreaAnalysisValidationIssue {
  type: "exclusion_violation" | "keep_item_replaced" | "keep_item_in_remove" | "missing_request" | "architectural_in_keeps" | "invalid_remove";
  description: string;
  field: string;
  action: "removed" | "flagged";
}

export interface AreaAnalysisValidationResult {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic LLM analysis output
  patched: Record<string, any>;
  issues: AreaAnalysisValidationIssue[];
  wasModified: boolean;
}

interface AnalysisItem {
  category?: string;
  search_title?: string;
  description?: string;
  priority?: string;
  [key: string]: unknown;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/_/g, " ").replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

function mentionsAny(text: string, terms: string[]): string | null {
  const normalText = normalize(text);
  for (const term of terms) {
    const normalTerm = normalize(term);
    // For multi-word terms, check substring containment
    if (normalTerm.split(" ").length > 1) {
      if (normalText.includes(normalTerm)) return term;
    } else if (normalTerm.length >= 3) {
      // For single-word terms, require exact word match (not prefix)
      // to avoid "light" matching "lightweight", "lamp" matching "lampshade", etc.
      const words = normalText.split(" ");
      if (words.some((w) => w === normalTerm)) return term;
    }
  }
  return null;
}

/**
 * Expand exclusion terms with synonyms to catch LLM rephrasing.
 */
function expandExclusionTerms(exclusions: string[]): string[] {
  const synonymMap: Record<string, string[]> = {
    curtain: ["curtain", "curtains", "drapery", "drapes", "drape", "window treatment", "window treatments", "window panel", "window panels", "window covering", "window coverings", "window dressing", "sheer", "sheers", "curtain panel", "fabric panel", "linen panel"],
    blind: ["blind", "blinds", "shade", "shades", "roller shade"],
    rug: ["rug", "rugs", "carpet", "area rug"],
    lamp: ["lamp", "floor lamp", "arc lamp", "table lamp"],
    yoga: ["yoga mat", "yoga", "floor mat", "exercise mat"],
  };

  const expanded: string[] = [];
  for (const excl of exclusions) {
    expanded.push(excl);
    const normalExcl = normalize(excl);
    for (const [key, synonyms] of Object.entries(synonymMap)) {
      if (normalExcl.includes(key)) {
        expanded.push(...synonyms);
      }
    }
  }
  return [...new Set(expanded)];
}

/**
 * Extract category keywords from keep items for detecting replacement recommendations.
 */
/**
 * Strip location/context phrases from keep item text so we only match
 * the item itself, not where it is. For example:
 *   "black arc floor lamp behind the sofa" → "black arc floor lamp"
 *   "two lights next to the TV" → "two lights"
 */
function extractLocationContext(text: string): string {
  const match = text.match(/\b(?:behind|next to|near|beside|by|on top of|under|underneath|above|in front of|across from|against|along|around|at|between|in|on|over|to the (?:left|right) of)\b.*/i);
  return match ? normalize(match[0]) : "";
}

function stripLocationContext(text: string): string {
  return text
    .replace(/\b(?:behind|next to|near|beside|by|on top of|under|underneath|above|in front of|across from|against|along|around|at|between|in|on|over|to the (?:left|right) of|if possible)\b.*/gi, "")
    .replace(/\b(?:also)\b/gi, "")
    .trim();
}

const LOCATION_LANDMARKS: Record<string, string[]> = {
  tv: ["tv", "television", "media", "media console", "media wall", "entertainment"],
  sofa: ["sofa", "couch", "sectional", "loveseat"],
  bed: ["bed", "bedside", "headboard", "nightstand"],
  desk: ["desk", "workspace", "office"],
  window: ["window", "windowsill", "sill"],
  door: ["door", "entry", "entrance", "doorway"],
  dining: ["dining", "dining table", "kitchen"],
  bookshelf: ["bookshelf", "bookcase", "shelving", "shelf"],
  corner: ["corner"],
};

function locationsOverlap(keepLocation: string, proposedPlacement: string): boolean {
  if (!keepLocation || !proposedPlacement) return true; // no data → assume overlap (conservative)
  const normalPlacement = normalize(proposedPlacement);
  for (const [, landmarks] of Object.entries(LOCATION_LANDMARKS)) {
    const keepMentions = landmarks.some(l => keepLocation.includes(l));
    const proposedMentions = landmarks.some(l => normalPlacement.includes(l));
    if (keepMentions && proposedMentions) return true;
    if (keepMentions && !proposedMentions) return false;
  }
  return true; // no recognized landmark in keep → can't disambiguate
}

function extractKeepCategories(keepItems: string[]): Array<{ item: string; keywords: string[]; location: string }> {
  const categoryPatterns: Record<string, string[]> = {
    "floor lamp": ["floor_lamp", "floor lamp", "arc lamp", "standing lamp", "arc floor lamp", "tripod lamp", "tripod floor lamp", "tripod light"],
    "table lamp": ["table_lamp", "table lamp", "desk lamp", "accent lamp"],
    "sofa": ["sofa", "couch", "sectional"],
    "rug": ["area_rug", "rug", "area rug", "carpet"],
    "coffee table": ["coffee_table", "coffee table"],
    "dining table": ["dining_table", "dining table"],
    "bookshelf": ["bookshelf", "shelving", "bookcase"],
    "tv console": ["media_console", "tv console", "media console", "tv stand", "entertainment center"],
    "light": ["table_lamp", "table lamp", "lamp", "light stand", "sconce", "wall light", "accent light"],
  };

  return keepItems.map((item) => {
    const location = extractLocationContext(item);
    // Strip location context so "lamp behind the sofa" doesn't trigger "sofa" category
    const itemOnly = stripLocationContext(item);
    const normalItem = normalize(itemOnly);
    const keywords: string[] = [];
    for (const [, patterns] of Object.entries(categoryPatterns)) {
      if (patterns.some((p) => normalItem.includes(normalize(p)))) {
        keywords.push(...patterns);
      }
    }
    return { item, keywords: [...new Set(keywords)], location };
  });
}

export interface AreaAnalysisSemanticHints {
  expandedExclusions: string[] | null;
  keepItemCategories: Array<{ item: string; category_keywords: string[]; location_phrase: string }> | null;
  /** Items in what_works flagged as architectural by LLM (verbatim text) */
  architecturalInWorks: Set<string> | null;
  /** Items in what_should_go flagged as invalid (verbatim text) */
  invalidInRemove: Set<string> | null;
}

export async function validateAreaAnalysisAsync(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic LLM analysis output
  analysis: Record<string, any>,
  keepItems: string[],
  userContext?: string
): Promise<AreaAnalysisValidationResult> {
  const { parseUserContextAsync } = await import("@/lib/utils/parse-user-context");
  const { expandExclusionTermsLLM, extractKeepCategoriesLLM, classifyArchitecturalLLM, classifyInvalidRemoveLLM } = await import("@/lib/ai/semantic-extract");

  const parsed = userContext ? await parseUserContextAsync(userContext) : null;
  const allKeepItems = [...keepItems, ...(parsed?.additionalKeepItems || [])];
  const works = Array.isArray(analysis.what_works) ? (analysis.what_works as string[]) : [];
  const removes = Array.isArray(analysis.what_should_go) ? (analysis.what_should_go as string[]) : [];

  const [exp, kc, arch, inv] = await Promise.all([
    parsed?.exclusions?.length ? expandExclusionTermsLLM(parsed.exclusions).catch(() => null) : Promise.resolve(null),
    allKeepItems.length ? extractKeepCategoriesLLM(allKeepItems).catch(() => null) : Promise.resolve(null),
    works.length ? classifyArchitecturalLLM(works).catch(() => null) : Promise.resolve(null),
    removes.length ? classifyInvalidRemoveLLM(removes).catch(() => null) : Promise.resolve(null),
  ]);

  return validateAreaAnalysis(analysis, keepItems, userContext, parsed, {
    expandedExclusions: exp,
    keepItemCategories: kc,
    architecturalInWorks: arch,
    invalidInRemove: inv,
  });
}

export function validateAreaAnalysis(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic LLM analysis output
  analysis: Record<string, any>,
  keepItems: string[],
  userContext?: string,
  /** Optional pre-parsed context (LLM-enhanced). Falls back to regex parse when omitted. */
  preParsedContext?: ParsedUserContext | null,
  /** Optional LLM-computed semantic hints. Falls back to regex when omitted. */
  semanticHints?: AreaAnalysisSemanticHints | null,
): AreaAnalysisValidationResult {
  const issues: AreaAnalysisValidationIssue[] = [];
  const parsed = preParsedContext ?? (userContext ? parseUserContext(userContext) : null);

  // Deep clone to avoid mutating the original
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic LLM analysis output
  const patched: Record<string, any> = JSON.parse(JSON.stringify(analysis));

  // Merge keep items from both sources
  const allKeepItems = [
    ...keepItems,
    ...(parsed?.additionalKeepItems || []),
  ];

  // --- Check 0: Filter architectural features from what_works / invalid entries from what_should_go ---
  const ARCHITECTURAL_PATTERNS = [
    /\bflooring\b/i, /\bhardwood.{0,10}floor/i, /\blvp\b/i, /\bvinyl\s*plank/i, /\btile\s*floor/i,
    /\bcountertop/i, /\bquartz\b/i, /\bgranite\b/i, /\bmarble\s*counter/i,
    /\bcabinet(?:ry|s)?\b/i, /\bmillwork\b/i, /\bbuilt.?in\s*(?:shelv|cabinet|closet)/i,
    /\bappliance\s*(?:suite|package)?\b/i, /\bstainless\s*steel\s*appliance/i,
    /\bbacksplash\b/i, /\bpaint\s*color\b/i, /\bwall\s*(?:color|finish|paint)\b/i,
    /\bceiling\s*(?:height|fixture|fan)\b/i, /\bhvac\b/i, /\bvent\b/i,
  ];

  const INVALID_REMOVE_PATTERNS = [
    /^\s*lack\s+of\b/i, /^\s*no\s+(?!longer)\w+/i, /\babsence\b/i, /^\s*missing\b/i,
    /\bbuilder.?grade\s*(?:ceiling|flush|light|fixture)/i,
    /\bceiling\s*(?:light|fixture|fan|mount)/i, /\bflush\s*mount/i,
    /^\s*any\s+['"]/i, /^\s*any\s+(?:big|generic|matching)/i,
    /\bexposed\s+(?:\w+\s+)*(?:cord|cable|wire|wiring)s?\b/i,
    /\bwall\s*(?:outlet|socket|switch)\b/i,
  ];

  if (Array.isArray(patched.what_works)) {
    patched.what_works = patched.what_works.filter((item: string) => {
      const flagged = semanticHints?.architecturalInWorks
        ? semanticHints.architecturalInWorks.has(item)
        : ARCHITECTURAL_PATTERNS.some(p => p.test(item));
      if (flagged) {
        issues.push({
          type: "architectural_in_keeps",
          description: `Removed "${item}" from what_works — architectural feature, not movable furniture`,
          field: "what_works",
          action: "removed",
        });
        return false;
      }
      return true;
    });
  }

  if (Array.isArray(patched.what_should_go)) {
    patched.what_should_go = patched.what_should_go.filter((item: string) => {
      const flagged = semanticHints?.invalidInRemove
        ? semanticHints.invalidInRemove.has(item)
        : INVALID_REMOVE_PATTERNS.some(p => p.test(item));
      if (flagged) {
        issues.push({
          type: "invalid_remove",
          description: `Removed "${item}" from what_should_go — not a removable physical item`,
          field: "what_should_go",
          action: "removed",
        });
        return false;
      }
      return true;
    });
  }

  // --- Check 1: Exclusion violations in what_it_needs ---
  if (parsed?.exclusions && parsed.exclusions.length > 0) {
    const expandedExclusions = semanticHints?.expandedExclusions ?? expandExclusionTerms(parsed.exclusions);

    if (Array.isArray(patched.what_it_needs)) {
      const originalCount = patched.what_it_needs.length;
      patched.what_it_needs = patched.what_it_needs.filter((item: AnalysisItem) => {
        const searchable = `${item.category || ""} ${item.search_title || ""} ${item.description || ""}`;
        const match = mentionsAny(searchable, expandedExclusions);
        if (match) {
          issues.push({
            type: "exclusion_violation",
            description: `Removed "${item.search_title || item.category}" from what_it_needs — client explicitly excluded "${match}"`,
            field: "what_it_needs",
            action: "removed",
          });
          return false;
        }
        return true;
      });
      if (patched.what_it_needs.length < originalCount) {
        log.warn("Removed excluded items from what_it_needs", {
          removed: originalCount - patched.what_it_needs.length,
          exclusions: parsed.exclusions,
        });
      }
    }

    // Also check what_should_go — excluded items shouldn't be mentioned there either
    // (e.g., "yoga mat" shouldn't be in "what_should_go" if user said "ignore the yoga mat")
    if (Array.isArray(patched.what_should_go)) {
      patched.what_should_go = patched.what_should_go.filter((item: string) => {
        // Only remove if the exclusion reason is "ignore" (not "replace")
        const normalItem = normalize(item);
        for (const excl of parsed.exclusions) {
          const normalExcl = normalize(excl);
          if (normalItem.includes(normalExcl)) {
            // Check if user said "ignore" (don't mention) vs "don't need" (don't buy)
            const ignorePattern = /ignore|won'?t\s+be\s+there|not\s+there/i;
            if (ignorePattern.test(userContext || "")) {
              issues.push({
                type: "exclusion_violation",
                description: `Removed "${item}" from what_should_go — client said to ignore "${excl}"`,
                field: "what_should_go",
                action: "removed",
              });
              return false;
            }
          }
        }
        return true;
      });
    }
  }

  // --- Check 2: Keep-item violations ---
  // These are pure decor/accessory categories — they go ON top of kept furniture
  // (e.g., vases on a kept bookshelf), they never REPLACE it. Exempt them from
  // the keep_item_replaced check to avoid false positives.
  const DECOR_CATEGORIES = new Set([
    "vase", "candles", "candle", "books", "tray", "decorative_objects",
    "baskets", "frames", "throw_pillows", "throw_blanket", "plant",
    "wall_art", "wall_art_small", "mirror_small",
  ]);

  // Detect keep items where the user explicitly asks for decor/styling for the item.
  // e.g. "keep the bookshelf but add decor for it" → allow decor items that mention bookshelf.
  const DECOR_INTENT_PATTERN = /\b(?:decor|styling|style|accessori|decorat|ornament|display|arrange|organiz)/i;
  const DECOR_TITLE_PATTERN = /\b(?:decor|styling|style|vase|sculpture|candle|ornament|display|tray|basket|ceramic|brass|set|arrangement)\b/i;

  if (allKeepItems.length > 0) {
    const keepCategories = semanticHints?.keepItemCategories
      ? semanticHints.keepItemCategories.map((kc) => ({
          item: kc.item,
          keywords: kc.category_keywords,
          location: kc.location_phrase,
        }))
      : extractKeepCategories(allKeepItems);

    for (const { item, keywords, location } of keepCategories) {
      if (keywords.length === 0) continue;

      // If the user asked for decor/styling for this kept item, exempt items that are
      // clearly decorative accessories (by title), even if they share the category keyword.
      const userWantsDecorForItem = DECOR_INTENT_PATTERN.test(item);

      // Check if what_it_needs recommends a NEW item in the same category as a kept item
      if (Array.isArray(patched.what_it_needs)) {
        patched.what_it_needs = patched.what_it_needs.filter((rec: AnalysisItem) => {
          // Pure decor/accessory items complement kept furniture — never replace it
          if (DECOR_CATEGORIES.has((rec.category || "").toLowerCase())) return true;
          const recText = `${rec.category || ""} ${rec.search_title || ""}`;
          const match = mentionsAny(recText, keywords);
          if (match) {
            // If the user explicitly asked for decor for this item and the proposed
            // item's title indicates it's decorative (styling set, vase, etc.),
            // it's an accessory FOR the kept item, not a replacement.
            if (userWantsDecorForItem && DECOR_TITLE_PATTERN.test(rec.search_title || "")) {
              log.info("Keep-item keyword match but user requested decor for it — allowing", {
                keepItem: item,
                proposed: rec.search_title || rec.category,
              });
              return true;
            }
            // If the keep item has a known location (e.g. "next to the TV") and the
            // proposed item has a placement for a DIFFERENT location (e.g. "on the
            // coffee table"), it's not a conflict — it's a new item elsewhere.
            const proposedPlacement = String(rec.placement || "");
            if (location && proposedPlacement && !locationsOverlap(location, proposedPlacement)) {
              log.info("Keep-item keyword match but different location — allowing", {
                keepItem: item,
                keepLocation: location,
                proposed: rec.search_title || rec.category,
                proposedPlacement,
              });
              return true;
            }
            issues.push({
              type: "keep_item_replaced",
              description: `Removed "${rec.search_title || rec.category}" from what_it_needs — conflicts with kept item "${item}"`,
              field: "what_it_needs",
              action: "removed",
            });
            return false;
          }
          return true;
        });
      }

      // Check if what_should_go includes a kept item
      if (Array.isArray(patched.what_should_go)) {
        patched.what_should_go = patched.what_should_go.filter((goItem: string) => {
          const match = mentionsAny(goItem, [item, ...keywords]);
          if (match) {
            issues.push({
              type: "keep_item_in_remove",
              description: `Removed "${goItem}" from what_should_go — client wants to keep "${item}"`,
              field: "what_should_go",
              action: "removed",
            });
            return false;
          }
          return true;
        });
      }
    }
  }

  // --- Check 3: Missing explicit requests ---
  // Map short request phrases to likely furniture categories for auto-injection
  const requestCategoryMap: Record<string, string> = {
    "dining table": "dining_table",
    "dining chair": "dining_chairs",
    "dining chairs": "dining_chairs",
    "coffee table": "coffee_table",
    "side table": "side_table",
    "rug": "area_rug",
    "area rug": "area_rug",
    "plant": "plant",
    "plants": "plant",
    "lamp": "floor_lamp",
    "floor lamp": "floor_lamp",
    "bookshelf": "bookshelf",
    "curtains": "curtains",
    "throw pillows": "throw_pillows",
    "throw blanket": "throw_blanket",
    "wall art": "wall_art",
    "art": "wall_art",
    "mirror": "wall_art",
    "console table": "console_table",
    "storage": "storage_cabinet",
    "vase": "vase",
    "tray": "tray",
  };

  if (parsed?.explicitRequests && parsed.explicitRequests.length > 0) {
    for (const request of parsed.explicitRequests) {
      // Build search terms: the full request + any category keyword extracted from it
      const requestTerms = [request.item];
      const normalRequest = normalize(request.item);
      for (const [keyword] of Object.entries(requestCategoryMap)) {
        if (normalRequest.includes(keyword)) {
          requestTerms.push(keyword);
        }
      }
      const foundInNeeds = Array.isArray(patched.what_it_needs) && patched.what_it_needs.some(
        (item: AnalysisItem) => mentionsAny(`${item.category || ""} ${item.search_title || ""} ${item.description || ""}`, requestTerms)
      );

      if (!foundInNeeds) {
        // Try to detect a concrete furniture category from the request
        let detectedCategory: string | null = null;
        for (const [keyword, category] of Object.entries(requestCategoryMap)) {
          if (normalRequest.includes(keyword)) {
            detectedCategory = category;
            break;
          }
        }

        if (detectedCategory && Array.isArray(patched.what_it_needs)) {
          // Check the category isn't already present
          const categoryExists = patched.what_it_needs.some(
            (item: AnalysisItem) => item.category === detectedCategory
          );
          if (!categoryExists) {
            patched.what_it_needs.push({
              category: detectedCategory,
              search_title: request.item,
              description: `User explicitly requested this item.`,
              priority: "high",
              specs: "",
              placement: "",
              _injected_by_validator: true,
            });
            issues.push({
              type: "missing_request",
              description: `Client explicitly requested "${request.item}" — auto-injected as ${detectedCategory} into what_it_needs`,
              field: "what_it_needs",
              action: "removed", // "removed" signals wasModified=true
            });
            continue;
          }
        }

        // If we couldn't auto-inject (abstract request like "comfortable and impressive"), just flag
        issues.push({
          type: "missing_request",
          description: `Client explicitly requested "${request.item}" but it was not found in what_it_needs`,
          field: "what_it_needs",
          action: "flagged",
        });
      }
    }
  }

  if (issues.length > 0) {
    log.warn("Area analysis validation found issues", {
      phase: "area-analysis-validation",
      issueCount: issues.length,
      removed: issues.filter(i => i.action === "removed").length,
      flagged: issues.filter(i => i.action === "flagged").length,
      types: issues.map((i) => i.type),
    });
  } else {
    log.info("Area analysis validation passed — no constraint violations", {
      phase: "area-analysis-validation",
    });
  }

  return {
    patched,
    issues,
    wasModified: issues.some((i) => i.action === "removed"),
  };
}
