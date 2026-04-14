// Spatial graph: adjacency, traffic flow, sight-lines, dead-zone detection.
// Complements spatial-math.ts by reasoning about the room TOPOLOGY rather than
// just clearance/footprint. Parses placement strings into zone tokens, builds
// an adjacency graph of furniture groupings, and derives:
//   - Traffic-flow paths (entry → major groupings → other wall anchors)
//   - Sight-line obstructions (tall items between seating and focal features)
//   - Formal dead zones (room quadrants with zero furniture)
//   - Furniture-zone adjacency (which items are in the same or neighboring zones)

import { parseDimensions } from "./spatial-math";

export interface SpatialNode {
  category: string;
  zone: string;           // canonical zone (e.g., "north_wall", "center")
  anchors: string[];      // all zones this item is anchored to ("near window", "opposite door", ...)
  footprint_sqin: number; // approximate floor footprint
  height_in?: number;     // height if parseable
  isTall: boolean;        // ≥48" → can block sight-lines
  blocksTraffic: boolean; // footprint on floor (not wall-mounted/on-furniture)
}

export interface SpatialGraphResult {
  /** 0-1: blended traffic flow / dead zone / sight-line / adjacency score */
  overall: number;
  /** 0-1: how well primary traffic paths remain unblocked */
  traffic_flow_score: number;
  /** 0-1: coverage of room quadrants by furniture — lower = more dead zones */
  zone_coverage_score: number;
  /** 0-1: sight-line preservation between seating and focal features/windows */
  sight_line_score: number;
  /** 0-1: how well naturally-paired items cluster (sofa+coffee table, bed+nightstand, etc.) */
  adjacency_score: number;
  /** Zones with zero floor-anchored furniture */
  dead_zones: string[];
  /** Traffic conflicts — tall/deep items squarely in entry/primary path */
  traffic_conflicts: Array<{ item: string; path: string; reason: string }>;
  /** Sight-line blocks — tall items obstructing a view corridor */
  sight_line_blocks: Array<{ blocker: string; target: string }>;
  /** Natural pairs that are placed apart (sofa without a coffee table in same zone) */
  broken_pairs: Array<{ item1: string; item2: string; reason: string }>;
  nodes: SpatialNode[];
}

// Canonical zone tokens — parser normalizes free-text placement to one of these.
// Order matters — longer/more specific phrases first so "north wall near window"
// resolves to "north_wall" with "near_window" as a secondary anchor.
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
  { pattern: /\bnear\s+window|under\s+window|by\s+the?\s*window/i, canonical: "near_window" },
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
  return zones.length > 0 ? [...new Set(zones)] : ["unspecified"];
}

function primaryZone(zones: string[]): string {
  // Prefer wall-based zones over region zones — more spatially concrete
  const walls = zones.find((z) => z.endsWith("_wall"));
  if (walls) return walls;
  const specific = zones.find((z) => z !== "unspecified" && z !== "center" && z !== "corner");
  if (specific) return specific;
  return zones[0];
}

// Items that don't take up floor space — ignored for traffic/dead-zone math
const NO_FLOOR_IMPACT = new Set([
  "wall_art", "mirror", "shelf", "floating_shelf", "picture_light", "wall_sconce",
  "wall_clock", "throw_pillow", "throw_pillows", "throw_blanket", "blanket",
  "cushion", "tray", "vase", "candle", "decorative", "table_lamp", "desk_lamp",
  "pendant_light", "chandelier", "ceiling_light", "ceiling_fan", "curtains",
  "drapes", "blinds", "bookends", "area_rug", "rug",
]);

// Tall items (≥48") that can block sight-lines when placed between seating and focal features
const POTENTIALLY_TALL = new Set([
  "bookcase", "bookshelf", "armoire", "wardrobe", "tall_dresser", "cabinet",
  "tall_cabinet", "screen", "room_divider", "floor_lamp", "tree", "plant",
]);

function normalizeCategory(category: string): string {
  return category.toLowerCase().replace(/[\s-]+/g, "_");
}

