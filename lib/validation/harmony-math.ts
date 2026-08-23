// Mathematical harmony validation orchestrator
// Combines color, spatial, material, and proportion scoring into a unified result

import { computeColorHarmony, type ColorHarmonyResult } from "./color-math";
import { computeSpatialConstraints, type SpatialConstraintResult } from "./spatial-math";
import { computeMaterialBalance, type MaterialBalanceResult } from "./material-math";
import { computeProportionScores, type ProportionResult } from "./proportion-math";
import {
  computeSpatialGraph,
  getSpatialGraphIssuesForItem,
  formatSpatialGraphForPrompt,
  type SpatialGraphResult,
} from "./spatial-graph";
import {
  computePairwiseProportions,
  getPairwiseIssuesForItem,
  formatPairwiseProportionsForPrompt,
  type PairwiseResult,
} from "./pairwise-proportions";
import {
  computeApartmentCoherence,
  formatDirectionDistanceForPrompt,
  type DirectionDistance,
} from "./direction-distance";
import {
  computeErgonomics,
  formatErgonomicsForPrompt,
  getErgonomicsIssuesForItem,
  type ErgonomicsResult,
} from "./ergonomics";
import {
  computeAccessConstraints,
  formatAccessConstraintsForPrompt,
  getAccessIssuesForItem,
  type AccessConstraintResult,
} from "./access-constraints";
import {
  computeOutletReach,
  formatOutletReachForPrompt,
  getOutletReachIssuesForItem,
  type OutletReachResult,
} from "./outlet-reach";
import {
  computeBudgetAllocation,
  formatBudgetAllocationForPrompt,
  getBudgetIssuesForItem,
  type BudgetAllocationResult,
} from "./budget-allocation";
import {
  computeCodeCompliance,
  formatCodeComplianceForPrompt,
  type CodeComplianceResult,
} from "./code-compliance";
import type { DesignDirection } from "@/lib/types/database";

export interface MathHarmonyItemScore {
  category: string;
  math_score: number; // 0-1
  violations: string[];
}

// (q) Lighting adequacy result
export interface LightingAdequacyResult {
  has_ambient: boolean;
  has_task: boolean;
  has_accent: boolean;
  light_source_count: number;
  adequacy_score: number; // 0-1
  issues: string[];
}

export interface MathHarmonyResult {
  overall: number; // 0-1
  color: ColorHarmonyResult;
  spatial: SpatialConstraintResult;
  material: MaterialBalanceResult;
  proportion: ProportionResult;
  lighting: LightingAdequacyResult;
  /** Topological spatial reasoning — traffic flow, dead zones, sight-lines, adjacency */
  spatial_graph: SpatialGraphResult;
  /** Pairwise furniture-dimension anchoring (coffee table vs sofa, etc.) */
  pairwise_proportions: PairwiseResult;
  /** Cross-apartment direction coherence (present only when sibling directions are supplied) */
  cross_room_directions?: {
    mean_compatibility: number;
    per_room: Array<{ name?: string; distance: DirectionDistance }>;
  };
  /** Ergonomics & viewing-distance rules */
  ergonomics?: ErgonomicsResult;
  /** Delivery / access constraints (door, elevator, stairwell) */
  access_constraints?: AccessConstraintResult;
  /** Outlet-reach check for powered items */
  outlet_reach?: OutletReachResult;
  /** Budget allocation share per category */
  budget_allocation?: BudgetAllocationResult;
  /** Static "code-lite" compliance (IRC egress, natural light, ADA, NEC) */
  code_compliance?: CodeComplianceResult;
  itemScores: MathHarmonyItemScore[];
}

// Weights: spatial heaviest (hard physical constraints).
// spatial_graph + pairwise are small additive contributions — they surface
// violations but don't dominate the score, since they overlap the existing
// spatial + proportion dimensions.
const WEIGHTS = {
  spatial: 0.22,
  color: 0.16,
  material: 0.16,
  proportion: 0.12,
  specificity: 0.11,
  spatial_graph: 0.07,
  pairwise: 0.05,
  ergonomics: 0.04,
  outlet_reach: 0.03,
  budget_allocation: 0.02,
  access_constraints: 0.01,
  code_compliance: 0.01,
};

