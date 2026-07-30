// Spatial constraint scoring: room coverage, clearance checks, placement conflicts

import { lookupRoomDimension } from "@/lib/floor-plan/room-dimensions";

export interface SpatialConstraintResult {
  room_coverage_ratio: number; // 0-1
  clearance_score: number; // 0-1
  /** Per-item spatial score (0-1): blends room coverage with item-specific clearance pass/fail */
  per_item_spatial: Map<string, number>;
  violations: Array<{
    item: string;
    constraint: string;
    actual: string;
    required: string;
  }>;
  placement_conflicts: Array<{
    item1: string;
    item2: string;
    zone: string;
  }>;
}

// --- Dimension parsing ---

interface Dimensions {
  width: number; // in inches
  depth: number; // in inches
  height?: number; // in inches
}

// Positional dimension form (`72x36x30 inches`, `6' x 4'`, `72" x 36"`).
// Each number carries its OWN optional inline unit, because retail specs put the
// unit BETWEEN the number and the separator (e.g. `6' x 4'` — the foot mark sits
// after `6`, before the `x`). The previous single-trailing-unit regex required
// the `x`/`×`/`-` separator to immediately follow the digits, so `6' x 4'` fell
// into the single-dimension branch and was mislabeled as a 6ft SQUARE (72×72)
// instead of 72×48 — a real bug for rugs, which are almost always specced with
// inline foot marks (`6' x 9'`). Units are ordered longest-first (`inch(?:es)?`
// before `in`, `''` before `'`) so a longer unit is never partially matched.
const UNIT_ALT = `inch(?:es)?|in|feet|foot|ft|cm|mm|''|"|'`;
const DIMENSION_REGEX = new RegExp(
  `(\\d+(?:\\.\\d+)?)\\s*(${UNIT_ALT})?` +
    `\\s*(?:[-–x×]\\s*(\\d+(?:\\.\\d+)?)\\s*(${UNIT_ALT})?)?` +
    `\\s*(?:[-–x×]\\s*(\\d+(?:\\.\\d+)?)\\s*(${UNIT_ALT})?)?`,
  "i",
);

function parseInches(value: number, unit?: string): number {
  if (!unit) return value; // Assume inches
  const u = unit.toLowerCase().replace(/\.$/, "");
  if (u === "ft" || u === "feet" || u === "foot" || u === "'") return value * 12;
  if (u === "cm") return value / 2.54;
  if (u === "mm") return value / 25.4;
  return value; // inches, in, ", ''
}