// Natural furniture pairs — items that should share or border a zone.
// When either member lands far away, flag a broken pair.
const NATURAL_PAIRS: Array<[string, string]> = [
  ["sofa", "coffee_table"],
  ["sofa", "side_table"],
  ["sofa", "end_table"],
  ["bed", "nightstand"],
  ["desk", "desk_chair"],
  ["desk", "office_chair"],
  ["dining_table", "dining_chair"],
  ["media_console", "sofa"],
  ["accent_chair", "side_table"],
  ["vanity", "vanity_stool"],
];

// Items that reasonably share a zone without being counted as duplicates/crowding.
// (Duplicates of the same category are expected — e.g., 6 dining chairs.)
function isExpectedCohabitant(a: string, b: string): boolean {
  if (a === b) return true;
  for (const [x, y] of NATURAL_PAIRS) {
    if ((a === x && b === y) || (a === y && b === x)) return true;
  }
  return false;
}

function buildNode(item: { category: string; specs?: string; placement?: string }): SpatialNode {
  const cat = normalizeCategory(item.category);
  const anchors = item.placement ? tokenizeZones(item.placement) : ["unspecified"];
  const zone = primaryZone(anchors);
  const dims = item.specs ? parseDimensions(item.specs) : null;
  const footprint = dims ? dims.width * dims.depth : 0;
  const height = dims?.height;
  const noFloor = [...NO_FLOOR_IMPACT].some((k) => cat === k || cat.includes(k));
  const isTall =
    (height !== undefined && height >= 48) ||
    [...POTENTIALLY_TALL].some((k) => cat === k || cat.includes(k));
  return {
    category: cat,
    zone,
    anchors,
    footprint_sqin: footprint,
    height_in: height,
    isTall,
    blocksTraffic: !noFloor && footprint > 0,
  };
}

// The 8 canonical zones we expect a real room to touch — used for dead-zone scoring
const ROOM_QUADRANTS = [
  "north_wall", "south_wall", "east_wall", "west_wall",
  "center", "near_window", "near_door", "corner",
];

// Alternative quadrant set when placements use left/right instead of cardinal.
const ROOM_QUADRANTS_LR = [
  "left_wall", "right_wall", "back_wall", "front_wall",
  "center", "near_window", "near_door", "corner",
];

function pickActiveQuadrantSet(nodes: SpatialNode[]): string[] {
  const cardinal = nodes.some((n) =>
    n.anchors.some((a) => ["north_wall", "south_wall", "east_wall", "west_wall"].includes(a)),
  );
  const leftright = nodes.some((n) =>
    n.anchors.some((a) => ["left_wall", "right_wall", "back_wall", "front_wall"].includes(a)),
  );
  // If the prompt mixed schemes or used neither, fall back to cardinal
  if (leftright && !cardinal) return ROOM_QUADRANTS_LR;
  return ROOM_QUADRANTS;
}

// ─── Main computation ────────────────────────────────────────────────────

