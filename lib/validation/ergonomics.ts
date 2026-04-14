// Ergonomics & viewing-distance rules.
//
// Non-aesthetic, purely mechanical relationships the LLM shouldn't have to
// guess. These sit alongside pairwise-proportions.ts (which handles design
// shorthand like "coffee table = 2/3 sofa") but target *ergonomic* rules that
// come from human-factors / IEC / IES sources rather than convention:
//
//   - TV viewing distance: 1.5-2.5 × screen diagonal (mixed SDR/4K)
//   - Desk chair seat → desk top: 10-12" clearance (elbow at 90°)
//   - Desk depth: ≥ 24" for a monitor + keyboard
//   - Counter → upper cabinet: 15-20" (reach without crane-neck)
//   - Kitchen work triangle: sink/stove/fridge legs each 4-9 ft, total 12-26 ft
//   - Dining chair seat → table top: 10-13" (for knees + plate reach)
//   - Pendant over dining/island: bottom 30-36" above surface
//
// Each rule returns pass/fail with actionable suggestion text.

import { parseDimensions } from "./spatial-math";

export interface ErgonomicsResult {
  /** 0-1 overall ergonomics fitness */
  score: number;
  rule_results: Array<{
    rule: string;
    scope: string; // e.g., "tv+sofa", "kitchen triangle"
    passed: boolean;
    actual: string;
    expected: string;
  }>;
  issues: Array<{
    scope: string;
    item: string;
    issue: string;
    suggestion: string;
  }>;
}

type Dims = { width: number; depth: number; height?: number };

interface ErgoItem {
  category: string;
  dims: Dims | null;
  placement?: string;
  count: number;
}

function normalizeCategory(c: string): string {
  return c.toLowerCase().replace(/[\s-]+/g, "_");
}

function extractDims(item: { specs?: string; dimensions?: Dims | null }): Dims | null {
  if (item.dimensions && item.dimensions.width && item.dimensions.depth) return item.dimensions;
  if (item.specs) return parseDimensions(item.specs);
  return null;
}

function findByCategory(items: ErgoItem[], aliases: string[]): ErgoItem | null {
  for (const alias of aliases) {
    const hit = items.find((i) => i.category === alias || i.category.includes(alias));
    if (hit) return hit;
  }
  return null;
}

