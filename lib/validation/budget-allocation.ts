// Budget allocation rules per room type.
//
// Complements bundle-optimizer's total-cap check (does the whole bundle fit
// under budget?). This module answers: ARE WE SPENDING IN THE RIGHT PLACES?
//
// Classic designer heuristics (informed by Houzz / Apartment Therapy breakdowns):
//   Living room: sofa ~25-35%, rug ~10-15%, coffee+side tables ~8-15%,
//                lighting ~5-10%, art/accents ~5-15%
//   Bedroom:     bed+mattress ~30-40%, nightstands ~5-10%,
//                dresser ~10-15%, rug ~8-12%, lighting ~5-10%
//   Dining room: table ~25-35%, chairs ~20-30% (bundled per-chair),
//                rug ~8-12%, lighting ~8-15% (pendant is a focal point)
//   Home office: desk ~20-30%, chair ~15-25%, shelving ~10-20%
//
// A bundle that spends 60% on a chandelier is a red flag — the LLM doesn't
// reason about proportions across items without help.

import { categoriesShareToken } from "./category-token-match";

type PctRange = [number, number]; // [min, max] as 0-1 fractions

interface AllocationTarget {
  /** Category aliases this target matches (first alias is display name) */
  aliases: string[];
  /** Acceptable share of total bundle cost for this category (combined across items) */
  share: PctRange;
  /** If true, item is "focal" — we warn only if spending < min (under-investment) */
  focalOnly?: boolean;
  /** If true, item is "accent" — we warn only if spending > max (over-spent) */
  accentOnly?: boolean;
}

const ROOM_TARGETS: Record<string, AllocationTarget[]> = {
  living_room: [
    { aliases: ["sofa", "sectional"], share: [0.22, 0.40] },
    { aliases: ["area_rug", "rug"], share: [0.07, 0.18] },
    { aliases: ["coffee_table"], share: [0.04, 0.12] },
    { aliases: ["media_console", "tv_stand"], share: [0.04, 0.12] },
    { aliases: ["accent_chair"], share: [0.05, 0.20] },
    { aliases: ["floor_lamp", "table_lamp", "pendant_light"], share: [0.03, 0.15], accentOnly: true },
    { aliases: ["wall_art", "artwork"], share: [0.02, 0.15], accentOnly: true },
  ],
  bedroom: [
    { aliases: ["bed", "mattress", "headboard"], share: [0.28, 0.45] },
    { aliases: ["nightstand", "bedside_table"], share: [0.04, 0.14] },
    { aliases: ["dresser", "tall_dresser"], share: [0.10, 0.22] },
    { aliases: ["area_rug", "rug"], share: [0.05, 0.15] },
    { aliases: ["floor_lamp", "table_lamp", "pendant_light", "wall_sconce"], share: [0.03, 0.15], accentOnly: true },
    { aliases: ["wall_art", "artwork"], share: [0.02, 0.12], accentOnly: true },
  ],
  dining_area: [
    { aliases: ["dining_table"], share: [0.22, 0.40] },
    { aliases: ["dining_chair"], share: [0.18, 0.35] },
    { aliases: ["area_rug", "rug"], share: [0.05, 0.15] },
    { aliases: ["pendant_light", "chandelier"], share: [0.05, 0.20] },
    { aliases: ["sideboard", "credenza"], share: [0.05, 0.25], accentOnly: true },
  ],
  home_office: [
    { aliases: ["desk", "writing_desk"], share: [0.18, 0.35] },
    { aliases: ["desk_chair", "office_chair", "task_chair"], share: [0.12, 0.30] },
    { aliases: ["bookshelf", "bookcase", "shelving"], share: [0.08, 0.25], accentOnly: true },
    { aliases: ["area_rug", "rug"], share: [0.03, 0.12] },
    { aliases: ["floor_lamp", "table_lamp"], share: [0.03, 0.12], accentOnly: true },
  ],
  kitchen: [
    { aliases: ["pendant_light", "chandelier"], share: [0.10, 0.30] },
    // "bar_stools" (plural) is the canonical slug used elsewhere in the
    // pipeline (lib/config/pipeline.ts's kitchen `essential` list,
    // area-analysis-validator.ts's matchTerms) — carried as its own alias so
    // getBudgetIssuesForItem's whole-token match (categoriesShareToken)
    // still finds it now that "bar_stools".includes("bar_stool") substring
    // matching no longer papers over the singular/plural gap (APT-61 review).
    { aliases: ["bar_stool", "counter_stool", "bar_stools"], share: [0.10, 0.30] },
  ],
};

