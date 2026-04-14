// Pairwise furniture-dimension anchoring.
//
// proportion-math.ts handles ABSOLUTE rules ("coffee table should be ~18" tall")
// and RUG-vs-furniture extension. This module handles PAIRWISE relational rules
// where item A's dimensions are anchored to item B's — the stuff a designer
// holds in their head as shorthand:
//
//   coffee_table.width  ≈ 2/3 * sofa.width   (±15%)
//   media_console.width ≤ sofa.width + 12"   (media usually slightly narrower)
//   dining_table.length ≥ 24" * dining_chair_count
//   nightstand.height   within ±3" of bed.mattress_top (bed.height - 12)
//   rug.width           ≥ sofa.width + 12"   (covers front legs + overhang)
//   tv.width            ≤ media_console.width - 8"  (centered with breathing room)
//
// Reads dimensions from parsed specs (or `dimensions` object if given).

import { parseDimensions } from "./spatial-math";

export interface PairwiseResult {
  /** 0-1 overall pairwise proportion fitness */
  score: number;
  /** per-rule results for transparency */
  rule_results: Array<{
    rule: string;
    primary: string; // e.g., "coffee_table"
    anchor: string;  // e.g., "sofa"
    passed: boolean;
    actual: string;
    expected: string;
  }>;
  /** Only the failed rules, human-formatted */
  issues: Array<{
    primary: string;
    anchor: string;
    issue: string;
    suggestion: string;
  }>;
}

type Dims = { width: number; depth: number; height?: number };

interface PairItem {
  category: string;
  dims: Dims | null;
  count: number; // for dining chairs etc.
}

function normalizeCategory(c: string): string {
  return c.toLowerCase().replace(/[\s-]+/g, "_");
}

function extractDims(item: { specs?: string; dimensions?: Dims | null }): Dims | null {
  if (item.dimensions && item.dimensions.width && item.dimensions.depth) {
    return item.dimensions;
  }
  if (item.specs) return parseDimensions(item.specs);
  return null;
}

function findByCategory(items: PairItem[], aliases: string[]): PairItem | null {
  for (const alias of aliases) {
    const hit = items.find((i) => i.category === alias || i.category.includes(alias));
    if (hit) return hit;
  }
  return null;
}

// ─── Rule definitions ──────────────────────────────────────────────────

type Rule = {
  id: string;
  primaryAliases: string[];
  anchorAliases: string[];
  evaluate: (primary: PairItem, anchor: PairItem) => {
    passed: boolean;
    actual: string;
    expected: string;
    issue?: string;
    suggestion?: string;
  } | null; // null = rule not applicable to this pair
};