// Label-suffixed retail format where the unit sits INSIDE each token and a
// W/D/H letter names the axis, e.g. `90"W x 38"D x 32"H` or `90"W × 38"D`.
// The positional DIMENSION_REGEX can't parse this: after `90` it sees `"` (a
// unit, not an `x` separator), so it stops at the first number and mislabels
// the item as a square. Real `WhatItNeedsItem.specs` from the pipeline use this
// exact letter-suffixed form, so without this path the nightstand/side_table/
// dining-depth pairwise rules silently NO-OP in production.
//
// The trailing lookahead requires the axis letter to be followed by a real
// axis boundary — end-of-string, whitespace, a comma, or a multiplication
// separator (`x`/`X`/`×`). This keeps a bare word ("Walnut", "Deep") from being
// read as an axis, WITHOUT swallowing the compact no-space form `90"Wx38"Dx32"H`
// (a plain `(?![A-Za-z])` guard wrongly rejects the `x` separator too, dropping
// axes — the very bug this parser exists to fix).
const LABELED_DIMENSION_REGEX =
  /(\d+(?:\.\d+)?)\s*(inches?|in|"|''|ft|feet|foot|cm|mm|')?\s*([WDH])(?=$|[\s,xX×])/gi;

function parseLabeledDimensions(specs: string): Dimensions | null {
  LABELED_DIMENSION_REGEX.lastIndex = 0;
  const found: { width?: number; depth?: number; height?: number } = {};
  let m: RegExpExecArray | null;
  while ((m = LABELED_DIMENSION_REGEX.exec(specs)) !== null) {
    const value = parseInches(parseFloat(m[1]), m[2]);
    const axis = m[3].toUpperCase();
    if (axis === "W" && found.width === undefined) found.width = value;
    else if (axis === "D" && found.depth === undefined) found.depth = value;
    else if (axis === "H" && found.height === undefined) found.height = value;
  }
  // A labeled parse is only trustworthy with both footprint axes present; a lone
  // "W" leaves width/depth ambiguous, so fall back to the positional parser.
  if (found.width === undefined || found.depth === undefined) return null;
  const dims: Dimensions = { width: found.width, depth: found.depth };
  if (found.height !== undefined) dims.height = found.height;
  return dims;
}

export function parseDimensions(specs: string): Dimensions | null {
  // Prefer the explicit W/D/H labeled form (the shape the pipeline emits); fall
  // back to the positional `72x36x30` form otherwise.
  const labeled = parseLabeledDimensions(specs);
  if (labeled) return labeled;

  const match = DIMENSION_REGEX.exec(specs);
  if (!match) return null;

  const v1 = parseFloat(match[1]);
  const v2 = match[3] ? parseFloat(match[3]) : undefined;
  const v3 = match[5] ? parseFloat(match[5]) : undefined;
  // Per-token units; when a token omits its unit, fall back to the single unit
  // stated once for the whole spec (e.g. `72 x 36 inches` labels only the last).
  const u1 = match[2];
  const u2 = match[4];
  const u3 = match[6];
  const sharedUnit = u1 || u2 || u3;

  if (v3 !== undefined && v2 !== undefined) {
    // W x D x H
    return {
      width: parseInches(v1, u1 || sharedUnit),
      depth: parseInches(v2, u2 || sharedUnit),
      height: parseInches(v3, u3 || sharedUnit),
    };
  }
  if (v2 !== undefined) {
    // W x D
    return {
      width: parseInches(v1, u1 || sharedUnit),
      depth: parseInches(v2, u2 || sharedUnit),
    };
  }
  // Single dimension — assume square-ish for area calculation
  const side = parseInches(v1, u1 || sharedUnit);
  return { width: side, depth: side };
}

// (d) Standard room size ratios for estimation from total sqft
const ROOM_SIZE_RATIOS: Record<string, Record<string, number>> = {
  // room_type → fraction of total apartment sqft
  "1_bed": {
    living_room: 0.25, bedroom: 0.20, kitchen: 0.12,
    dining_room: 0.10, bathroom: 0.06, entryway: 0.04,
  },
  "2_bed": {
    living_room: 0.22, bedroom: 0.15, kitchen: 0.10,
    dining_room: 0.08, bathroom: 0.05, entryway: 0.04,
  },
  "3_bed": {
    living_room: 0.20, bedroom: 0.13, kitchen: 0.09,
    dining_room: 0.07, bathroom: 0.04, entryway: 0.03,
  },
};

// Standard room aspect ratios (width:depth) for estimation
const ROOM_ASPECT_RATIOS: Record<string, number> = {
  living_room: 0.75, // typically wider than deep
  bedroom: 0.85,
  kitchen: 1.2, // often deeper than wide (galley)
  dining_room: 0.9,
  home_office: 0.8,
  bathroom: 0.7,
  entryway: 2.0, // narrow and long
  nursery: 0.9,
};

function parseRoomDimensions(
  floorPlan: Record<string, unknown> | undefined,
  roomType?: string,
): { width: number; depth: number; estimated?: boolean } | null {
  if (!floorPlan) return null;

  // Try room_dimensions field — can be a string ("12x15") or an object ({ living_room: "12x15" })
  const raw = floorPlan.room_dimensions || floorPlan.dimensions || floorPlan.size;

  let dimString: string | null = null;
  if (typeof raw === "string") {
    dimString = raw;
  } else if (raw && typeof raw === "object") {
    // It's a map like { living_room: "12x15", bedroom: "10x12" }. Exact room
    // only — see lib/floor-plan/room-dimensions. Defaulting an unknown or
    // absent room type to `living_room` measured every other room against the
    // living room, and the veto below acts on the result. Returning nothing
    // here is not a loss: (d) below still estimates from total_sqft and marks
    // the result `estimated: true`, which is honest where a neighbour's exact
    // number is not.
    const obj = raw as Record<string, unknown>;
    dimString = lookupRoomDimension(obj, roomType) ?? null;
  }

  if (dimString) {
    // Match dimensions with optional unit suffix (e.g., "12x15 ft", "144x180 in", "15'x20'")
    const match = dimString.match(
      /(\d+(?:\.\d+)?)\s*['']?\s*(?:x|×|by)\s*(\d+(?:\.\d+)?)\s*['']?\s*(?:(ft|feet|foot|in|inches|inch|cm|m|meters?))?/i
    );
    if (match) {
      const val1 = parseFloat(match[1]);
      const val2 = parseFloat(match[2]);
      const unit = (match[3] || "").toLowerCase();

      let w: number, d: number;
      if (unit.startsWith("in") || unit === "inch") {
        // Already in inches
        w = val1;
        d = val2;
      } else if (unit === "cm") {
        w = val1 / 2.54;
        d = val2 / 2.54;
      } else if (unit === "m" || unit.startsWith("meter")) {
        w = val1 * 39.37;
        d = val2 * 39.37;
      } else {
        // Default: assume feet (most common for US floor plans)
        w = val1 * 12;
        d = val2 * 12;
      }
      return { width: w, depth: d };
    }
  }

  // (d) Estimation fallback: derive from total_sqft + room type ratios
  const totalSqft = floorPlan.total_sqft;
  if (totalSqft) {
    const sqftNum = typeof totalSqft === "number" ? totalSqft
      : typeof totalSqft === "string" ? parseFloat(totalSqft.replace(/[^0-9.]/g, ""))
      : NaN;

    if (!isNaN(sqftNum) && sqftNum > 100) {
      // Determine unit type from floor plan context
      const unitType = floorPlan.unit_type_searched as string | undefined;
      const bedCount = unitType?.match(/(\d)/)?.[1] || "1";
      const ratioKey = `${bedCount}_bed`;
      const ratios = ROOM_SIZE_RATIOS[ratioKey] || ROOM_SIZE_RATIOS["1_bed"];

      const roomKey = (roomType || "living_room").toLowerCase().replace(/[\s-]+/g, "_");
      const fraction = ratios[roomKey] || 0.20;
      const roomSqft = sqftNum * fraction;

      // Use aspect ratio to compute width/depth
      const aspect = ROOM_ASPECT_RATIOS[roomKey] || 0.85;
      // area = width * depth, width = depth * aspect
      // area = depth^2 * aspect → depth = sqrt(area/aspect)
      const depthFt = Math.sqrt(roomSqft / aspect);
      const widthFt = depthFt * aspect;

      return {
        width: Math.round(widthFt * 12),
        depth: Math.round(depthFt * 12),
        estimated: true,
      };
    }
  }

  return null;
}

// --- Room type ideal ratios ---

const IDEAL_COVERAGE: Record<string, [number, number]> = {
  living_room: [0.45, 0.65],
  bedroom: [0.40, 0.60],
  dining_room: [0.35, 0.55],
  home_office: [0.35, 0.55],
  kitchen: [0.50, 0.70],
  bathroom: [0.40, 0.60],
  entryway: [0.25, 0.45],
  nursery: [0.35, 0.55],
};

function getIdealCoverage(roomType: string): [number, number] {
  const key = roomType.toLowerCase().replace(/[\s-]+/g, "_");
  return IDEAL_COVERAGE[key] || [0.40, 0.60];
}

// --- Clearance requirements (inches) ---

interface ClearanceRule {
  min: number; // minimum clearance in inches
  context: string;
  hard: boolean; // hard constraint = mandatory, soft = recommended
}

const CLEARANCE_RULES: Record<string, ClearanceRule[]> = {
  // Category → clearance rules
  sofa: [
    { min: 36, context: "main walkway in front", hard: true },
    { min: 18, context: "to coffee table", hard: false },
  ],
  coffee_table: [
    { min: 18, context: "to sofa/seating", hard: false },
    { min: 36, context: "walkway passage", hard: true },
  ],
  dining_table: [
    { min: 24, context: "behind chairs for pullback", hard: true },
    { min: 36, context: "main walkway around dining", hard: true },
  ],
  dining_chair: [
    { min: 24, context: "behind chair pullback", hard: true },
  ],
  bed: [
    { min: 30, context: "beside bed for access", hard: true },
    { min: 36, context: "at foot of bed", hard: false },
  ],
  desk: [
    { min: 30, context: "chair pullback from desk", hard: true },
  ],
  dresser: [
    { min: 36, context: "drawer opening clearance", hard: true },
  ],
  bookcase: [
    { min: 24, context: "standing/browsing space", hard: false },
  ],
  console: [
    { min: 36, context: "entry walkway", hard: true },
  ],
};

function getClearanceRules(category: string): ClearanceRule[] {
  const key = category.toLowerCase().replace(/[\s-]+/g, "_");
  // Check exact match first, then partial
  if (CLEARANCE_RULES[key]) return CLEARANCE_RULES[key];
  for (const [ruleKey, rules] of Object.entries(CLEARANCE_RULES)) {
    if (key.includes(ruleKey) || ruleKey.includes(key)) return rules;
  }
  return [];
}

// --- Footprint weight by category ---
// Not every item with parsed dimensions occupies floor space.
// Wall-mounted, on-furniture, and ceiling items should not inflate the
// room coverage ratio.  Floor coverings (rugs) are flat and add visual
// weight but minimal vertical congestion, so they get a reduced weight.

const FOOTPRINT_WEIGHT: Record<string, number> = {
  // Wall-mounted — zero floor impact
  wall_art: 0, mirror: 0, shelf: 0, floating_shelf: 0,
  picture_light: 0, wall_sconce: 0, wall_clock: 0,
  // On-furniture — zero floor impact (sit on sofas, tables, shelves)
  throw_pillow: 0, throw_pillows: 0, throw_blanket: 0, blanket: 0,
  cushion: 0, tray: 0, vase: 0, candle: 0, decorative: 0,
  table_lamp: 0, desk_lamp: 0, bookends: 0,
  // Floor coverings — reduced (flat, no vertical congestion)
  area_rug: 0.3, rug: 0.3,
  // Ceiling-mounted — zero floor impact
  pendant_light: 0, chandelier: 0, ceiling_light: 0, ceiling_fan: 0,
  // Curtains/drapes — zero floor impact
  curtains: 0, drapes: 0, blinds: 0,
};

function getFootprintWeight(category: string): number {
  const key = category.toLowerCase().replace(/[\s-]+/g, "_");
  if (key in FOOTPRINT_WEIGHT) return FOOTPRINT_WEIGHT[key];
  for (const [ruleKey, weight] of Object.entries(FOOTPRINT_WEIGHT)) {
    if (key.includes(ruleKey) || ruleKey.includes(key)) return weight;
  }
  return 1.0; // Default: full footprint for actual floor furniture
}

// --- Placement zone extraction ---

function extractZone(placement: string): string {
  const lower = placement.toLowerCase();
  // Extract wall/zone references
  const zones = [
    "north wall", "south wall", "east wall", "west wall",
    "left wall", "right wall", "back wall", "front wall",
    "window wall", "entry wall", "fireplace wall",
    "center", "middle", "corner",
    "near window", "near door", "near entry",
    "between windows", "opposite door",
  ];
  for (const zone of zones) {
    if (lower.includes(zone)) return zone;
  }
  // Return first meaningful phrase
  return lower.slice(0, 30);
}

// --- Main computation ---

export function computeSpatialConstraints(
  analysis: Record<string, unknown>,
  context: {
    roomType?: string;
    floorPlan?: Record<string, unknown>;
  }
): SpatialConstraintResult {
  const whatItNeeds =
    (analysis.what_it_needs as Array<{
      category: string;
      specs?: string;
      placement?: string;
    }>) || [];

  const roomDims = parseRoomDimensions(context.floorPlan, context.roomType);

  // 1. Room coverage ratio
  let roomCoverageRatio = 0.7; // Default if we can't compute
  if (roomDims) {
    const roomArea = roomDims.width * roomDims.depth;
    let totalFootprint = 0;
    for (const item of whatItNeeds) {
      if (item.specs) {
        const dims = parseDimensions(item.specs);
        if (dims) {
          totalFootprint += dims.width * dims.depth * getFootprintWeight(item.category);
        }
      }
    }
    if (totalFootprint > 0) {
      const ratio = totalFootprint / roomArea;
      const [idealMin, idealMax] = getIdealCoverage(context.roomType || "living_room");

      if (ratio >= idealMin && ratio <= idealMax) {
        roomCoverageRatio = 1.0;
      } else if (ratio < idealMin) {
        // Under-furnished
        roomCoverageRatio = Math.max(0.5, ratio / idealMin);
      } else {
        // Over-furnished
        roomCoverageRatio = Math.max(0.3, 1 - (ratio - idealMax) / idealMax);
      }
    }
  }

  // 2. Clearance checks — per-item tracking
  const violations: SpatialConstraintResult["violations"] = [];
  let clearancesPassed = 0;
  let clearancesTotal = 0;
  // Track per-item clearance results for per-item spatial scoring
  const itemClearanceResults = new Map<string, { passed: number; total: number }>();

  for (const item of whatItNeeds) {
    const rules = getClearanceRules(item.category);
    if (rules.length === 0) continue;

    let itemPassed = 0;
    let itemTotal = 0;

    // We can't measure actual clearance without a spatial solver,
    // but we can check if the item dimensions + placement leave room
    const dims = item.specs ? parseDimensions(item.specs) : null;

    for (const rule of rules) {
      clearancesTotal++;
      itemTotal++;
      if (roomDims && dims) {
        // Check against both room dimensions, not just the min.
        // Use the longer dimension for items along the primary wall
        // and the shorter for items in constrained positions.
        const maxAllowedShort = Math.min(roomDims.width, roomDims.depth) - rule.min * 2;
        const maxAllowedLong = Math.max(roomDims.width, roomDims.depth) - rule.min * 2;
        const itemSpan = Math.max(dims.width, dims.depth);
        // Item passes if it fits along at least one wall with clearance
        if (itemSpan > maxAllowedLong && maxAllowedLong > 0) {
          // Doesn't fit along ANY wall — definite violation
          violations.push({
            item: item.category,
            constraint: rule.context,
            actual: `${Math.round(itemSpan)}"`,
            required: `≤${Math.round(maxAllowedLong)}" (leaves ${rule.min}" clearance)`,
          });
        } else if (itemSpan > maxAllowedShort && maxAllowedShort > 0) {
          // Fits along the long wall but not the short wall — soft violation
          // Only flag as violation for hard constraints
          if (rule.hard) {
            violations.push({
              item: item.category,
              constraint: rule.context,
              actual: `${Math.round(itemSpan)}"`,
              required: `≤${Math.round(maxAllowedShort)}" on short wall (fits on long wall at ${Math.round(maxAllowedLong)}")`,
            });
            // Give partial credit — it fits on one wall
            itemPassed += 0.5;
            clearancesPassed += 0.5;
          } else {
            // Soft constraint + fits on long wall = pass
            clearancesPassed++;
            itemPassed++;
          }
        } else {
          clearancesPassed++;
          itemPassed++;
        }
      } else {
        // Can't verify → assume OK (neutral)
        clearancesPassed++;
        itemPassed++;
      }
    }
    if (itemTotal > 0) {
      itemClearanceResults.set(item.category, { passed: itemPassed, total: itemTotal });
    }
  }

  const clearanceScore =
    clearancesTotal > 0 ? clearancesPassed / clearancesTotal : 0.7;

  // 3. Placement conflicts (two items in same zone)
  const placementConflicts: SpatialConstraintResult["placement_conflicts"] = [];
  const zoneMap = new Map<string, string[]>();

  for (const item of whatItNeeds) {
    if (item.placement) {
      const zone = extractZone(item.placement);
      if (!zoneMap.has(zone)) zoneMap.set(zone, []);
      zoneMap.get(zone)!.push(item.category);
    }
  }

  for (const [zone, items] of zoneMap) {
    if (items.length > 2) {
      // More than 2 items in one zone is suspicious
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          // Some pairs are OK (side table + sofa, nightstand + bed).
          // Exact category match (not substring) — `side_table_lamp` must not
          // be mistaken for `side_table`, `bed` must not match `headboard`.
          const a = items[i].toLowerCase();
          const b = items[j].toLowerCase();
          const naturalPairSet = new Set<string>([
            "sofa|side_table",
            "bed|nightstand",
            "desk|desk_chair",
            "dining_table|dining_chair",
            // Area rug naturally co-locates with seating area furniture
            "area_rug|coffee_table",
            "area_rug|sofa",
            // Tray sits on coffee table
            "tray|coffee_table",
            // Vase/decor sits on tables
            "vase|dining_table",
            "vase|coffee_table",
          ]);
          const key1 = `${a}|${b}`;
          const key2 = `${b}|${a}`;
          if (!naturalPairSet.has(key1) && !naturalPairSet.has(key2)) {
            placementConflicts.push({ item1: items[i], item2: items[j], zone });
          }
        }
      }
    }
  }

  // 4. Per-item spatial scores — blend room coverage with item-specific clearance
  // Items with less floor impact should be less penalized by room coverage ratio.
  const perItemSpatial = new Map<string, number>();
  for (const item of whatItNeeds) {
    const itemClearance = itemClearanceResults.get(item.category);
    // Items with no clearance rules get full clearance credit
    const itemClearanceScore = itemClearance
      ? itemClearance.passed / itemClearance.total
      : 1.0;
    // Check if this item has placement conflicts
    const hasConflict = placementConflicts.some(
      (c) => c.item1 === item.category || c.item2 === item.category
    );
    const conflictPenalty = hasConflict ? 0.85 : 1.0;
    // Scale coverage weight by floor impact: 0.1 for non-floor items, up to 0.4 for full floor furniture
    const fpWeight = getFootprintWeight(item.category);
    const coverageWeight = 0.1 + 0.3 * fpWeight;
    const clearanceWeight = 1 - coverageWeight;
    const itemSpatial = (roomCoverageRatio * coverageWeight + itemClearanceScore * clearanceWeight) * conflictPenalty;
    perItemSpatial.set(item.category, Math.round(Math.min(1, itemSpatial) * 100) / 100);
  }

  return {
    room_coverage_ratio: Math.round(roomCoverageRatio * 100) / 100,
    clearance_score: Math.round(clearanceScore * 100) / 100,
    per_item_spatial: perItemSpatial,
    violations,
    placement_conflicts: placementConflicts,
  };
}
