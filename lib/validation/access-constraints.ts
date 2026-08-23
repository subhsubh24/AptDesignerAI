// Delivery / access-constraint validator.
//
// Catches the single most expensive real-world failure mode: a $4k sofa that
// cannot physically enter the apartment. Checks large-item dimensions against
// the narrowest access path (entry door, elevator, stairwell turn).
//
// We read loose fields from `building_research` and `project.access`:
//   - entry_door_width / front_door_width (inches)
//   - entry_door_height (inches, optional)
//   - elevator_width / elevator_depth / elevator_height (inches)
//   - stairwell_turn / stair_turn (descriptive — triggers conservative limit)
//   - hallway_width (inches, optional final corridor narrowing)
//   - floor_number (for walk-ups — informational)
//
// Industry rule of thumb: an item fits through a 32" door if its narrowest
// depth is ≤ door width - 1", OR its narrowest dim can be stood on end and
// height ≤ ceiling - 2".
//
// Missing access data → skip with "insufficient_data" flag; we don't fabricate.

import { parseDimensions } from "./spatial-math";
import { categoriesShareToken } from "./category-token-match";

export interface AccessConstraintResult {
  /** 0-1 score. 1 = all large items fit; 0 = impossible delivery. */
  score: number;
  /** Detected access constraints */
  constraints: {
    entry_door_width?: number;
    entry_door_height?: number;
    elevator_width?: number;
    elevator_depth?: number;
    elevator_height?: number;
    stairwell_turn?: boolean;
    hallway_width?: number;
    floor_number?: number;
    has_elevator?: boolean;
  };
  /** Per-item analysis */
  per_item: Array<{
    category: string;
    passed: boolean;
    min_access_dim: number; // tightest reachable dim
    item_narrowest: number;
    reason: string;
  }>;
  issues: Array<{
    category: string;
    issue: string;
    suggestion: string;
  }>;
  /** Reasons we skipped (for transparency) */
  warnings: string[];
}

type Dims = { width: number; depth: number; height?: number };

// Items large enough to warrant an access check. Small items (lamps, accents)
// always fit — don't spam the output.
const LARGE_ITEM_CATEGORIES = new Set([
  "sofa", "sectional", "loveseat", "sleeper_sofa",
  "bed", "king_bed", "queen_bed", "mattress", "headboard",
  "dining_table", "desk", "wardrobe", "armoire", "dresser",
  "bookcase", "bookshelf", "tall_cabinet", "credenza", "sideboard",
  "media_console", "tv_stand", "entertainment_center",
  "coffee_table", "china_cabinet",
]);

function normalizeCategory(c: string): string {
  return c.toLowerCase().replace(/[\s-]+/g, "_");
}

function extractDims(item: { specs?: string; dimensions?: Dims | null }): Dims | null {
  if (item.dimensions && item.dimensions.width && item.dimensions.depth) return item.dimensions;
  if (item.specs) return parseDimensions(item.specs);
  return null;
}