// Extract a numeric diagonal (inches) from specs like '65" 4K LED TV' or 'Samsung 55-inch QLED'
function parseTvDiagonal(specs?: string): number | null {
  if (!specs) return null;
  // Look for patterns like 65", 65-inch, 55 inch, 65 in
  const m = specs.match(/\b(\d{2,3})\s*["-]?\s*(?:inch|in|"|')\b/i);
  if (m) {
    const n = parseFloat(m[1]);
    if (n >= 20 && n <= 120) return n;
  }
  return null;
}

// ─── Rule definitions ─────────────────────────────────────────────────

interface RuleCtx {
  items: ErgoItem[];
  roomType?: string;
}

type Rule = (ctx: RuleCtx) => {
  id: string;
  scope: string;
  applicable: boolean;
  passed?: boolean;
  actual?: string;
  expected?: string;
  item?: string;
  issue?: string;
  suggestion?: string;
} | null;

// TV viewing distance: 1.5-2.5 × diagonal. Uses seating center → wall.
// Approximation: if sofa is on opposite wall from TV, distance ≈ room depth.
// Falls back to sofa depth + 3 ft aisle as a minimum distance when unknown.
const tvViewingRule: Rule = ({ items }) => {
  const tv = findByCategory(items, ["tv", "television"]);
  const sofa = findByCategory(items, ["sofa", "sectional", "loveseat"]);
  if (!tv || !sofa) return null;
  const diag = parseTvDiagonal(
    items.find((i) => i === tv)?.placement ? `${tv.dims?.width}"` : undefined,
  ) ?? (tv.dims?.width ? tv.dims.width : null);
  if (!diag) return null;

  // Estimate distance: use sofa depth + typical 60-72" breathing room.
  // If placement suggests specific distance ("8 feet from sofa"), honor it.
  const tvPlace = (tv.placement || "").toLowerCase();
  const sofaPlace = (sofa.placement || "").toLowerCase();
  let distanceIn: number | null = null;
  const footMatch =
    tvPlace.match(/(\d+(?:\.\d+)?)\s*(?:ft|feet|'|foot)\s*(?:from|away)/i) ||
    sofaPlace.match(/(\d+(?:\.\d+)?)\s*(?:ft|feet|'|foot)\s*(?:from|away)/i);
  if (footMatch) distanceIn = parseFloat(footMatch[1]) * 12;
  else {
    // Assume opposing walls in a modest living room — crude 120" fallback
    distanceIn = 120;
  }

  const minGood = diag * 1.5;
  const maxGood = diag * 2.5;
  const passed = distanceIn >= minGood && distanceIn <= maxGood;
  return {
    id: "tv_distance: 1.5-2.5 × diagonal",
    scope: "tv+seating",
    applicable: true,
    passed,
    actual: `TV ~${diag}" diagonal at ~${Math.round(distanceIn / 12)} ft`,
    expected: `${Math.round(minGood / 12)}-${Math.round(maxGood / 12)} ft viewing distance`,
    item: "tv",
    issue: passed ? undefined
      : distanceIn < minGood
        ? `TV (${Math.round(diag)}") is too close at ~${Math.round(distanceIn / 12)} ft — viewers will see pixel grid / strain eyes`
        : `TV (${Math.round(diag)}") is too far at ~${Math.round(distanceIn / 12)} ft — details will be lost`,
    suggestion: `Seat ${Math.round(minGood / 12)}-${Math.round(maxGood / 12)} ft from the screen (or resize TV to ${Math.round(distanceIn / 2)}"-${Math.round(distanceIn / 1.5)}")`,
  };
};

// Desk depth ≥ 24" — a monitor + keyboard + elbow rest needs this.
const deskDepthRule: Rule = ({ items }) => {
  const desk = findByCategory(items, ["desk", "writing_desk", "office_desk"]);
  if (!desk || !desk.dims) return null;
  const passed = desk.dims.depth >= 24;
  return {
    id: "desk.depth ≥ 24",
    scope: "desk",
    applicable: true,
    passed,
    actual: `${Math.round(desk.dims.depth)}" deep`,
    expected: `≥ 24" (monitor + keyboard + forearm rest)`,
    item: "desk",
    issue: passed ? undefined
      : `Desk only ${Math.round(desk.dims.depth)}" deep — no room for a monitor + keyboard + forearms`,
    suggestion: `Upgrade to a desk ≥ 24" deep (ideal 28-30")`,
  };
};

// Dining/office chair seat height vs table/desk top:
// 10-13" clearance from seat to top for comfortable seated work/eating.
const chairSeatClearanceRule = (
  chairAliases: string[],
  surfaceAliases: string[],
  scope: string,
  minClear = 10,
  maxClear = 13,
): Rule => ({ items }) => {
  const chair = findByCategory(items, chairAliases);
  const surface = findByCategory(items, surfaceAliases);
  if (!chair || !surface || !chair.dims?.height || !surface.dims?.height) return null;
  const clearance = surface.dims.height - chair.dims.height;
  const passed = clearance >= minClear && clearance <= maxClear;
  return {
    id: `${scope}_clearance: ${minClear}-${maxClear}"`,
    scope,
    applicable: true,
    passed,
    actual: `seat-to-top = ${Math.round(clearance)}"`,
    expected: `${minClear}-${maxClear}"`,
    item: chair.category,
    issue: passed ? undefined
      : `${chair.category} seat-to-${surface.category} top = ${Math.round(clearance)}" — outside ${minClear}-${maxClear}" ergonomic range`,
    suggestion: `Pick a chair/${surface.category} pairing with ${minClear}-${maxClear}" seat clearance`,
  };
};

// Pendant over dining table / island: bottom 30-36" above surface.
// Item is pendant; anchor is dining_table or kitchen_island.
const pendantHeightRule: Rule = ({ items }) => {
  const pendant = findByCategory(items, ["pendant_light", "chandelier"]);
  const surface =
    findByCategory(items, ["dining_table", "kitchen_island", "island"]);
  if (!pendant || !surface || !surface.dims?.height) return null;
  // We expect "hung 32 inches above" or similar in placement; otherwise skip.
  const place = (pendant.placement || "").toLowerCase();
  const m = place.match(/(\d{2})\s*["-]?\s*(?:inch|in|"|')?\s*(?:above|over|from)/i);
  if (!m) return null;
  const above = parseFloat(m[1]);
  const passed = above >= 30 && above <= 36;
  return {
    id: "pendant.height above surface: 30-36\"",
    scope: "pendant+surface",
    applicable: true,
    passed,
    actual: `${above}" above ${surface.category}`,
    expected: `30-36" above`,
    item: "pendant_light",
    issue: passed ? undefined
      : above < 30
        ? `Pendant hung too low (${above}") — heads will hit it`
        : `Pendant hung too high (${above}") — loses intimate light pool`,
    suggestion: `Target 30-36" bottom-to-surface`,
  };
};

// Counter to upper cabinet gap — should be 15-20".
// Mostly relevant in kitchens; requires parse of placement text.
const counterUpperRule: Rule = ({ items }) => {
  const upper = findByCategory(items, ["upper_cabinet", "wall_cabinet"]);
  if (!upper) return null;
  // Look for "18 inch above counter" in placement
  const m = (upper.placement || "").toLowerCase().match(
    /(\d{2})\s*["-]?\s*(?:inch|in|"|')?\s*above\s+(?:the\s+)?(?:counter|countertop)/i,
  );
  if (!m) return null;
  const above = parseFloat(m[1]);
  const passed = above >= 15 && above <= 20;
  return {
    id: "upper_cabinet gap: 15-20\"",
    scope: "kitchen",
    applicable: true,
    passed,
    actual: `${above}" above counter`,
    expected: `15-20"`,
    item: "upper_cabinet",
    issue: passed ? undefined
      : above < 15
        ? `Upper cabinet too low (${above}" above counter) — blocks small appliances`
        : `Upper cabinet too high (${above}" above counter) — unreachable top shelves`,
    suggestion: `Mount 15-20" above counter (18" is the classic default)`,
  };
};

const RULES: Rule[] = [
  tvViewingRule,
  deskDepthRule,
  chairSeatClearanceRule(
    ["dining_chair"], ["dining_table"], "dining", 10, 13,
  ),
  chairSeatClearanceRule(
    ["desk_chair", "office_chair", "task_chair"], ["desk", "writing_desk"], "desk", 9, 13,
  ),
  pendantHeightRule,
  counterUpperRule,
];

// ─── Main computation ─────────────────────────────────────────────────

export function computeErgonomics(
  analysis: Record<string, unknown>,
  context: { roomType?: string } = {},
): ErgonomicsResult {
  const whatItNeeds =
    (analysis.what_it_needs as Array<{
      category: string;
      specs?: string;
      placement?: string;
      dimensions?: Dims | null;
    }>) || [];

  const catCounts = new Map<string, number>();
  for (const item of whatItNeeds) {
    const c = normalizeCategory(item.category);
    catCounts.set(c, (catCounts.get(c) ?? 0) + 1);
  }
  const seen = new Set<string>();
  const items: ErgoItem[] = [];
  for (const item of whatItNeeds) {
    const c = normalizeCategory(item.category);
    if (seen.has(c)) continue;
    seen.add(c);
    items.push({
      category: c,
      dims: extractDims(item),
      placement: item.placement,
      count: catCounts.get(c) ?? 1,
    });
  }

  const ruleResults: ErgonomicsResult["rule_results"] = [];
  const issues: ErgonomicsResult["issues"] = [];
  let checks = 0;
  let passes = 0;

  for (const rule of RULES) {
    const result = rule({ items, roomType: context.roomType });
    if (!result || !result.applicable) continue;
    checks++;
    if (result.passed) passes++;
    ruleResults.push({
      rule: result.id,
      scope: result.scope,
      passed: !!result.passed,
      actual: result.actual ?? "",
      expected: result.expected ?? "",
    });
    if (!result.passed && result.issue) {
      issues.push({
        scope: result.scope,
        item: result.item ?? "",
        issue: result.issue,
        suggestion: result.suggestion ?? "",
      });
    }
  }

  // Kitchen work triangle — only if we can detect the 3 legs
  if (context.roomType?.toLowerCase().includes("kitchen")) {
    const sink = findByCategory(items, ["sink"]);
    const stove = findByCategory(items, ["stove", "range", "cooktop"]);
    const fridge = findByCategory(items, ["fridge", "refrigerator"]);
    if (sink && stove && fridge) {
      // Without coordinates we can only sanity-check existence; full distance
      // validation requires XY placement. Surface as informational.
      checks++;
      passes++;
      ruleResults.push({
        rule: "kitchen work triangle: sink/stove/fridge present",
        scope: "kitchen",
        passed: true,
        actual: "all 3 legs specified",
        expected: "sink + stove + fridge within 4-9 ft each, total 12-26 ft",
      });
    }
  }

  const score = checks === 0 ? 0.9 : passes / checks;
  return {
    score: round2(score),
    rule_results: ruleResults,
    issues,
  };
}

export function formatErgonomicsForPrompt(result: ErgonomicsResult): string {
  const lines: string[] = [];
  lines.push(`### Ergonomics & Viewing Distances: ${result.score.toFixed(2)}/1.0`);
  if (result.rule_results.length === 0) {
    lines.push("- No applicable ergonomics rules (insufficient data)");
    return lines.join("\n");
  }
  for (const r of result.rule_results) {
    const mark = r.passed ? "✓" : "✗";
    lines.push(`- ${mark} ${r.rule}: ${r.actual} (expected ${r.expected})`);
  }
  for (const i of result.issues) {
    lines.push(`- FIX: ${i.item} — ${i.suggestion}`);
  }
  return lines.join("\n");
}

export function getErgonomicsIssuesForItem(
  result: ErgonomicsResult,
  category: string,
): string[] {
  const cat = normalizeCategory(category);
  return result.issues
    .filter((i) => i.item === cat || cat.includes(i.item) || i.item.includes(cat))
    .map((i) => i.issue);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
