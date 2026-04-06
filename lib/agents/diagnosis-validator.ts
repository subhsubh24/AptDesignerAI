/**
 * Post-diagnosis constraint validator.
 *
 * Performs deterministic checks on diagnosis output to catch cases where
 * the LLM ignored explicit user instructions:
 * - Recommending items the user explicitly excluded
 * - Recommending replacements for items the user wants to keep
 * - Missing items the user explicitly requested
 * - Insufficient quantity for plural requests
 *
 * This runs AFTER the LLM diagnosis, before saving to the database.
 * It patches the output to fix violations rather than re-running the LLM.
 */

import { parseUserContext } from "@/lib/utils/parse-user-context";
import { createLogger } from "@/lib/logging/logger";
import type { DiagnosisResult } from "./room-diagnostician";

const log = createLogger("diagnosis-validator");

export interface ValidationIssue {
  type: "exclusion_violation" | "keep_item_replaced" | "missing_request" | "insufficient_quantity";
  description: string;
  field: string;
  action: "removed" | "flagged";
}

export interface DiagnosisValidationResult {
  patched: DiagnosisResult;
  issues: ValidationIssue[];
  wasModified: boolean;
}

/**
 * Normalize a string for fuzzy matching — lowercase, strip extra whitespace.
 */
function normalize(s: string): string {
  return s.toLowerCase().replace(/_/g, " ").replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Check if a text string mentions any of the given terms (fuzzy match).
 */
function mentionsAny(text: string, terms: string[]): string | null {
  const normalText = normalize(text);
  for (const term of terms) {
    const normalTerm = normalize(term);
    // Check for substring match — "curtains" matches "sheer linen curtains"
    if (normalText.includes(normalTerm)) return term;
    // Check individual words for short terms
    if (normalTerm.split(" ").length === 1 && normalTerm.length >= 3) {
      // Word boundary match
      const words = normalText.split(" ");
      if (words.some((w) => w === normalTerm || w.startsWith(normalTerm))) return term;
    }
  }
  return null;
}

/**
 * Build a list of exclusion keywords from parsed exclusions.
 * E.g., "curtains" -> ["curtain", "curtains", "drapery", "drapes", "drape"]
 */
function expandExclusionTerms(exclusions: string[]): string[] {
  const synonymMap: Record<string, string[]> = {
    curtain: ["curtain", "curtains", "drapery", "drapes", "drape", "window treatment", "window treatments", "window panel", "window panels", "window covering", "window coverings", "window dressing", "sheer", "sheers", "curtain panel", "fabric panel", "linen panel"],
    blind: ["blind", "blinds", "shade", "shades", "roller shade"],
    rug: ["rug", "rugs", "carpet", "area rug"],
    lamp: ["lamp", "floor lamp", "arc lamp", "table lamp", "light"],
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
 * Build keep-item category keywords for detecting replacement recommendations.
 * E.g., "black arc floor lamp" -> ["floor lamp", "arc lamp", "lamp"]
 */
function extractKeepCategories(keepItems: string[]): Array<{ item: string; keywords: string[] }> {
  const categoryPatterns: Record<string, string[]> = {
    "floor lamp": ["floor lamp", "arc lamp", "standing lamp", "tripod lamp", "tripod floor lamp", "tripod light"],
    "table lamp": ["table lamp", "desk lamp", "accent lamp"],
    "light": ["light", "lamp", "sconce", "wall light", "accent light"],
    "sofa": ["sofa", "couch", "sectional"],
    "rug": ["rug", "area rug", "carpet"],
    "coffee table": ["coffee table"],
    "dining table": ["dining table"],
    "bookshelf": ["bookshelf", "shelf", "shelving", "bookcase"],
    "tv console": ["tv console", "media console", "tv stand", "entertainment center"],
    "dresser": ["dresser", "chest of drawers"],
    "bed": ["bed", "bed frame"],
    "nightstand": ["nightstand", "bedside table", "side table"],
  };

  return keepItems.map((item) => {
    const normalItem = normalize(item);
    const keywords: string[] = [];
    for (const [category, patterns] of Object.entries(categoryPatterns)) {
      if (patterns.some((p) => normalItem.includes(p))) {
        keywords.push(category, ...patterns);
      }
    }
    return { item, keywords: [...new Set(keywords)] };
  });
}

export function validateDiagnosis(
  result: DiagnosisResult,
  keepItems: string[],
  userContext?: string
): DiagnosisValidationResult {
  const issues: ValidationIssue[] = [];
  const parsed = userContext ? parseUserContext(userContext) : null;

  // Deep clone to avoid mutating the original
  const patched: DiagnosisResult = JSON.parse(JSON.stringify(result));

  // Merge keep items from both sources
  const allKeepItems = [
    ...keepItems,
    ...(parsed?.additionalKeepItems || []),
  ];

  // --- Check 1: Exclusion violations ---
  if (parsed?.exclusions && parsed.exclusions.length > 0) {
    const expandedExclusions = expandExclusionTerms(parsed.exclusions);

    // Check action_list
    patched.action_list = patched.action_list.filter((action) => {
      const match = mentionsAny(action.action, expandedExclusions)
        || mentionsAny(action.category, expandedExclusions)
        || mentionsAny(action.reasoning, expandedExclusions);
      if (match) {
        issues.push({
          type: "exclusion_violation",
          description: `Removed action "${action.action}" — client explicitly excluded "${match}"`,
          field: "action_list",
          action: "removed",
        });
        return false;
      }
      return true;
    });

    // Check missing_categories
    patched.missing_categories = patched.missing_categories.filter((cat) => {
      const match = mentionsAny(cat, expandedExclusions);
      if (match) {
        issues.push({
          type: "exclusion_violation",
          description: `Removed missing category "${cat}" — client explicitly excluded "${match}"`,
          field: "missing_categories",
          action: "removed",
        });
        return false;
      }
      return true;
    });

    // Check diagnosis.missing_furniture_categories (inner field)
    if (patched.diagnosis.missing_furniture_categories) {
      patched.diagnosis.missing_furniture_categories = patched.diagnosis.missing_furniture_categories.filter((cat: string) => {
        const match = mentionsAny(cat, expandedExclusions);
        if (match) {
          issues.push({
            type: "exclusion_violation",
            description: `Removed "${cat}" from diagnosis.missing_furniture_categories — client explicitly excluded "${match}"`,
            field: "diagnosis.missing_furniture_categories",
            action: "removed",
          });
          return false;
        }
        return true;
      });
    }

    // Check design_direction.recommended_furniture_types
    if (patched.design_direction.recommended_furniture_types) {
      patched.design_direction.recommended_furniture_types = patched.design_direction.recommended_furniture_types.filter((ft) => {
        const ftText = String(ft);
        const match = mentionsAny(ftText, expandedExclusions);
        if (match) {
          issues.push({
            type: "exclusion_violation",
            description: `Removed furniture type recommendation "${ftText}" — client explicitly excluded "${match}"`,
            field: "design_direction.recommended_furniture_types",
            action: "removed",
          });
          return false;
        }
        return true;
      });
    }
  }

  // --- Check 2: Keep-item replacement violations ---
  if (allKeepItems.length > 0) {
    const keepCategories = extractKeepCategories(allKeepItems);

    for (const { item, keywords } of keepCategories) {
      if (keywords.length === 0) continue;

      // Check if action_list recommends a new item in the same category
      patched.action_list = patched.action_list.filter((action) => {
        const actionText = `${action.action} ${action.category}`;
        const match = mentionsAny(actionText, keywords);
        // Only flag if it's a NEW recommendation (not styling the existing one)
        const isReplacement = match
          && !normalize(action.action).includes("style")
          && !normalize(action.action).includes("complement")
          && !normalize(action.action).includes("pair");
        if (isReplacement) {
          issues.push({
            type: "keep_item_replaced",
            description: `Removed action "${action.action}" — conflicts with kept item "${item}"`,
            field: "action_list",
            action: "removed",
          });
          return false;
        }
        return true;
      });

      // Check what_is_not_working — keep items should NOT appear here
      patched.diagnosis.what_is_not_working = patched.diagnosis.what_is_not_working.filter((issue) => {
        const match = mentionsAny(issue, [item]);
        if (match) {
          issues.push({
            type: "keep_item_replaced",
            description: `Removed "${issue}" from what_is_not_working — client wants to keep "${item}"`,
            field: "diagnosis.what_is_not_working",
            action: "removed",
          });
          return false;
        }
        return true;
      });
    }
  }

  // --- Check 3: Missing explicit requests ---
  if (parsed?.explicitRequests && parsed.explicitRequests.length > 0) {
    for (const request of parsed.explicitRequests) {
      const requestTerms = [request.item];
      const foundInActions = patched.action_list.some(
        (a) => mentionsAny(`${a.action} ${a.category}`, requestTerms)
      );
      const foundInCategories = patched.missing_categories.some(
        (c) => mentionsAny(c, requestTerms)
      );

      if (!foundInActions && !foundInCategories) {
        issues.push({
          type: "missing_request",
          description: `Client explicitly requested "${request.item}" but it was not included in recommendations`,
          field: "action_list",
          action: "flagged",
        });
      }

      // Check 4: Insufficient quantity for plural requests
      if (request.wantsMultiple) {
        const matchingActions = patched.action_list.filter(
          (a) => mentionsAny(`${a.action} ${a.category}`, requestTerms)
        );
        if (matchingActions.length < 2) {
          issues.push({
            type: "insufficient_quantity",
            description: `Client requested multiple "${request.item}" (used plural) but only ${matchingActions.length} recommendation(s) found — should be at least 2-3`,
            field: "action_list",
            action: "flagged",
          });
        }
      }
    }
  }

  if (issues.length > 0) {
    log.warn("Diagnosis validation found issues", {
      phase: "diagnosis-validation",
      issueCount: issues.length,
      types: issues.map((i) => i.type),
    });
  } else {
    log.info("Diagnosis validation passed — no constraint violations", {
      phase: "diagnosis-validation",
    });
  }

  // Re-number action_list priorities after removals
  patched.action_list = patched.action_list.map((action, idx) => ({
    ...action,
    priority: idx + 1,
  }));

  return {
    patched,
    issues,
    wasModified: issues.some((i) => i.action === "removed"),
  };
}