const RULES: Rule[] = [
  // coffee_table.width ≈ 2/3 * sofa.width (±15% of ideal)
  {
    id: "coffee_table.width = 2/3 sofa.width",
    primaryAliases: ["coffee_table"],
    anchorAliases: ["sofa", "sectional", "loveseat"],
    evaluate: (primary, anchor) => {
      if (!primary.dims || !anchor.dims) return null;
      const ideal = (2 / 3) * anchor.dims.width;
      const lo = ideal * 0.70;
      const hi = ideal * 1.15;
      const w = primary.dims.width;
      const passed = w >= lo && w <= hi;
      return {
        passed,
        actual: `${Math.round(w)}" wide`,
        expected: `~${Math.round(ideal)}" (60-115% of 2/3 sofa width)`,
        issue: passed ? undefined
          : w < lo
            ? `Coffee table (${Math.round(w)}") looks small next to a ${Math.round(anchor.dims.width)}" sofa — under ~${Math.round(lo)}"`
            : `Coffee table (${Math.round(w)}") is oversized for a ${Math.round(anchor.dims.width)}" sofa — over ~${Math.round(hi)}"`,
        suggestion: `Aim for ${Math.round(lo)}"-${Math.round(hi)}" wide (ideal: ~${Math.round(ideal)}")`,
      };
    },
  },

  // media_console.width ≤ sofa.width + 12"  (media console usually a bit narrower)
  {
    id: "media_console.width ≤ sofa.width + 12",
    primaryAliases: ["media_console", "tv_stand", "tv_console", "entertainment_center"],
    anchorAliases: ["sofa", "sectional"],
    evaluate: (primary, anchor) => {
      if (!primary.dims || !anchor.dims) return null;
      const maxW = anchor.dims.width + 12;
      const passed = primary.dims.width <= maxW;
      return {
        passed,
        actual: `${Math.round(primary.dims.width)}" wide`,
        expected: `≤ ${Math.round(maxW)}" (sofa + 12")`,
        issue: passed ? undefined
          : `Media console (${Math.round(primary.dims.width)}") is wider than the sofa (${Math.round(anchor.dims.width)}") + 12"`,
        suggestion: `Keep media console ≤ ${Math.round(maxW)}" for visual balance`,
      };
    },
  },

  // dining_table.length ≥ 24" × dining_chair_count (allows elbow room)
  {
    id: "dining_table.length ≥ 24 × chairs",
    primaryAliases: ["dining_table"],
    anchorAliases: ["dining_chair"],
    evaluate: (primary, anchor) => {
      if (!primary.dims) return null;
      const chairs = Math.max(anchor.count, 2);
      // Count sits on long sides — so length accommodates roughly half+half.
      // Use larger of width/depth as "length".
      const tableLen = Math.max(primary.dims.width, primary.dims.depth);
      // Rule: ~24" per seated diner on the long sides; 2 seats at ends doesn't
      // increase length. So length ≥ 24" × (chairs - 2) / 2 * 2 = 24 × (chairs-2).
      const perSideCount = Math.max(1, Math.ceil((chairs - 2) / 2));
      const minLen = perSideCount * 24;
      const passed = tableLen >= minLen;
      return {
        passed,
        actual: `${Math.round(tableLen)}" for ${chairs} chairs`,
        expected: `≥ ${minLen}" (24" per diner on long sides)`,
        issue: passed ? undefined
          : `Dining table length ${Math.round(tableLen)}" is too short for ${chairs} chairs — need ≥ ${minLen}"`,
        suggestion: `Upgrade to a ${minLen}"+ length table, or reduce to ${Math.floor(tableLen / 24) * 2 + 2} chairs`,
      };
    },
  },

  // nightstand.height within ±3" of bed mattress top (bed.height - ~12 for mattress)
  {
    id: "nightstand.height ≈ bed.top",
    primaryAliases: ["nightstand", "bedside_table"],
    anchorAliases: ["bed"],
    evaluate: (primary, anchor) => {
      if (!primary.dims?.height || !anchor.dims?.height) return null;
      // bed.height is frame+mattress — assume mattress top = bed.height - 3 (boxspring/footboard)
      const bedTop = anchor.dims.height - 3;
      const deviation = Math.abs(primary.dims.height - bedTop);
      const passed = deviation <= 4;
      return {
        passed,
        actual: `nightstand ${Math.round(primary.dims.height)}" vs bed top ~${Math.round(bedTop)}"`,
        expected: `within ±4" of ~${Math.round(bedTop)}"`,
        issue: passed ? undefined
          : `Nightstand ${Math.round(primary.dims.height)}" is off by ${Math.round(deviation)}" from bed top (~${Math.round(bedTop)}")`,
        suggestion: `Pick a nightstand in the ${Math.round(bedTop - 4)}-${Math.round(bedTop + 4)}" height range`,
      };
    },
  },

  // rug.width ≥ sofa.width + 12"  (should extend 6" past each arm)
  {
    id: "rug.width ≥ sofa.width + 12",
    primaryAliases: ["area_rug", "rug"],
    anchorAliases: ["sofa", "sectional"],
    evaluate: (primary, anchor) => {
      if (!primary.dims || !anchor.dims) return null;
      const needed = anchor.dims.width + 12;
      const passed = primary.dims.width >= needed;
      return {
        passed,
        actual: `rug ${Math.round(primary.dims.width)}" wide`,
        expected: `≥ ${Math.round(needed)}" (sofa + 12")`,
        issue: passed ? undefined
          : `Rug (${Math.round(primary.dims.width)}") narrower than sofa (${Math.round(anchor.dims.width)}") + 12" — will look undersized`,
        suggestion: `Step up to a rug at least ${Math.round(needed)}" wide`,
      };
    },
  },

  // tv.width ≤ media_console.width - 8"  (tv fits centered with breathing room)
  {
    id: "tv.width ≤ console.width - 8",
    primaryAliases: ["tv", "television"],
    anchorAliases: ["media_console", "tv_stand", "tv_console", "entertainment_center"],
    evaluate: (primary, anchor) => {
      if (!primary.dims || !anchor.dims) return null;
      const maxW = anchor.dims.width - 8;
      const passed = primary.dims.width <= maxW;
      return {
        passed,
        actual: `tv ${Math.round(primary.dims.width)}" vs console ${Math.round(anchor.dims.width)}"`,
        expected: `TV width ≤ ${Math.round(maxW)}" (console - 8")`,
        issue: passed ? undefined
          : `TV (${Math.round(primary.dims.width)}") overhangs console (${Math.round(anchor.dims.width)}")`,
        suggestion: `Widen console to ≥ ${Math.round(primary.dims.width + 8)}" or downsize TV`,
      };
    },
  },

  // side_table.height ≈ sofa arm height (±3")
  {
    id: "side_table.height ≈ sofa.arm",
    primaryAliases: ["side_table", "end_table"],
    anchorAliases: ["sofa", "sectional", "loveseat"],
    evaluate: (primary, anchor) => {
      if (!primary.dims?.height || !anchor.dims?.height) return null;
      // Sofa arm height ≈ total sofa height - 10 (seat to arm = ~8, back to arm = ~10)
      const armHeight = anchor.dims.height - 10;
      const deviation = Math.abs(primary.dims.height - armHeight);
      const passed = deviation <= 3;
      return {
        passed,
        actual: `${Math.round(primary.dims.height)}" tall`,
        expected: `~${Math.round(armHeight)}" (sofa arm, ±3")`,
        issue: passed ? undefined
          : `Side table ${Math.round(primary.dims.height)}" off by ${Math.round(deviation)}" from sofa arm (~${Math.round(armHeight)}")`,
        suggestion: `Target ${Math.round(armHeight - 3)}-${Math.round(armHeight + 3)}" tall`,
      };
    },
  },
];

