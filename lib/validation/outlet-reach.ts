// Outlet / electrical-reach validator.
//
// `analysis.outlet_positions` is a free-text description of where outlets sit
// ("south wall flanking window, one on east wall near door"). Powered items
// (lamps, TVs, desks, media consoles, kitchen appliances) need to sit within
// ~6 ft (one cord reach) of an outlet, OR explicitly be on a wall that has one.
//
// Without XY coordinates we do zone-level matching: tokenize outlet positions
// into zones, tokenize each powered item's placement, and flag items whose
// zones share nothing with any outlet zone.
//
// Complements spatial-graph.ts; uses the same zone vocabulary.

// Canonical zone tokens (shared vocabulary with spatial-graph.ts)
const ZONE_TOKENS: Array<{ pattern: RegExp; canonical: string }> = [
  { pattern: /\bnorth\s*wall\b/i, canonical: "north_wall" },
  { pattern: /\bsouth\s*wall\b/i, canonical: "south_wall" },
  { pattern: /\beast\s*wall\b/i, canonical: "east_wall" },
  { pattern: /\bwest\s*wall\b/i, canonical: "west_wall" },
  { pattern: /\bleft\s*wall\b/i, canonical: "left_wall" },
  { pattern: /\bright\s*wall\b/i, canonical: "right_wall" },
  { pattern: /\bback\s*wall\b/i, canonical: "back_wall" },
  { pattern: /\bfront\s*wall\b/i, canonical: "front_wall" },
  { pattern: /\bwindow\s*wall\b/i, canonical: "window_wall" },
  { pattern: /\bfireplace\s*wall\b/i, canonical: "fireplace_wall" },
  { pattern: /\bentry\s*wall\b/i, canonical: "entry_wall" },
  { pattern: /\bnear\s+window|under\s+window|by\s+the?\s*window|flanking\s+window/i, canonical: "near_window" },
  { pattern: /\bnear\s+door|by\s+the?\s*door|near\s+entry|by\s+entry/i, canonical: "near_door" },
  { pattern: /\bbetween\s+windows?\b/i, canonical: "between_windows" },
  { pattern: /\bopposite\s+(?:the?\s*)?door|opposite\s+entry/i, canonical: "opposite_door" },
  { pattern: /\bcorner\b/i, canonical: "corner" },
  { pattern: /\b(?:center|middle)\b/i, canonical: "center" },
];

function tokenizeZones(placement: string): string[] {
  const zones: string[] = [];
  for (const { pattern, canonical } of ZONE_TOKENS) {
    if (pattern.test(placement)) zones.push(canonical);
  }
  return [...new Set(zones)];
}

// Two zones are "reachable" if they're the same, OR one is a soft anchor
// (corner/center near wall) that typically shares a wall with cardinal zones.
function zonesIntersect(a: string[], b: string[]): boolean {
  if (a.some((z) => b.includes(z))) return true;
  const soft = new Set(["near_window", "near_door", "center", "corner"]);
  // If an outlet is on a wall and the item is at a soft anchor, assume reachable
  // when no other zone info given.
  if (a.length === 0 || b.length === 0) return false;
  const aSoft = a.every((z) => soft.has(z));
  const bSoft = b.every((z) => soft.has(z));
  return aSoft || bSoft;
}

// Items that require power to function.
const POWERED_CATEGORIES = new Set([
  "tv", "television", "media_console", "tv_stand", "entertainment_center",
  "floor_lamp", "table_lamp", "desk_lamp", "reading_lamp",
  "pendant_light", "chandelier", "wall_sconce",
  "desk", "office_desk", "writing_desk",
  "computer", "monitor",
  "refrigerator", "fridge", "stove", "range", "microwave",
  "dishwasher", "oven",
  "fan", "ceiling_fan", "air_purifier", "humidifier",
  "speaker", "sound_bar", "soundbar",
  "record_player", "turntable",
]);

// Hard-wired items that don't count as outlet-dependent (built-in).
const HARDWIRED_CATEGORIES = new Set([
  "ceiling_light", "recessed_light", "chandelier", "pendant_light",
  "ceiling_fan", "ceiling_fan_light",
]);