function normalizeCategory(c: string): string {
  return c.toLowerCase().replace(/[\s-]+/g, "_");
}

export interface BudgetAllocationResult {
  /** 0-1 score — fraction of categories in their target share range */
  score: number;
  total_spend: number;
  per_category: Array<{
    category: string;
    aliases: string[];
    spend: number;
    share: number;
    target: PctRange;
    status: "under" | "within" | "over" | "n/a";
    item_count: number;
  }>;
  issues: Array<{
    category: string;
    /** Full alias list for this target (e.g. ["sofa","sectional"]) — used by
     *  getBudgetIssuesForItem to match an item against ANY alias, not just
     *  the display-name `category` (aliases[0]). Optional so hand-built
     *  fixtures (tests) can omit it and fall back to matching `category` alone. */
    aliases?: string[];
    issue: string;
    suggestion: string;
  }>;
  warnings: string[];
}

interface BudgetInput {
  category: string;
  price?: number | null;
}

export function computeBudgetAllocation(
  analysis: Record<string, unknown>,
  context: {
    roomType?: string;
    bundle?: Array<{ category?: string; price?: number | null; unit_price?: number | null }>;
  } = {},
): BudgetAllocationResult {
  const roomKey = (context.roomType || "living_room").toLowerCase().replace(/[\s-]+/g, "_");
  const targets = ROOM_TARGETS[roomKey];
  const warnings: string[] = [];
  if (!targets) {
    warnings.push(`No allocation targets defined for roomType=${roomKey}`);
  }

  // Build category → total spend map from bundle (preferred) or estimated_total on what_it_needs
  const items: BudgetInput[] = [];
  if (context.bundle && context.bundle.length > 0) {
    for (const b of context.bundle) {
      items.push({
        category: normalizeCategory(b.category ?? ""),
        price: b.price ?? b.unit_price ?? null,
      });
    }
  } else {
    // Fall back to analysis.what_it_needs estimated_price if set
    const whatItNeeds = (analysis.what_it_needs as Array<{ category: string; estimated_price?: number }>) || [];
    for (const w of whatItNeeds) {
      items.push({ category: normalizeCategory(w.category), price: w.estimated_price ?? null });
    }
  }
  const hasPrices = items.some((i) => typeof i.price === "number" && i.price > 0);
  if (!hasPrices) {
    warnings.push("No item prices available — skipping allocation check");
    return {
      score: 0.9,
      total_spend: 0,
      per_category: [],
      issues: [],
      warnings,
    };
  }

  const totalSpend = items.reduce((sum, i) => sum + (typeof i.price === "number" ? i.price : 0), 0);
  if (totalSpend <= 0) {
    return {
      score: 0.9,
      total_spend: 0,
      per_category: [],
      issues: [],
      warnings: [...warnings, "Total spend = $0"],
    };
  }

  const perCategory: BudgetAllocationResult["per_category"] = [];
  const issues: BudgetAllocationResult["issues"] = [];

  const matchedItems = new Set<number>(); // indexes of items already counted

  for (const target of targets ?? []) {
    let spend = 0;
    let count = 0;
    items.forEach((item, idx) => {
      if (matchedItems.has(idx)) return;
      const matches = target.aliases.some((a) => item.category === a || item.category.includes(a));
      if (matches && typeof item.price === "number") {
        spend += item.price;
        count++;
        matchedItems.add(idx);
      }
    });
    const share = spend / totalSpend;
    const [lo, hi] = target.share;
    let status: "under" | "within" | "over" | "n/a" = "n/a";
    if (count === 0) {
      status = "n/a";
    } else if (share < lo) {
      status = "under";
    } else if (share > hi) {
      status = "over";
    } else {
      status = "within";
    }
    perCategory.push({
      category: target.aliases[0],
      aliases: target.aliases,
      spend: Math.round(spend),
      share: round3(share),
      target: [lo, hi],
      status,
      item_count: count,
    });

    if (status === "under" && !target.accentOnly) {
      issues.push({
        category: target.aliases[0],
        aliases: target.aliases,
        issue: `Under-spent on ${target.aliases[0]}: ${Math.round(share * 100)}% of budget vs. typical ${Math.round(lo * 100)}-${Math.round(hi * 100)}%`,
        suggestion: `Increase ${target.aliases[0]} budget — anchor piece, don't cheap out (raise to $${Math.round(totalSpend * lo)}+)`,
      });
    } else if (status === "over" && !target.focalOnly) {
      issues.push({
        category: target.aliases[0],
        aliases: target.aliases,
        issue: `Over-spent on ${target.aliases[0]}: ${Math.round(share * 100)}% of budget vs. typical ${Math.round(lo * 100)}-${Math.round(hi * 100)}%`,
        suggestion: `Reallocate — reduce ${target.aliases[0]} budget to $${Math.round(totalSpend * hi)} and invest the difference in under-budgeted categories`,
      });
    }
  }

  // Score: fraction of categories in range (ignoring n/a)
  const evaluated = perCategory.filter((p) => p.status !== "n/a");
  const within = evaluated.filter((p) => p.status === "within").length;
  const score = evaluated.length === 0 ? 0.9 : within / evaluated.length;

  return {
    score: round2(score),
    total_spend: Math.round(totalSpend),
    per_category: perCategory,
    issues,
    warnings,
  };
}