export function computeSpatialGraph(
  analysis: Record<string, unknown>,
  context: { roomType?: string },
): SpatialGraphResult {
  const whatItNeeds =
    (analysis.what_it_needs as Array<{
      category: string;
      specs?: string;
      placement?: string;
    }>) || [];

  const nodes = whatItNeeds.map(buildNode);
  const floorNodes = nodes.filter((n) => n.blocksTraffic);

  // ─── 1. Zone coverage / dead-zone detection ───────────────────────────
  const quadrants = pickActiveQuadrantSet(nodes);
  const coveredQuadrants = new Set<string>();
  for (const n of floorNodes) {
    for (const anchor of n.anchors) {
      if (quadrants.includes(anchor)) coveredQuadrants.add(anchor);
    }
  }
  // A "dead zone" is a wall or region that the recommendation ignored entirely.
  // We only flag dead WALL zones — center/corner/near_window being empty is OK.
  const wallQuadrants = quadrants.filter((q) => q.endsWith("_wall"));
  const deadZones = wallQuadrants.filter((q) => !coveredQuadrants.has(q));

  // Coverage score: how many walls did we touch? Rooms realistically anchor
  // furniture to 2-3 walls; all 4 is unusual, 0-1 is under-furnished.
  const wallsCovered = wallQuadrants.filter((q) => coveredQuadrants.has(q)).length;
  let zoneCoverageScore: number;
  if (floorNodes.length === 0) {
    zoneCoverageScore = 0.5; // nothing to score
  } else if (wallsCovered === 0 && floorNodes.length >= 3) {
    // Many items but no wall anchors — placement strings too vague
    zoneCoverageScore = 0.5;
  } else if (wallsCovered >= 2) {
    zoneCoverageScore = 1.0;
  } else if (wallsCovered === 1) {
    zoneCoverageScore = 0.75;
  } else {
    zoneCoverageScore = 0.6;
  }

  // ─── 2. Adjacency: naturally paired items should share a zone ─────────
  const brokenPairs: SpatialGraphResult["broken_pairs"] = [];
  // Zone map — which items sit in which zone
  const zoneToItems = new Map<string, string[]>();
  for (const n of floorNodes) {
    for (const z of n.anchors) {
      if (!zoneToItems.has(z)) zoneToItems.set(z, []);
      zoneToItems.get(z)!.push(n.category);
    }
  }

  let pairCheckCount = 0;
  let pairPasses = 0;
  for (const [a, b] of NATURAL_PAIRS) {
    const aNode = floorNodes.find((n) => n.category === a || n.category.includes(a));
    const bNode = floorNodes.find((n) => n.category === b || n.category.includes(b));
    if (!aNode || !bNode) continue;
    pairCheckCount++;
    // Pass if they share at least one anchor zone, OR both are in "unspecified"
    // (no info = don't penalize), OR one is on a wall and the other is adjacent
    const shared = aNode.anchors.some((z) => bNode.anchors.includes(z));
    const adjacent = isAdjacentZone(aNode.zone, bNode.zone);
    if (shared || adjacent || aNode.zone === "unspecified" || bNode.zone === "unspecified") {
      pairPasses++;
    } else {
      brokenPairs.push({
        item1: aNode.category,
        item2: bNode.category,
        reason: `Placed in non-adjacent zones (${aNode.zone} vs ${bNode.zone}) — these items normally cluster together`,
      });
    }
  }
  const adjacencyScore = pairCheckCount === 0 ? 0.9 : pairPasses / pairCheckCount;

  // ─── 3. Traffic flow: entry must stay clear ───────────────────────────
  // Heuristic: any large-footprint item anchored to "near_door" or "entry_wall"
  // that ALSO blocks the center is a traffic conflict. Items in "center" with
  // footprint > 20% of any normal coffee table footprint are flagged too if
  // they are tall (screens, room dividers).
  const trafficConflicts: SpatialGraphResult["traffic_conflicts"] = [];
  for (const n of floorNodes) {
    if (n.anchors.includes("near_door") && n.footprint_sqin > 1500) {
      trafficConflicts.push({
        item: n.category,
        path: "entry → room",
        reason: `Large footprint (${Math.round(n.footprint_sqin)} sq in) placed near the door blocks entry flow`,
      });
    }
    if (n.anchors.includes("center") && n.isTall && n.category !== "dining_table") {
      trafficConflicts.push({
        item: n.category,
        path: "room center",
        reason: `Tall item (${n.height_in ?? "≥48"}") in the room center obstructs traffic`,
      });
    }
  }
  const trafficFlowScore = Math.max(
    0.3,
    1.0 - trafficConflicts.length * 0.25,
  );

  // ─── 4. Sight-line preservation ───────────────────────────────────────
  // Simplified: tall items anchored "between_windows" or blocking "near_window"
  // while the room has a sofa/seating → sight-line block.
  const sightLineBlocks: SpatialGraphResult["sight_line_blocks"] = [];
  const hasSeating = floorNodes.some((n) =>
    ["sofa", "sectional", "loveseat", "accent_chair"].some((k) => n.category.includes(k)),
  );
  if (hasSeating) {
    for (const n of floorNodes) {
      if (!n.isTall) continue;
      // Tall item in center blocks sight-lines to any focal wall
      if (n.anchors.includes("center") && !n.category.includes("dining")) {
        sightLineBlocks.push({
          blocker: n.category,
          target: "focal wall",
        });
      }
      // Tall item on window wall / near window blocks natural light sight-line
      if (
        n.anchors.some((z) => z === "near_window" || z === "window_wall" || z === "between_windows") &&
        !n.category.includes("plant") && // plants near windows are fine
        !n.category.includes("curtain")
      ) {
        sightLineBlocks.push({
          blocker: n.category,
          target: "window / natural light",
        });
      }
    }
  }
  const sightLineScore = Math.max(
    0.4,
    1.0 - sightLineBlocks.length * 0.2,
  );

  // ─── 5. Weighted overall ──────────────────────────────────────────────
  const overall =
    0.30 * trafficFlowScore +
    0.25 * zoneCoverageScore +
    0.25 * adjacencyScore +
    0.20 * sightLineScore;

  return {
    overall: round2(overall),
    traffic_flow_score: round2(trafficFlowScore),
    zone_coverage_score: round2(zoneCoverageScore),
    sight_line_score: round2(sightLineScore),
    adjacency_score: round2(adjacencyScore),
    dead_zones: deadZones,
    traffic_conflicts: trafficConflicts,
    sight_line_blocks: sightLineBlocks,
    broken_pairs: brokenPairs,
    nodes,
  };
}