function normalizeCategory(c: string): string {
  return c.toLowerCase().replace(/[\s-]+/g, "_");
}

export interface OutletReachResult {
  /** 0-1 score — fraction of powered items within reach of an outlet */
  score: number;
  outlet_zones: string[];
  per_item: Array<{
    category: string;
    placement_zones: string[];
    reachable: boolean;
    reason: string;
  }>;
  issues: Array<{
    category: string;
    issue: string;
    suggestion: string;
  }>;
  warnings: string[];
}

export function computeOutletReach(
  analysis: Record<string, unknown>,
): OutletReachResult {
  const outletText = (analysis.outlet_positions as string | undefined) ?? "";
  const outletZones = tokenizeZones(outletText);
  const warnings: string[] = [];
  if (!outletText) {
    warnings.push("No outlet_positions — skipping reach checks");
  } else if (outletZones.length === 0) {
    warnings.push(`outlet_positions too vague ("${outletText.slice(0, 40)}...") to tokenize zones`);
  }

  const whatItNeeds =
    (analysis.what_it_needs as Array<{
      category: string;
      placement?: string;
      specs?: string;
    }>) || [];

  const perItem: OutletReachResult["per_item"] = [];
  const issues: OutletReachResult["issues"] = [];
  let checks = 0;
  let passes = 0;

  for (const item of whatItNeeds) {
    const cat = normalizeCategory(item.category);
    const isPowered = [...POWERED_CATEGORIES].some((k) => cat === k || cat.includes(k));
    const isHardwired = [...HARDWIRED_CATEGORIES].some((k) => cat === k || cat.includes(k));
    if (!isPowered || isHardwired) continue;
    if (outletZones.length === 0) {
      // Can't evaluate without outlet data — skip without penalty
      continue;
    }
    const placeZones = tokenizeZones(item.placement || "");
    if (placeZones.length === 0) {
      // Vague placement — surface a soft warning, don't penalize hard
      perItem.push({
        category: cat,
        placement_zones: [],
        reachable: true, // benefit of the doubt
        reason: "placement too vague to match against outlets",
      });
      continue;
    }
    checks++;
    const reachable = zonesIntersect(outletZones, placeZones);
    if (reachable) passes++;
    perItem.push({
      category: cat,
      placement_zones: placeZones,
      reachable,
      reason: reachable
        ? `placement (${placeZones.join(", ")}) overlaps outlet zone(s) (${outletZones.join(", ")})`
        : `placement (${placeZones.join(", ")}) does not reach any outlet zone (${outletZones.join(", ")})`,
    });
    if (!reachable) {
      issues.push({
        category: cat,
        issue: `${cat} placed in ${placeZones.join("/")} but outlets are only in ${outletZones.join("/")} — cord won't reach without running across room`,
        suggestion: `Move ${cat} onto a wall with an outlet, or add an extension cord/surge strip discreetly routed; alternatively specify an electrician add`,
      });
    }
  }

  const score = checks === 0 ? 0.9 : passes / checks;

  return {
    score: round2(score),
    outlet_zones: outletZones,
    per_item: perItem,
    issues,
    warnings,
  };
}

export function formatOutletReachForPrompt(result: OutletReachResult): string {
  const lines: string[] = [];
  lines.push(`### Outlet Reach: ${result.score.toFixed(2)}/1.0`);
  lines.push(`- Outlet zones: ${result.outlet_zones.length ? result.outlet_zones.join(", ") : "(unknown)"}`);
  for (const w of result.warnings) lines.push(`- NOTE: ${w}`);
  for (const p of result.per_item) {
    const mark = p.reachable ? "✓" : "✗";
    lines.push(`- ${mark} ${p.category}: ${p.reason}`);
  }
  for (const i of result.issues) {
    lines.push(`- FIX: ${i.category} — ${i.suggestion}`);
  }
  return lines.join("\n");
}

export function getOutletReachIssuesForItem(
  result: OutletReachResult,
  category: string,
): string[] {
  const cat = normalizeCategory(category);
  return result.issues
    .filter((i) => i.category === cat || cat.includes(i.category) || i.category.includes(cat))
    .map((i) => i.issue);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
