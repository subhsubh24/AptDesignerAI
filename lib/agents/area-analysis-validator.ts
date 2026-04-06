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
  patched: Record<string, any>;
  issues: AreaAnalysisValidationIssue[];
  wasModified: boolean;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

function mentionsAny(text: string, terms: string[]): string | null {
  const normalText = normalize(text);
  for (const term of terms) {
    const normalTerm = normalize(term);
    if (normalText.includes(normalTerm)) return term;
    if (normalTerm.split(" ").length === 1 && normalTerm.length >= 3) {
      const words = normalText.split(" ");
      if (words.some((w) => w === normalTerm || w.startsWith(normalTerm))) return term;
    }
  }
  return null;
}

/**
 * Expand exclusion terms with synonyms to catch LLM rephrasing.
 */
function expandExclusionTerms(exclusions: string[]): string[] {
  const synonymMap: Record<string, string[]> = {
    curtain: ["curtain", "curtains", "drapery", "drapes", "drape", "window treatment", "window panel", "sheer", "curtain panel"],
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
function extractKeepCategories(keepItems: string[]): Array<{ item: string; keywords: string[] }> {
  const categoryPatterns: Record<string, string[]> = {
    "floor lamp": ["floor_lamp", "floor lamp", "arc lamp", "standing lamp", "arc floor lamp"],
    "table lamp": ["table_lamp", "table lamp", "desk lamp"],
    "sofa": ["sofa", "couch", "sectional"],
    "rug": ["area_rug", "rug", "area rug", "carpet"],
    "coffee table": ["coffee_table", "coffee table"],
    "dining table": ["dining_table", "dining table"],
    "bookshelf": ["bookshelf", "shelf", "shelving", "bookcase"],
    "tv console": ["media_console", "tv console", "media console", "tv stand", "entertainment center"],
    "light": ["table_lamp", "table lamp", "light", "light stand"],
  };

  return keepItems.map((item) => {
    const normalItem = normalize(item);
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
  analysis: Record<string, any>,
  keepItems: string[],
  userContext?: string
): AreaAnalysisValidationResult {
  const issues: AreaAnalysisValidationIssue[] = [];
  const parsed = userContext ? parseUserContext(userContext) : null;

  // Deep clone to avoid mutating the original
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
      patched.what_it_needs = patched.what_it_needs.filter((item: any) => {
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
  if (allKeepItems.length > 0) {
    const keepCategories = extractKeepCategories(allKeepItems);

    for (const { item, keywords } of keepCategories) {
      if (keywords.length === 0) continue;

      // Check if what_it_needs recommends a NEW item in the same category as a kept item
      if (Array.isArray(patched.what_it_needs)) {
        patched.what_it_needs = patched.what_it_needs.filter((rec: any) => {
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
  if (parsed?.explicitRequests && parsed.explicitRequests.length > 0) {
    for (const request of parsed.explicitRequests) {
      const requestTerms = [request.item];
      const foundInNeeds = Array.isArray(patched.what_it_needs) && patched.what_it_needs.some(
        (item: any) => mentionsAny(`${item.category || ""} ${item.search_title || ""} ${item.description || ""}`, requestTerms)
      );

      if (!foundInNeeds) {
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
