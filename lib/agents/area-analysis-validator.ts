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

import { parseUserContext } from "@/lib/utils/parse-user-context";
import { createLogger } from "@/lib/logging/logger";

const log = createLogger("area-analysis-validator");

export interface AreaAnalysisValidationIssue {
  type: "exclusion_violation" | "keep_item_replaced" | "keep_item_in_remove" | "missing_request";
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
function stripLocationContext(text: string): string {
  return text
    .replace(/\b(?:behind|next to|near|beside|by|on top of|under|underneath|above|in front of|across from|against|along|around|at|between|in|on|over|to the (?:left|right) of|if possible)\b.*/gi, "")
    .replace(/\b(?:also)\b/gi, "")
    .trim();
}

function extractKeepCategories(keepItems: string[]): Array<{ item: string; keywords: string[] }> {
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
    // Strip location context so "lamp behind the sofa" doesn't trigger "sofa" category
    const itemOnly = stripLocationContext(item);
    const normalItem = normalize(itemOnly);
    const keywords: string[] = [];
    for (const [, patterns] of Object.entries(categoryPatterns)) {
      if (patterns.some((p) => normalItem.includes(normalize(p)))) {
        keywords.push(...patterns);
      }
    }
    return { item, keywords: [...new Set(keywords)] };
  });
}

export function validateAreaAnalysis(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic LLM analysis output
  analysis: Record<string, any>,
  keepItems: string[],
  userContext?: string
): AreaAnalysisValidationResult {
  const issues: AreaAnalysisValidationIssue[] = [];
  const parsed = userContext ? parseUserContext(userContext) : null;

  // Deep clone to avoid mutating the original
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic LLM analysis output
  const patched: Record<string, any> = JSON.parse(JSON.stringify(analysis));

  // Merge keep items from both sources
  const allKeepItems = [
    ...keepItems,
    ...(parsed?.additionalKeepItems || []),
  ];

  // --- Check 1: Exclusion violations in what_it_needs ---
  if (parsed?.exclusions && parsed.exclusions.length > 0) {
    const expandedExclusions = expandExclusionTerms(parsed.exclusions);

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

  if (allKeepItems.length > 0) {
    const keepCategories = extractKeepCategories(allKeepItems);

    for (const { item, keywords } of keepCategories) {
      if (keywords.length === 0) continue;

      // Check if what_it_needs recommends a NEW item in the same category as a kept item
      if (Array.isArray(patched.what_it_needs)) {
        patched.what_it_needs = patched.what_it_needs.filter((rec: AnalysisItem) => {
          // Pure decor/accessory items complement kept furniture — never replace it
          if (DECOR_CATEGORIES.has((rec.category || "").toLowerCase())) return true;
          const recText = `${rec.category || ""} ${rec.search_title || ""}`;
          const match = mentionsAny(recText, keywords);
          if (match) {
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