// ─── Main computation ──────────────────────────────────────────────────

export function computePairwiseProportions(
  analysis: Record<string, unknown>,
): PairwiseResult {
  const whatItNeeds =
    (analysis.what_it_needs as Array<{
      category: string;
      specs?: string;
      placement?: string;
      dimensions?: Dims | null;
    }>) || [];

  // Collect items, counting duplicates (dining chairs etc.)
  const catCounts = new Map<string, number>();
  for (const item of whatItNeeds) {
    const c = normalizeCategory(item.category);
    catCounts.set(c, (catCounts.get(c) ?? 0) + 1);
  }
  const items: PairItem[] = [];
  const seen = new Set<string>();
  for (const item of whatItNeeds) {
    const c = normalizeCategory(item.category);
    if (seen.has(c)) continue; // one representative per category
    seen.add(c);
    items.push({
      category: c,
      dims: extractDims(item),
      count: catCounts.get(c) ?? 1,
    });
  }

  const ruleResults: PairwiseResult["rule_results"] = [];
  const issues: PairwiseResult["issues"] = [];
  let checks = 0;
  let passes = 0;

  for (const rule of RULES) {
    const primary = findByCategory(items, rule.primaryAliases);
    const anchor = findByCategory(items, rule.anchorAliases);
    if (!primary || !anchor) continue;
    const result = rule.evaluate(primary, anchor);
    if (!result) continue;
    checks++;
    if (result.passed) passes++;

    ruleResults.push({
      rule: rule.id,
      primary: primary.category,
      anchor: anchor.category,
      passed: result.passed,
      actual: result.actual,
      expected: result.expected,
    });

    if (!result.passed && result.issue) {
      issues.push({
        primary: primary.category,
        anchor: anchor.category,
        issue: result.issue,
        suggestion: result.suggestion ?? "",
      });
    }
  }

  const score = checks === 0 ? 0.85 : passes / checks;

  return {
    score: round2(score),
    rule_results: ruleResults,
    issues,
  };
}

/** Format for injection into a prompt. */
export function formatPairwiseProportionsForPrompt(result: PairwiseResult): string {
  const lines: string[] = [];
  lines.push(`### Pairwise Proportion Rules: ${result.score.toFixed(2)}/1.0`);
  if (result.rule_results.length === 0) {
    lines.push("- No applicable pairwise pairs found (insufficient dimensional data)");
    return lines.join("\n");
  }
  for (const r of result.rule_results) {
    const mark = r.passed ? "✓" : "✗";
    lines.push(`- ${mark} ${r.rule}: ${r.actual} (expected ${r.expected})`);
  }
  for (const i of result.issues) {
    lines.push(`- FIX: ${i.primary} vs ${i.anchor} — ${i.suggestion}`);
  }
  return lines.join("\n");
}

/** Return pairwise issues filtered to a single item (for per-item surfacing). */
export function getPairwiseIssuesForItem(
  result: PairwiseResult,
  category: string,
): string[] {
  const cat = normalizeCategory(category);
  return result.issues
    .filter((i) => i.primary === cat || i.anchor === cat)
    .map((i) => i.issue);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