export function formatBudgetAllocationForPrompt(result: BudgetAllocationResult): string {
  const lines: string[] = [];
  lines.push(`### Budget Allocation: ${result.score.toFixed(2)}/1.0`);
  if (result.total_spend > 0) lines.push(`- Total spend: $${result.total_spend}`);
  for (const w of result.warnings) lines.push(`- NOTE: ${w}`);
  for (const p of result.per_category) {
    if (p.status === "n/a") continue;
    const mark = p.status === "within" ? "✓" : p.status === "under" ? "↓" : "↑";
    const tgt = `${Math.round(p.target[0] * 100)}-${Math.round(p.target[1] * 100)}%`;
    lines.push(`- ${mark} ${p.category}: ${Math.round(p.share * 100)}% ($${p.spend}) vs target ${tgt}`);
  }
  for (const i of result.issues) {
    lines.push(`- FIX: ${i.category} — ${i.suggestion}`);
  }
  return lines.join("\n");
}

export function getBudgetIssuesForItem(
  result: BudgetAllocationResult,
  category: string,
): string[] {
  const cat = normalizeCategory(category);
  return result.issues
    .filter((i) => {
      // Match against every alias for this target (e.g. an item categorized
      // "sectional" must still match the "sofa" target's issue), not just the
      // display-name `category` (aliases[0]) — a target's non-first alias
      // never equaled `category` under the old single-string check, so items
      // in it silently never picked up their own budget issue. Falls back to
      // `[i.category]` when `aliases` is absent (hand-built test fixtures).
      const candidates = i.aliases && i.aliases.length > 0 ? i.aliases : [i.category];
      return candidates.some((a) => categoriesShareToken(cat, a));
    })
    .map((i) => i.issue);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
