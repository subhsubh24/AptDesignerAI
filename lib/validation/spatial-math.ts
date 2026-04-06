// Spatial constraint scoring: room coverage, clearance checks, placement conflicts

export interface SpatialConstraintResult {
  room_coverage_ratio: number; // 0-1
  clearance_score: number; // 0-1
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

const DIMENSION_REGEX =
  /(\d+(?:\.\d+)?)\s*(?:[-–x×]\s*(\d+(?:\.\d+)?))?\s*(?:[-–x×]\s*(\d+(?:\.\d+)?))?\s*(inches?|in|"|ft|feet|foot|cm|mm|'|'')?/gi;

function parseInches(value: number, unit?: string): number {
  if (!unit) return value; // Assume inches
  const u = unit.toLowerCase().replace(/\.$/, "");
  if (u === "ft" || u === "feet" || u === "foot" || u === "'") return value * 12;
  if (u === "cm") return value / 2.54;
  if (u === "mm") return value / 25.4;
  return value; // inches, in, ", ''
}

export function parseDimensions(specs: string): Dimensions | null {
  DIMENSION_REGEX.lastIndex = 0;
  const match = DIMENSION_REGEX.exec(specs);
  if (!match) return null;

  const v1 = parseFloat(match[1]);
  const v2 = match[2] ? parseFloat(match[2]) : undefined;
  const v3 = match[3] ? parseFloat(match[3]) : undefined;
  const unit = match[4];

  if (v3 !== undefined && v2 !== undefined) {
    // W x D x H
    return {
      width: parseInches(v1, unit),
      depth: parseInches(v2, unit),
      height: parseInches(v3, unit),
    };
  }
  if (v2 !== undefined) {
    // W x D
    return {
      width: parseInches(v1, unit),
      depth: parseInches(v2, unit),
    };
  }
  // Single dimension — assume square-ish for area calculation
  const side = parseInches(v1, unit);
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
    // It's a map like { living_room: "12x15", bedroom: "10x12" }
    const roomKey = (roomType || "living_room").toLowerCase().replace(/[\s-]+/g, "_");
    const obj = raw as Record<string, unknown>;
    const val = obj[roomKey] || obj.living_room;
    if (typeof val === "string") dimString = val;
  }

  if (dimString) {
    const match = dimString.match(
      /(\d+(?:\.\d+)?)\s*['']?\s*(?:x|×|by)\s*(\d+(?:\.\d+)?)\s*['']?/i
    );
    if (match) {
      const w = parseFloat(match[1]) * 12; // Assume feet, convert to inches
      const d = parseFloat(match[2]) * 12;
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
          totalFootprint += dims.width * dims.depth;
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

  // 2. Clearance checks
  const violations: SpatialConstraintResult["violations"] = [];
  let clearancesPassed = 0;
  let clearancesTotal = 0;

  for (const item of whatItNeeds) {
    const rules = getClearanceRules(item.category);
    if (rules.length === 0) continue;

    // We can't measure actual clearance without a spatial solver,
    // but we can check if the item dimensions + placement leave room
    const dims = item.specs ? parseDimensions(item.specs) : null;

    for (const rule of rules) {
      clearancesTotal++;
      if (roomDims && dims) {
        // Check if item is too large relative to room
        const maxAllowed = Math.min(roomDims.width, roomDims.depth) - rule.min * 2;
        const itemSpan = Math.max(dims.width, dims.depth);
        if (itemSpan > maxAllowed && maxAllowed > 0) {
          violations.push({
            item: item.category,
            constraint: rule.context,
            actual: `${Math.round(itemSpan)}"`,
            required: `≤${Math.round(maxAllowed)}" (leaves ${rule.min}" clearance)`,
          });
        } else {
          clearancesPassed++;
        }
      } else {
        // Can't verify → assume OK (neutral)
        clearancesPassed++;
      }
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
          // Some pairs are OK (side table + sofa, nightstand + bed)
          const pair = `${items[i]}|${items[j]}`.toLowerCase();
          const naturalPairs = [
            "sofa|side_table", "side_table|sofa",
            "bed|nightstand", "nightstand|bed",
            "desk|desk_chair", "desk_chair|desk",
            "dining_table|dining_chair", "dining_chair|dining_table",
          ];
          if (!naturalPairs.some((np) => pair.includes(np.split("|")[0]) && pair.includes(np.split("|")[1]))) {
            placementConflicts.push({ item1: items[i], item2: items[j], zone });
          }
        }
      }
    }
  }

  return {
    room_coverage_ratio: Math.round(roomCoverageRatio * 100) / 100,
    clearance_score: Math.round(clearanceScore * 100) / 100,
    violations,
    placement_conflicts: placementConflicts,
  };
}