// Parse an inches-or-feet value from a free-form string like "32 in" or "3'".
function parseInchesFromText(text: string | undefined | null): number | null {
  if (!text || typeof text !== "string") return null;
  const s = text.trim();
  // Match "3'6"" style
  const feetInchMatch = s.match(/(\d+)\s*'\s*(\d+)?\s*"?/);
  if (feetInchMatch) {
    return parseFloat(feetInchMatch[1]) * 12 + (feetInchMatch[2] ? parseFloat(feetInchMatch[2]) : 0);
  }
  const m = s.match(/(\d+(?:\.\d+)?)\s*(inches?|in|"|ft|feet|foot)?/i);
  if (!m) return null;
  const v = parseFloat(m[1]);
  const u = (m[2] ?? "").toLowerCase();
  if (u === "ft" || u === "feet" || u === "foot") return v * 12;
  return v; // inches default
}

function readNumberField(
  obj: Record<string, unknown> | undefined,
  keys: string[],
): number | null {
  if (!obj) return null;
  for (const key of keys) {
    const raw = obj[key];
    if (typeof raw === "number" && raw > 0) return raw;
    if (typeof raw === "string") {
      const parsed = parseInchesFromText(raw);
      if (parsed && parsed > 0) return parsed;
    }
  }
  return null;
}

function readBoolField(
  obj: Record<string, unknown> | undefined,
  keys: string[],
): boolean | undefined {
  if (!obj) return undefined;
  for (const key of keys) {
    const raw = obj[key];
    if (typeof raw === "boolean") return raw;
    if (typeof raw === "string") {
      const s = raw.toLowerCase().trim();
      if (["yes", "true", "present", "has", "available"].includes(s)) return true;
      if (["no", "false", "none", "not available", "n/a"].includes(s)) return false;
    }
  }
  return undefined;
}

// ─── Main computation ────────────────────────────────────────────────

export function computeAccessConstraints(
  analysis: Record<string, unknown>,
  context: {
    buildingResearch?: Record<string, unknown>;
    access?: Record<string, unknown>;
  } = {},
): AccessConstraintResult {
  const br = context.buildingResearch || {};
  const access = (context.access || br.access || {}) as Record<string, unknown>;
  // Try access sub-object first, then fall back to building_research root
  const lookup = (keys: string[]) =>
    readNumberField(access, keys) ?? readNumberField(br, keys);

  const constraints: AccessConstraintResult["constraints"] = {
    entry_door_width: lookup(["entry_door_width", "front_door_width", "door_width"]) ?? undefined,
    entry_door_height: lookup(["entry_door_height", "front_door_height"]) ?? undefined,
    elevator_width: lookup(["elevator_width"]) ?? undefined,
    elevator_depth: lookup(["elevator_depth"]) ?? undefined,
    elevator_height: lookup(["elevator_height"]) ?? undefined,
    hallway_width: lookup(["hallway_width", "corridor_width"]) ?? undefined,
    floor_number: lookup(["floor_number", "floor"]) ?? undefined,
    has_elevator: readBoolField(access, ["has_elevator", "elevator"]) ??
                  readBoolField(br, ["has_elevator", "elevator"]),
    stairwell_turn: readBoolField(access, ["stairwell_turn", "stair_turn", "tight_stairs"]) ??
                    readBoolField(br, ["stairwell_turn", "tight_stairs"]),
  };

  // Compute the tightest reachable opening.
  // If elevator exists, item must fit elevator AND entry door.
  // If no elevator and multi-floor, stairwell constraint dominates.
  const widthCandidates: number[] = [];
  if (constraints.entry_door_width) widthCandidates.push(constraints.entry_door_width);
  if (constraints.elevator_width) widthCandidates.push(constraints.elevator_width);
  if (constraints.hallway_width) widthCandidates.push(constraints.hallway_width);
  // Stairwell turn heuristic — 36" effective width for sofa tilt
  if (constraints.stairwell_turn && constraints.has_elevator === false) {
    widthCandidates.push(36);
  }

  const warnings: string[] = [];
  if (widthCandidates.length === 0) {
    warnings.push("No access dimensions in building_research — skipping delivery fit checks");
  }
  const minAccessWidth = widthCandidates.length > 0 ? Math.min(...widthCandidates) : null;

  const whatItNeeds =
    (analysis.what_it_needs as Array<{
      category: string;
      specs?: string;
      dimensions?: Dims | null;
    }>) || [];

  const perItem: AccessConstraintResult["per_item"] = [];
  const issues: AccessConstraintResult["issues"] = [];
  let checks = 0;
  let passes = 0;

  for (const item of whatItNeeds) {
    const cat = normalizeCategory(item.category);
    const isLarge = [...LARGE_ITEM_CATEGORIES].some((k) => cat === k || cat.includes(k));
    if (!isLarge) continue;
    const dims = extractDims(item);
    if (!dims || minAccessWidth === null) continue;

    // Can we fit through the tightest opening?
    // Dimensions we can try: depth, height, width — item passes if ANY single
    // dimension (the "narrow" one) ≤ opening - 1" clearance.
    const candidates = [dims.depth, dims.width, dims.height].filter(
      (d): d is number => typeof d === "number" && d > 0,
    );
    const narrowest = Math.min(...candidates);
    const clearance = 1; // 1" wiggle room
    const passed = narrowest + clearance <= minAccessWidth;
    checks++;
    if (passed) passes++;

    const tightest =
      constraints.elevator_width && constraints.elevator_width === minAccessWidth ? "elevator"
      : constraints.hallway_width && constraints.hallway_width === minAccessWidth ? "hallway"
      : constraints.entry_door_width === minAccessWidth ? "entry door"
      : "access path";
    const reason = passed
      ? `fits (narrowest dim ${Math.round(narrowest)}" ≤ ${tightest} ${Math.round(minAccessWidth)}")`
      : `blocked: narrowest dim ${Math.round(narrowest)}" exceeds ${tightest} ${Math.round(minAccessWidth)}" - ${clearance}" clearance`;

    perItem.push({
      category: cat,
      passed,
      min_access_dim: Math.round(minAccessWidth),
      item_narrowest: Math.round(narrowest),
      reason,
    });

    if (!passed) {
      issues.push({
        category: cat,
        issue: `${cat} (${Math.round(narrowest)}" narrowest) cannot fit through ${tightest} (${Math.round(minAccessWidth)}")`,
        suggestion: `Choose a ${cat} with a dim ≤ ${Math.round(minAccessWidth - clearance)}", a split/modular version, or a knock-down design`,
      });
    }
  }

  // Elevator depth check — does the sofa lie down inside the cab?
  if (constraints.elevator_depth) {
    for (const item of whatItNeeds) {
      const cat = normalizeCategory(item.category);
      if (!(cat.includes("sofa") || cat.includes("sectional") || cat.includes("mattress") || cat.includes("bed"))) continue;
      const dims = extractDims(item);
      if (!dims) continue;
      const longest = Math.max(dims.width, dims.depth, dims.height ?? 0);
      // Item must fit lying on diagonal — approximate needed depth as 70% of longest
      const neededDepth = longest * 0.7;
      if (neededDepth > constraints.elevator_depth) {
        checks++;
        issues.push({
          category: cat,
          issue: `${cat} (${Math.round(longest)}" long) won't fit diagonally in ${Math.round(constraints.elevator_depth)}" elevator cab`,
          suggestion: `Require a hoist/stair delivery or smaller piece (longest dim ≤ ${Math.round(constraints.elevator_depth / 0.7)}")`,
        });
      }
    }
  }

  const score = checks === 0 ? 0.9 : passes / Math.max(checks, 1);

  return {
    score: round2(score),
    constraints,
    per_item: perItem,
    issues,
    warnings,
  };
}

export function formatAccessConstraintsForPrompt(result: AccessConstraintResult): string {
  const lines: string[] = [];
  lines.push(`### Delivery / Access Constraints: ${result.score.toFixed(2)}/1.0`);
  const c = result.constraints;
  const parts: string[] = [];
  if (c.entry_door_width) parts.push(`entry door ${c.entry_door_width}"`);
  if (c.elevator_width) parts.push(`elevator ${c.elevator_width}" × ${c.elevator_depth ?? "?"}"`);
  if (c.stairwell_turn) parts.push("tight stairs");
  if (c.hallway_width) parts.push(`hallway ${c.hallway_width}"`);
  if (parts.length) lines.push(`- Path: ${parts.join(" → ")}`);
  for (const w of result.warnings) lines.push(`- NOTE: ${w}`);
  for (const p of result.per_item) {
    const mark = p.passed ? "✓" : "✗";
    lines.push(`- ${mark} ${p.category}: ${p.reason}`);
  }
  for (const i of result.issues) {
    lines.push(`- FIX: ${i.category} — ${i.suggestion}`);
  }
  return lines.join("\n");
}

export function getAccessIssuesForItem(
  result: AccessConstraintResult,
  category: string,
): string[] {
  const cat = normalizeCategory(category);
  return result.issues
    .filter((i) => categoriesShareToken(cat, i.category))
    .map((i) => i.issue);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