// (f) Category-specific required fields for meaningful specificity scoring
const CATEGORY_REQUIRED_FIELDS: Record<string, Array<{ field: string; pattern: RegExp; weight: number }>> = {
  area_rug: [
    { field: "dimensions", pattern: /\d+\s*['"]?\s*[x×]\s*\d+/i, weight: 0.25 },
    { field: "material", pattern: /\b(wool|jute|sisal|cotton|polypropylene|silk|nylon|viscose|polyester)\b/i, weight: 0.2 },
    { field: "color", pattern: /\b(cream|ivory|beige|gray|grey|blue|green|terracotta|rust|navy|charcoal|white|black|natural|oatmeal|sage)\b/i, weight: 0.15 },
    { field: "texture", pattern: /\b(hand[- ]knotted|flat[- ]weave|shag|loop|tufted|braided|woven|geometric|abstract|solid|striped)\b/i, weight: 0.1 },
  ],
  rug: [
    { field: "dimensions", pattern: /\d+\s*['"]?\s*[x×]\s*\d+/i, weight: 0.25 },
    { field: "material", pattern: /\b(wool|jute|sisal|cotton|polypropylene|silk|nylon)\b/i, weight: 0.2 },
    { field: "color", pattern: /\b(cream|ivory|beige|gray|grey|blue|green|terracotta|rust|navy)\b/i, weight: 0.15 },
  ],
  coffee_table: [
    { field: "dimensions", pattern: /\d+\s*["']?\s*(inch|in|"|wide|diameter|round)/i, weight: 0.2 },
    { field: "material", pattern: /\b(walnut|oak|marble|glass|stone|wood|metal|concrete|travertine)\b/i, weight: 0.2 },
    { field: "shape", pattern: /\b(round|oval|rectangular|square|organic)\b/i, weight: 0.1 },
    { field: "height", pattern: /\d+\s*["']?\s*(tall|high|height)/i, weight: 0.1 },
  ],
  floor_lamp: [
    { field: "height", pattern: /\d+\s*["']?\s*(tall|high|inch|in|")/i, weight: 0.2 },
    { field: "material", pattern: /\b(brass|iron|steel|chrome|nickel|wood|concrete|marble)\b/i, weight: 0.2 },
    { field: "shade", pattern: /\b(linen|drum|arc|task|torchiere|globe|shade)\b/i, weight: 0.15 },
  ],
  table_lamp: [
    { field: "height", pattern: /\d+\s*["']?\s*(tall|high|inch|in|")/i, weight: 0.2 },
    { field: "material", pattern: /\b(ceramic|glass|brass|marble|stone|wood|concrete)\b/i, weight: 0.2 },
    { field: "shade", pattern: /\b(linen|drum|empire|shade)\b/i, weight: 0.15 },
  ],
  pendant_light: [
    { field: "dimensions", pattern: /\d+\s*["']?\s*(inch|in|"|wide|diameter)/i, weight: 0.2 },
    { field: "material", pattern: /\b(brass|iron|glass|rattan|woven|metal|chrome)\b/i, weight: 0.2 },
  ],
  dining_table: [
    { field: "dimensions", pattern: /\d+\s*["']?\s*(inch|in|"|wide|long|seats)/i, weight: 0.25 },
    { field: "material", pattern: /\b(walnut|oak|marble|wood|glass|concrete)\b/i, weight: 0.2 },
    { field: "seating", pattern: /\b(seats?\s*\d|for\s*\d|person)/i, weight: 0.1 },
  ],
  dining_chair: [
    { field: "material", pattern: /\b(walnut|oak|wood|upholstered|leather|woven|rattan|metal)\b/i, weight: 0.2 },
    { field: "color", pattern: /\b(cream|ivory|beige|gray|black|natural|white|cognac)\b/i, weight: 0.15 },
  ],
  sofa: [
    { field: "dimensions", pattern: /\d+\s*["']?\s*(inch|in|"|wide|long|seat)/i, weight: 0.2 },
    { field: "material", pattern: /\b(linen|velvet|leather|boucle|performance|cotton)\b/i, weight: 0.2 },
    { field: "color", pattern: /\b(cream|ivory|beige|gray|grey|charcoal|navy|green|white|camel)\b/i, weight: 0.15 },
  ],
  accent_chair: [
    { field: "material", pattern: /\b(velvet|linen|boucle|leather|woven|upholstered)\b/i, weight: 0.2 },
    { field: "color", pattern: /\b(cream|ivory|green|blue|rust|cognac|blush|charcoal)\b/i, weight: 0.15 },
    { field: "style", pattern: /\b(mid[- ]century|modern|lounge|club|slipper|wing)\b/i, weight: 0.15 },
  ],
  curtains: [
    { field: "material", pattern: /\b(linen|cotton|velvet|sheer|blackout|silk)\b/i, weight: 0.2 },
    { field: "color", pattern: /\b(white|cream|ivory|natural|oatmeal|beige|gray)\b/i, weight: 0.15 },
    { field: "length", pattern: /\d+\s*["']?\s*(inch|in|"|long|length)/i, weight: 0.15 },
  ],
  wall_art: [
    { field: "dimensions", pattern: /\d+\s*["']?\s*[x×]\s*\d+/i, weight: 0.2 },
    { field: "medium", pattern: /\b(print|canvas|framed|photograph|painting|poster|abstract|landscape)\b/i, weight: 0.2 },
    { field: "color", pattern: /\b(neutral|warm|cool|earth|muted|bold|black|white)\b/i, weight: 0.15 },
  ],
};

function computeSpecificityScore(
  item: { category: string; specs?: string; placement?: string }
): number {
  const catKey = item.category.toLowerCase().replace(/[\s-]+/g, "_");
  const requiredFields = CATEGORY_REQUIRED_FIELDS[catKey];

  // (f) If we have category-specific required fields, score against them
  if (requiredFields && item.specs) {
    let totalWeight = 0;
    let earnedWeight = 0;
    for (const { pattern, weight } of requiredFields) {
      totalWeight += weight;
      if (pattern.test(item.specs)) {
        earnedWeight += weight;
      }
    }
    // Base score from field coverage
    let score = totalWeight > 0 ? 0.4 + 0.5 * (earnedWeight / totalWeight) : 0.5;

    // Bonus for placement specificity
    if (item.placement && item.placement.length > 20) score += 0.1;
    else if (item.placement && item.placement.length > 10) score += 0.05;

    return Math.min(1, score);
  }

  // Fallback: generic scoring for unknown categories
  let score = 0.5;
  if (item.specs) {
    const specLen = item.specs.length;
    if (specLen > 100) score += 0.3;
    else if (specLen > 50) score += 0.2;
    else if (specLen > 20) score += 0.1;
    if (/\d+\s*["'x×-]\s*\d+/.test(item.specs)) score += 0.1;
    if (/\b(walnut|oak|brass|marble|linen|velvet|leather)\b/i.test(item.specs)) score += 0.05;
  }
  if (item.placement && item.placement.length > 10) score += 0.1;
  return Math.min(1, score);
}

// (q) Lighting adequacy validation
const AMBIENT_CATEGORIES = new Set(["pendant_light", "chandelier", "ceiling_light", "ceiling_fan_light", "recessed_light"]);
const TASK_CATEGORIES = new Set(["floor_lamp", "table_lamp", "desk_lamp", "reading_lamp", "under_cabinet_light"]);
const ACCENT_CATEGORIES = new Set(["wall_sconce", "picture_light", "led_strip", "candle"]);

// Minimum recommended light sources by room type
const MIN_LIGHT_SOURCES: Record<string, number> = {
  living_room: 3, bedroom: 2, dining_room: 2, home_office: 2,
  kitchen: 2, bathroom: 2, entryway: 1, nursery: 2,
};

function computeLightingAdequacy(
  analysis: Record<string, unknown>,
  roomType?: string,
): LightingAdequacyResult {
  const whatItNeeds = (analysis.what_it_needs as Array<{ category: string; specs?: string }>) || [];
  const whatWorks = (analysis.what_works as string[]) || [];

  let hasAmbient = false;
  let hasTask = false;
  let hasAccent = false;
  let lightSourceCount = 0;
  const issues: string[] = [];

  // Count light sources in recommendations
  for (const item of whatItNeeds) {
    const cat = item.category.toLowerCase().replace(/[\s-]+/g, "_");
    if (AMBIENT_CATEGORIES.has(cat)) { hasAmbient = true; lightSourceCount++; }
    else if (TASK_CATEGORIES.has(cat)) { hasTask = true; lightSourceCount++; }
    else if (ACCENT_CATEGORIES.has(cat)) { hasAccent = true; lightSourceCount++; }
    // Check if specs mention lighting
    else if (item.specs && /\b(lamp|light|lumen|watt|led)\b/i.test(item.specs)) {
      lightSourceCount++;
    }
  }

  // Count light sources in existing items (what_works)
  for (const item of whatWorks) {
    const lower = item.toLowerCase();
    if (/\b(lamp|light|pendant|chandelier|sconce|fixture)\b/.test(lower)) {
      lightSourceCount++;
      if (/\b(pendant|chandelier|ceiling|overhead)\b/.test(lower)) hasAmbient = true;
      if (/\b(floor lamp|table lamp|desk lamp|reading)\b/.test(lower)) hasTask = true;
      if (/\b(sconce|accent|picture light)\b/.test(lower)) hasAccent = true;
    }
  }

  const roomKey = (roomType || "living_room").toLowerCase().replace(/[\s-]+/g, "_");
  const minSources = MIN_LIGHT_SOURCES[roomKey] || 2;

  if (lightSourceCount < minSources) {
    issues.push(`Only ${lightSourceCount} light source(s) for ${roomKey} — recommend at least ${minSources}`);
  }
  if (!hasAmbient) {
    issues.push("No ambient/overhead lighting — room may feel dim overall");
  }
  if (!hasTask && (roomKey === "home_office" || roomKey === "living_room" || roomKey === "bedroom")) {
    issues.push(`No task lighting for ${roomKey} — reading/working areas will be underlit`);
  }

  // Compute adequacy score
  let score = 0.5;
  if (hasAmbient) score += 0.2;
  if (hasTask) score += 0.15;
  if (hasAccent) score += 0.05;
  if (lightSourceCount >= minSources) score += 0.1;
  if (lightSourceCount >= minSources + 1) score += 0.05; // bonus for extra coverage

  return {
    has_ambient: hasAmbient,
    has_task: hasTask,
    has_accent: hasAccent,
    light_source_count: lightSourceCount,
    adequacy_score: Math.min(1, Math.round(score * 100) / 100),
    issues,
  };
}

export interface ConfidenceIntervalInputs {
  /** The item's harmony_score (0-10). 0 is a legitimate value (e.g. a
   *  dropped item) — callers must NOT coerce it away with `||`. */
  harmonyScore: number | null | undefined;
  hasFloorPlanDims: boolean;
  hasBuildingResearch: boolean;
  hasSpatialViolations: boolean;
  hasCrossRoomData: boolean;
}

export interface ConfidenceIntervalResult {
  low: number;
  high: number;
  uncertainty: number;
  factors: string[];
}

/**
 * Confidence interval around a per-item harmony_score: wider when the
 * underlying data is sparse (no floor plan, no building research, no
 * cross-room context) or the math layer already flagged violations.
 *
 * Extracted from app/api/area-analysis/route.ts so the `harmonyScore`
 * zero-vs-missing distinction (0 is a real, documented score for dropped
 * items — see validation-agent.ts's harmony_score=0 contract) is covered by
 * a direct unit test instead of only living inside a 2000+ line route
 * handler.
 */
export function computeConfidenceInterval(
  inputs: ConfidenceIntervalInputs
): ConfidenceIntervalResult {
  let uncertainty = 0.5; // base uncertainty
  if (!inputs.hasFloorPlanDims) uncertainty += 0.4; // no floor plan dims → spatial scores unreliable
  if (!inputs.hasBuildingResearch) uncertainty += 0.3; // no building research → less context
  if (inputs.hasSpatialViolations) uncertainty += 0.2; // violations introduce uncertainty
  if (!inputs.hasCrossRoomData) uncertainty += 0.2; // no cross-room data

  // `??` (not `||`) — harmony_score=0 is a real, documented value for
  // dropped items and must not be coerced to the 5-point fallback.
  const score = inputs.harmonyScore ?? 5;

  return {
    low: Math.max(0, Math.round((score - uncertainty) * 10) / 10),
    high: Math.min(10, Math.round((score + uncertainty) * 10) / 10),
    uncertainty: Math.round(uncertainty * 10) / 10,
    factors: [
      ...(!inputs.hasFloorPlanDims ? ["no room dimensions"] : []),
      ...(!inputs.hasBuildingResearch ? ["no building research"] : []),
      ...(inputs.hasSpatialViolations ? ["has spatial violations"] : []),
      ...(!inputs.hasCrossRoomData ? ["no cross-room data"] : []),
    ],
  };
}

export function computeHarmonyScores(
  analysis: Record<string, unknown>,
  context: {
    roomType?: string;
    floorPlan?: Record<string, unknown>;
    otherRooms?: Array<{
      palette?: string[];
      materials?: string[];
      name?: string;
      /** Structured DesignDirection for cross-room distance metrics. Optional —
       *  other callers pass a string narrative for prompt formatting instead. */
      directionStructured?: DesignDirection | null;
    }>;
    // (l) Building research for apartment-wide palette anchors
    buildingResearch?: Record<string, unknown>;
    /** This room's structured design direction — used for cross-room distance metrics */
    designDirection?: DesignDirection | null;
    /** Priced recommendations for budget-allocation check (optional) */
    bundle?: Array<{ category: string; price?: number }>;
    /** Whether the unit is marked accessible (gates ADA checks) */
    accessibleUnit?: boolean;
  }
): MathHarmonyResult {
  // (l) Extract apartment-wide palette anchors from building finishes
  const apartmentPaletteAnchors: string[] = [];
  if (context.buildingResearch) {
    const finishes = context.buildingResearch.finishes as Record<string, string> | undefined;
    if (finishes) {
      // Extract color-bearing finish descriptions
      for (const value of Object.values(finishes)) {
        if (value && typeof value === "string" && value !== "not specified") {
          // Extract color words from finish descriptions like "dark walnut hardwood" or "white quartz"
          const colorWords = value.toLowerCase().match(/\b(white|cream|ivory|beige|gray|grey|charcoal|black|brown|walnut|oak|espresso|dark|light|warm|cool|natural|honey|maple|cherry|stainless|brushed|matte|satin|silver|gold|brass|bronze|copper)\b/g);
          if (colorWords) apartmentPaletteAnchors.push(...colorWords);
        }
      }
    }
    // Also extract from design_aesthetic
    const aesthetic = context.buildingResearch.design_aesthetic as string | undefined;
    if (aesthetic) {
      const aestheticColors = aesthetic.toLowerCase().match(/\b(warm|cool|neutral|modern|industrial|minimalist|traditional|contemporary)\b/g);
      if (aestheticColors) apartmentPaletteAnchors.push(...aestheticColors);
    }
  }

  const color = computeColorHarmony(analysis, {
    ...context,
    apartmentPaletteAnchors: [...new Set(apartmentPaletteAnchors)],
  });
  const spatial = computeSpatialConstraints(analysis, context);
  // (q) Compute lighting adequacy
  const lighting = computeLightingAdequacy(analysis, context.roomType);

  const material = computeMaterialBalance(analysis, {
    roomType: context.roomType,
    otherRooms: context.otherRooms,
  });
  const proportion = computeProportionScores(analysis, context);
  const spatialGraph = computeSpatialGraph(analysis, { roomType: context.roomType });
  const pairwise = computePairwiseProportions(analysis);

  // Additional deterministic validators (adjacent gaps).
  // Each is non-fatal: returns a neutral score with warnings when context is
  // insufficient, so missing data never tanks the overall.
  const ergonomics = computeErgonomics(analysis, { roomType: context.roomType });
  const access = computeAccessConstraints(analysis, {
    buildingResearch: context.buildingResearch,
  });
  const outletReach = computeOutletReach(analysis);
  const budgetAlloc = computeBudgetAllocation(analysis, {
    roomType: context.roomType,
    bundle: context.bundle,
  });
  const codeCompliance = computeCodeCompliance(analysis, {
    roomType: context.roomType,
    floorPlan: context.floorPlan,
    accessibleUnit: context.accessibleUnit,
  });

  // Cross-apartment direction coherence — only compute when we have sibling
  // design directions available (validation-agent provides them).
  const siblingDirections = (context.otherRooms || [])
    .map((r) => ({ name: r.name, direction: r.directionStructured }))
    .filter((r): r is { name: string | undefined; direction: DesignDirection } => !!r.direction);
  const crossRoomDirections = siblingDirections.length > 0
    ? computeApartmentCoherence(context.designDirection ?? null, siblingDirections)
    : undefined;

  const whatItNeeds =
    (analysis.what_it_needs as Array<{
      category: string;
      specs?: string;
      placement?: string;
    }>) || [];

  // Per-item math scores
  const itemScores: MathHarmonyItemScore[] = whatItNeeds.map((item) => {
    const violations: string[] = [];

    // Collect item-specific violations
    for (const v of spatial.violations) {
      if (v.item === item.category) {
        violations.push(`${v.constraint}: ${v.actual} (required: ${v.required})`);
      }
    }
    for (const c of spatial.placement_conflicts) {
      if (c.item1 === item.category || c.item2 === item.category) {
        violations.push(`Placement conflict with ${c.item1 === item.category ? c.item2 : c.item1} in ${c.zone}`);
      }
    }
    for (const i of proportion.issues) {
      if (i.item === item.category) {
        violations.push(i.issue);
      }
    }
    for (const msg of getSpatialGraphIssuesForItem(spatialGraph, item.category)) {
      violations.push(msg);
    }
    for (const msg of getPairwiseIssuesForItem(pairwise, item.category)) {
      violations.push(msg);
    }
    for (const msg of getErgonomicsIssuesForItem(ergonomics, item.category)) {
      violations.push(msg);
    }
    for (const msg of getAccessIssuesForItem(access, item.category)) {
      violations.push(`⚠ DELIVERY: ${msg}`);
    }
    for (const msg of getOutletReachIssuesForItem(outletReach, item.category)) {
      violations.push(msg);
    }
    for (const msg of getBudgetIssuesForItem(budgetAlloc, item.category)) {
      violations.push(msg);
    }

    const specificity = computeSpecificityScore(item);

    // (e) Use per-item color fit instead of global palette_harmony for per-item scores
    const perItemColorFit = color.per_item_color_fit?.get(item.category);
    const itemColorScore = perItemColorFit !== undefined
      ? perItemColorFit * 0.7 + color.palette_harmony * 0.3  // Blend per-item (70%) + global (30%)
      : (color.palette_harmony + color.cross_room_coherence) / 2;  // Fallback to global

    // Weighted average of all dimensions.
    // Material uses the same weighted formula as applyMathCaps in route.ts (0.3/0.3/0.2/0.2).
    const materialScore =
      material.material_balance * 0.3 + material.wood_coherence * 0.3 +
      material.metal_coherence * 0.2 + material.soft_hard_ratio * 0.2;
    // Use per-item spatial score if available, otherwise fall back to global average
    const itemSpatialScore = spatial.per_item_spatial?.get(item.category)
      ?? (spatial.room_coverage_ratio + spatial.clearance_score) / 2;
    const mathScore =
      WEIGHTS.color * itemColorScore +
      WEIGHTS.spatial * itemSpatialScore +
      WEIGHTS.material * materialScore +
      WEIGHTS.proportion *
        ((proportion.rug_coverage + proportion.height_relationships + proportion.visual_balance) / 3) +
      WEIGHTS.specificity * specificity +
      WEIGHTS.spatial_graph * spatialGraph.overall +
      WEIGHTS.pairwise * pairwise.score +
      WEIGHTS.ergonomics * ergonomics.score +
      WEIGHTS.outlet_reach * outletReach.score +
      WEIGHTS.budget_allocation * budgetAlloc.score +
      WEIGHTS.access_constraints * access.score +
      WEIGHTS.code_compliance * codeCompliance.score;

    // Penalty for violations
    const violationPenalty = Math.min(violations.length * 0.05, 0.25);
    const finalScore = Math.max(0, mathScore - violationPenalty);

    return {
      category: item.category,
      math_score: Math.round(finalScore * 100) / 100,
      violations,
    };
  });

  // Overall score
  const overall =
    itemScores.length > 0
      ? itemScores.reduce((sum, s) => sum + s.math_score, 0) / itemScores.length
      : 0.5;

  return {
    overall: Math.round(overall * 100) / 100,
    color,
    spatial,
    material,
    proportion,
    lighting,
    spatial_graph: spatialGraph,
    pairwise_proportions: pairwise,
    cross_room_directions: crossRoomDirections,
    ergonomics,
    access_constraints: access,
    outlet_reach: outletReach,
    budget_allocation: budgetAlloc,
    code_compliance: codeCompliance,
    itemScores,
  };
}

/**
 * Format math scores as a text block for injection into the AI validation prompt.
 */
export function formatMathScoresForPrompt(result: MathHarmonyResult): string {
  const lines: string[] = [];

  lines.push("## MATHEMATICAL EVIDENCE (pre-computed measurements and observations)");
  lines.push(`Overall math score: ${result.overall.toFixed(2)}/1.0`);
  lines.push("");

  // Color
  lines.push(`### Color Harmony: ${result.color.palette_harmony.toFixed(2)}/1.0`);
  lines.push(`- Palette scheme: ${result.color.palette_scheme} ✓`);
  lines.push(`- Cross-room coherence: ${result.color.cross_room_coherence.toFixed(2)}/1.0`);
  for (const c of result.color.pair_conflicts) {
    lines.push(`- CONFLICT: "${c.color1}" ↔ "${c.color2}" Delta-E=${c.deltaE} — ${c.issue}`);
  }
  lines.push("");

  // Spatial
  lines.push(`### Spatial Constraints: ${((result.spatial.room_coverage_ratio + result.spatial.clearance_score) / 2).toFixed(2)}/1.0`);
  lines.push(`- Room coverage ratio: ${result.spatial.room_coverage_ratio.toFixed(2)}`);
  lines.push(`- Clearance score: ${result.spatial.clearance_score.toFixed(2)}`);
  for (const v of result.spatial.violations) {
    lines.push(`- VIOLATION: ${v.item} — ${v.constraint} = ${v.actual} (required: ${v.required})`);
  }
  for (const c of result.spatial.placement_conflicts) {
    lines.push(`- CONFLICT: ${c.item1} + ${c.item2} crowded in ${c.zone}`);
  }
  lines.push("");

  // Material — use the same weighted formula as applyMathCaps (0.3/0.3/0.2/0.2)
  const matWeighted = result.material.material_balance * 0.3 + result.material.wood_coherence * 0.3 +
    result.material.metal_coherence * 0.2 + result.material.soft_hard_ratio * 0.2;
  lines.push(`### Material Balance: ${matWeighted.toFixed(2)}/1.0`);
  lines.push(`- Distribution balance: ${result.material.material_balance.toFixed(2)}`);
  lines.push(`- Wood coherence: ${result.material.wood_coherence.toFixed(2)}`);
  lines.push(`- Metal coherence: ${result.material.metal_coherence.toFixed(2)}`);
  lines.push(`- Soft/hard ratio: ${result.material.soft_hard_ratio.toFixed(2)}`);
  for (const c of result.material.conflicts) {
    lines.push(`- CONFLICT: ${c.material1} ↔ ${c.material2} — ${c.issue}`);
  }
  lines.push("");

  // Proportion
  const propAvg = (result.proportion.rug_coverage + result.proportion.height_relationships + result.proportion.visual_balance) / 3;
  lines.push(`### Proportion & Scale: ${propAvg.toFixed(2)}/1.0`);
  lines.push(`- Rug coverage: ${result.proportion.rug_coverage.toFixed(2)}`);
  lines.push(`- Height relationships: ${result.proportion.height_relationships.toFixed(2)}`);
  lines.push(`- Visual balance: ${result.proportion.visual_balance.toFixed(2)}`);
  for (const i of result.proportion.issues) {
    lines.push(`- ISSUE: ${i.item} — ${i.issue}. ${i.suggestion}`);
  }
  lines.push("");

  // (q) Lighting adequacy
  lines.push(`### Lighting Adequacy: ${result.lighting.adequacy_score.toFixed(2)}/1.0`);
  lines.push(`- Light sources: ${result.lighting.light_source_count} (ambient: ${result.lighting.has_ambient ? "yes" : "NO"}, task: ${result.lighting.has_task ? "yes" : "NO"}, accent: ${result.lighting.has_accent ? "yes" : "NO"})`);
  for (const issue of result.lighting.issues) {
    lines.push(`- ISSUE: ${issue}`);
  }
  lines.push("");

  // Spatial graph (traffic flow, dead zones, sight-lines, adjacency)
  lines.push(formatSpatialGraphForPrompt(result.spatial_graph));
  lines.push("");

  // Pairwise proportion rules (coffee table vs sofa, rug vs sofa, etc.)
  lines.push(formatPairwiseProportionsForPrompt(result.pairwise_proportions));
  lines.push("");

  // Cross-apartment direction coherence
  if (result.cross_room_directions && result.cross_room_directions.per_room.length > 0) {
    lines.push(`### Cross-apartment direction coherence: ${result.cross_room_directions.mean_compatibility.toFixed(2)}/1.0`);
    for (const entry of result.cross_room_directions.per_room) {
      lines.push(formatDirectionDistanceForPrompt(entry.distance, entry.name));
    }
    lines.push("");
  }

  // Additional deterministic validators (adjacent gaps)
  if (result.ergonomics) {
    lines.push(formatErgonomicsForPrompt(result.ergonomics));
    lines.push("");
  }
  if (result.access_constraints) {
    lines.push(formatAccessConstraintsForPrompt(result.access_constraints));
    lines.push("");
  }
  if (result.outlet_reach) {
    lines.push(formatOutletReachForPrompt(result.outlet_reach));
    lines.push("");
  }
  if (result.budget_allocation) {
    lines.push(formatBudgetAllocationForPrompt(result.budget_allocation));
    lines.push("");
  }
  if (result.code_compliance) {
    lines.push(formatCodeComplianceForPrompt(result.code_compliance));
    lines.push("");
  }

  // Per-item scores with per-dimension evidence
  lines.push("### Per-item math scores and dimension evidence:");
  lines.push("Each item shows its math score + evidence for each dimension.");
  lines.push("Scores below 9.0 indicate math-detected issues — your sub-scores should reflect these but you may deviate up to ~2 points with reasoning.");
  lines.push("");
  for (const item of result.itemScores) {
    const status = item.violations.length === 0 ? "no violations" : item.violations.join("; ");
    const perItemFit = result.color.per_item_color_fit?.get(item.category);
    const colorEvidence = perItemFit !== undefined
      ? perItemFit * 0.7 + result.color.palette_harmony * 0.3
      : result.color.palette_harmony;
    const spatialEvidence = result.spatial.per_item_spatial?.get(item.category)
      ?? (result.spatial.room_coverage_ratio + result.spatial.clearance_score) / 2;
    const crossRoomEvidence = result.color.cross_room_coherence;

    const toVal = (x: number) => Math.round(Math.max(x * 10, 2.0) * 10) / 10;
    const evidenceStr = [
      colorEvidence < 0.9 ? `color_fit=${toVal(colorEvidence).toFixed(1)} [Delta-E]` : null,
      spatialEvidence < 0.9 ? `spatial_fit=${toVal(spatialEvidence).toFixed(1)} [clearance]` : null,
      crossRoomEvidence < 0.9 ? `cross_room_fit=${toVal(crossRoomEvidence).toFixed(1)} [cross-room]` : null,
    ].filter(Boolean).join(", ");

    lines.push(`- ${item.category}: ${item.math_score.toFixed(2)} | ${status}${evidenceStr ? ` | EVIDENCE: ${evidenceStr}` : " | no issues"}`);
  }
  lines.push("");
  lines.push("Items with clearance violations or high Delta-E conflicts should reflect those in sub-scores. Fix violations in revised_specs/placement.");
  lines.push("For design convention signals (material coherence, visual balance), use your judgment — explain deviations in rationale.");

  return lines.join("\n");
}