// Two zones are "adjacent" if they reasonably border each other in a real room.
function isAdjacentZone(a: string, b: string): boolean {
  if (a === b) return true;
  // center is adjacent to every wall
  if (a === "center" || b === "center") return true;
  // near_window / near_door / corner are soft anchors — treat as adjacent
  const softAnchors = new Set(["near_window", "near_door", "between_windows", "corner", "opposite_door"]);
  if (softAnchors.has(a) || softAnchors.has(b)) return true;
  // Cardinal walls that share a corner are adjacent (north-east, north-west, etc.)
  const cardinalPairs: Array<[string, string]> = [
    ["north_wall", "east_wall"], ["north_wall", "west_wall"],
    ["south_wall", "east_wall"], ["south_wall", "west_wall"],
    ["left_wall", "back_wall"], ["right_wall", "back_wall"],
    ["left_wall", "front_wall"], ["right_wall", "front_wall"],
  ];
  return cardinalPairs.some(([x, y]) => (a === x && b === y) || (a === y && b === x));
}

// ─── Format for prompts ─────────────────────────────────────────────────

export function formatSpatialGraphForPrompt(result: SpatialGraphResult): string {
  const lines: string[] = [];
  lines.push(`### Spatial Graph / Traffic Flow: ${result.overall.toFixed(2)}/1.0`);
  lines.push(`- Traffic flow: ${result.traffic_flow_score.toFixed(2)}`);
  lines.push(`- Zone coverage: ${result.zone_coverage_score.toFixed(2)}`);
  lines.push(`- Sight-lines: ${result.sight_line_score.toFixed(2)}`);
  lines.push(`- Adjacency (natural pairs): ${result.adjacency_score.toFixed(2)}`);

  if (result.dead_zones.length > 0) {
    lines.push(`- DEAD ZONES (no floor furniture): ${result.dead_zones.join(", ")}`);
  }
  for (const c of result.traffic_conflicts) {
    lines.push(`- TRAFFIC CONFLICT: ${c.item} on "${c.path}" — ${c.reason}`);
  }
  for (const b of result.sight_line_blocks) {
    lines.push(`- SIGHT-LINE BLOCK: ${b.blocker} obstructs ${b.target}`);
  }
  for (const p of result.broken_pairs) {
    lines.push(`- BROKEN PAIR: ${p.item1} + ${p.item2} — ${p.reason}`);
  }
  return lines.join("\n");
}

// Quick lookup: does a given item have a broken pair or traffic/sight-line issue?
// Used by harmony-math for per-item violation surfacing.
export function getSpatialGraphIssuesForItem(
  result: SpatialGraphResult,
  category: string,
): string[] {
  const cat = normalizeCategory(category);
  const issues: string[] = [];
  for (const c of result.traffic_conflicts) {
    if (c.item === cat) issues.push(`Traffic flow: ${c.reason}`);
  }
  for (const b of result.sight_line_blocks) {
    if (b.blocker === cat) issues.push(`Sight-line: obstructs ${b.target}`);
  }
  for (const p of result.broken_pairs) {
    if (p.item1 === cat || p.item2 === cat) {
      const other = p.item1 === cat ? p.item2 : p.item1;
      issues.push(`Broken pair with ${other}: ${p.reason}`);
    }
  }
  return issues;
}

// Helper: expose cohabitant predicate for downstream modules
export { isExpectedCohabitant };

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
