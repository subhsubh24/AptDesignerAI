/**
 * Mathematical scoring for product bundles.
 * Evaluates how a set of products works together as a complete room concept.
 * Computes deterministic scores for palette harmony, material balance,
 * scale balance, spatial arrangement, and room completeness.
 */

import { lookupColor, lookupMaterial, identifyWoodSpecies, identifyMetalFinish, type HSL, type MaterialProperties } from "./lookups";
import { deltaE2000, hslToLab } from "./color-math";
import { parseDimensions } from "./spatial-math";

export interface BundleMathScores {
  palette_harmony: number;     // 0-1: cross-product color coherence
  material_balance: number;    // 0-1: material variety + conflict detection
  scale_balance: number;       // 0-1: relative proportions between items
  spatial_feasibility: number; // 0-1: total footprint vs room, clearance feasibility
  completeness: number;        // 0-1: coverage of expected functional categories
  price_coherence: number;     // 0-1: within-bundle price consistency
  overall: number;             // 0-1: weighted combination
  issues: string[];
}

interface BundleProduct {
  title?: string;
  category?: string;
  price?: number;
  materials?: string[];
  colors?: string[];
  dimensions?: {
    width?: number;
    depth?: number;
    height?: number;
    diameter?: number;
    unit?: string;
  };
}

interface BundleMathContext {
  roomType: string;
  recommendedPalette?: string[];
  recommendedMaterials?: string[];
  floorPlan?: Record<string, unknown>;
  placementMap?: Record<string, string>;
  existingItems?: string[];
}

// HSL → Lab conversion imported from color-math.ts (single source of truth)

// --- Palette harmony across bundle products ---

function computeBundlePaletteHarmony(products: BundleProduct[], ctx: BundleMathContext): { score: number; issues: string[] } {
  const issues: string[] = [];

  // Collect all colors from all products
  const allProductColors: Array<{ product: string; name: string; hsl: HSL }> = [];
  for (const p of products) {
    for (const c of (p.colors || [])) {
      const hsl = lookupColor(c);
      if (hsl) allProductColors.push({ product: p.title || p.category || "unknown", name: c, hsl });
    }
  }

  if (allProductColors.length < 2) {
    return { score: 0.5, issues: allProductColors.length === 0 ? ["No resolvable colors in bundle"] : [] };
  }

  // Compute average pairwise Delta-E between all products' colors
  let totalDe = 0;
  let pairCount = 0;
  let maxDe = 0;
  let maxPair: [string, string] = ["", ""];

  for (let i = 0; i < allProductColors.length; i++) {
    for (let j = i + 1; j < allProductColors.length; j++) {
      // Only compare cross-product pairs
      if (allProductColors[i].product === allProductColors[j].product) continue;
      const de = deltaE2000(hslToLab(allProductColors[i].hsl), hslToLab(allProductColors[j].hsl));
      totalDe += de;
      pairCount++;
      if (de > maxDe) {
        maxDe = de;
        maxPair = [
          `${allProductColors[i].name} (${allProductColors[i].product})`,
          `${allProductColors[j].name} (${allProductColors[j].product})`,
        ];
      }
    }
  }

  if (pairCount === 0) return { score: 0.7, issues: [] };

  const avgDe = totalDe / pairCount;

  // Also check against recommended palette
  let paletteAlignment = 1.0;
  if (ctx.recommendedPalette && ctx.recommendedPalette.length > 0) {
    const paletteHsls = ctx.recommendedPalette
      .map(c => lookupColor(c))
      .filter((h): h is HSL => h !== null);

    if (paletteHsls.length > 0) {
      let totalMinPaletteDe = 0;
      let resolvedCount = 0;
      for (const pc of allProductColors) {
        let minDe = Infinity;
        for (const ph of paletteHsls) {
          minDe = Math.min(minDe, deltaE2000(hslToLab(pc.hsl), hslToLab(ph)));
        }
        totalMinPaletteDe += minDe;
        resolvedCount++;
      }
      const avgPaletteDe = resolvedCount > 0 ? totalMinPaletteDe / resolvedCount : 0;
      if (avgPaletteDe > 30) {
        paletteAlignment = Math.max(0.5, 1.0 - (avgPaletteDe - 30) / 40);
        issues.push(`Bundle colors average Delta-E=${Math.round(avgPaletteDe)} from recommended palette`);
      }
    }
  }

  // Score: low avg Delta-E between products = coherent palette
  // Ideal: 15-35 (related but varied), <10 = too monotone, >50 = chaotic
  let score: number;
  if (avgDe >= 10 && avgDe <= 35) score = 1.0;
  else if (avgDe < 10) score = 0.75 + (avgDe / 10) * 0.25;
  else if (avgDe <= 50) score = 1.0 - (avgDe - 35) / 30;
  else {
    score = 0.4;
    issues.push(`High color variance across bundle (avg Delta-E=${Math.round(avgDe)}, max: ${maxPair[0]} ↔ ${maxPair[1]})`);
  }

  score = score * 0.6 + paletteAlignment * 0.4; // Blend with palette alignment

  return { score: Math.max(0, Math.min(1, score)), issues };
}

// --- Material balance across bundle ---

function computeBundleMaterialBalance(products: BundleProduct[], ctx: BundleMathContext): { score: number; issues: string[] } {
  const issues: string[] = [];

  // Collect all materials
  const allMaterials: string[] = [];
  const materialProps: MaterialProperties[] = [];
  const woodSpecies = new Set<string>();
  const warmMetals: string[] = [];
  const coolMetals: string[] = [];

  for (const p of products) {
    for (const m of (p.materials || [])) {
      const lower = m.toLowerCase().trim();
      allMaterials.push(lower);
      const props = lookupMaterial(lower);
      if (props) materialProps.push(props);

      const species = identifyWoodSpecies(lower);
      if (species) woodSpecies.add(species);

      const metal = identifyMetalFinish(lower);
      if (metal) {
        if (metal.warm) warmMetals.push(metal.name);
        else coolMetals.push(metal.name);
      }
    }
  }

  if (materialProps.length < 2) {
    return { score: 0.5, issues: materialProps.length === 0 ? ["No resolvable materials in bundle"] : [] };
  }

  // 1. Material variety — count distinct material types
  const materialTypes = new Set<string>();
  for (const m of allMaterials) {
    if (lookupMaterial(m)) {
      const props = lookupMaterial(m)!;
      // Classify by dominant property
      if (props.roughness > 0.5) materialTypes.add("textile/rough");
      else if (props.sheen > 0.6) materialTypes.add("glossy/metal");
      else if (props.weight > 0.8) materialTypes.add("heavy/stone");
      else if (props.warmth > 0.6 && props.roughness < 0.5) materialTypes.add("warm-wood");
      else materialTypes.add("other");
    }
  }

  const varietyScore = materialTypes.size >= 4 ? 1.0
    : materialTypes.size === 3 ? 0.85
    : materialTypes.size === 2 ? 0.65
    : 0.45;

  // 2. Property distribution balance
  const axes: (keyof MaterialProperties)[] = ["warmth", "roughness", "sheen", "weight"];
  let totalVariance = 0;
  for (const axis of axes) {
    const values = materialProps.map(p => p[axis]);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length;
    totalVariance += variance;
  }
  const avgVariance = totalVariance / axes.length;
  const distributionScore = avgVariance >= 0.03 && avgVariance <= 0.12 ? 1.0
    : avgVariance < 0.03 ? 0.65 + (avgVariance / 0.03) * 0.35
    : Math.max(0.4, 1.0 - (avgVariance - 0.12) / 0.15);

  // 3. Wood species conflicts
  let woodScore = 1.0;
  if (woodSpecies.size > 2) {
    woodScore = Math.max(0.4, 1.0 - (woodSpecies.size - 2) * 0.2);
    issues.push(`${woodSpecies.size} wood species in bundle (${[...woodSpecies].join(", ")}) — max 2 recommended`);
  }

  // 4. Metal finish conflicts
  let metalScore = 1.0;
  if (warmMetals.length > 0 && coolMetals.length > 0) {
    metalScore = 0.55;
    issues.push(`Mixing warm metals (${[...new Set(warmMetals)].join(", ")}) with cool metals (${[...new Set(coolMetals)].join(", ")})`);
  }
  const totalMetalTypes = new Set([...warmMetals, ...coolMetals]).size;
  if (totalMetalTypes > 3) {
    metalScore = Math.min(metalScore, 0.5);
    issues.push(`${totalMetalTypes} different metal finishes — too many`);
  }

  // 5. Check against recommended materials
  let recMatchScore = 1.0;
  if (ctx.recommendedMaterials && ctx.recommendedMaterials.length > 0) {
    const recSet = new Set(ctx.recommendedMaterials.map(m => m.toLowerCase().trim()));
    let matchCount = 0;
    for (const m of allMaterials) {
      for (const rec of recSet) {
        if (m.includes(rec) || rec.includes(m)) { matchCount++; break; }
      }
    }
    const matchRatio = allMaterials.length > 0 ? matchCount / allMaterials.length : 0;
    recMatchScore = 0.5 + matchRatio * 0.5;
  }

  const score = varietyScore * 0.25 + distributionScore * 0.2 + woodScore * 0.2 + metalScore * 0.2 + recMatchScore * 0.15;

  return { score: Math.max(0, Math.min(1, score)), issues };
}

// --- Scale balance (relative proportions between items) ---

function toInches(val: number, unit?: string): number {
  if (!unit) return val;
  const u = unit.toLowerCase();
  if (u === "cm") return val / 2.54;
  if (u === "mm") return val / 25.4;
  if (u === "ft" || u === "feet") return val * 12;
  return val;
}

function getNormalizedDims(p: BundleProduct): { w: number; d: number; h?: number } | null {
  if (!p.dimensions) return null;
  const u = p.dimensions.unit;
  const w = p.dimensions.width ? toInches(p.dimensions.width, u) : p.dimensions.diameter ? toInches(p.dimensions.diameter, u) : undefined;
  const d = p.dimensions.depth ? toInches(p.dimensions.depth, u) : p.dimensions.diameter ? toInches(p.dimensions.diameter, u) : undefined;
  if (!w && !d) return null;
  return { w: w || d!, d: d || w!, h: p.dimensions.height ? toInches(p.dimensions.height, u) : undefined };
}

// Relational rules: category A's size relative to category B
const SCALE_RELATIONS: Array<{
  catA: string;
  catB: string;
  rule: string;
  check: (a: { w: number; d: number }, b: { w: number; d: number }) => boolean;
}> = [
  {
    catA: "coffee_table",
    catB: "sofa",
    rule: "Coffee table should be ⅔ to full width of sofa",
    check: (ct, sofa) => ct.w >= sofa.w * 0.5 && ct.w <= sofa.w * 1.1,
  },
  {
    catA: "area_rug",
    catB: "sofa",
    rule: "Rug should extend ≥6\" beyond sofa on each side",
    check: (rug, sofa) => rug.w >= sofa.w + 12,
  },
  {
    catA: "rug",
    catB: "sofa",
    rule: "Rug should extend ≥6\" beyond sofa on each side",
    check: (rug, sofa) => rug.w >= sofa.w + 12,
  },
  {
    catA: "area_rug",
    catB: "dining_table",
    rule: "Rug should extend ≥24\" beyond dining table for chair pullback",
    check: (rug, table) => rug.w >= table.w + 48 && rug.d >= table.d + 48,
  },
  {
    catA: "nightstand",
    catB: "bed",
    rule: "Nightstand should be ≤40% of bed width",
    check: (ns, bed) => ns.w <= bed.w * 0.4,
  },
  {
    catA: "side_table",
    catB: "sofa",
    rule: "Side table should be roughly sofa arm height (within 4\")",
    check: (st: { w: number; d: number; h?: number }, sofa: { w: number; d: number; h?: number }) => {
      if (st.h === undefined || sofa.h === undefined) return true;
      return Math.abs(st.h - sofa.h * 0.85) <= 4;
    },
  },
  {
    catA: "dining_chairs",
    catB: "dining_table",
    rule: "Dining chair seat should be 10-13\" below table top",
    check: (chair: { w: number; d: number; h?: number }, table: { w: number; d: number; h?: number }) => {
      if (chair.h === undefined || table.h === undefined) return true;
      const gap = table.h - chair.h;
      return gap >= 10 && gap <= 13;
    },
  },
];

function computeBundleScaleBalance(products: BundleProduct[], ctx: BundleMathContext): { score: number; issues: string[] } {
  const issues: string[] = [];
  let score = 0.8;

  // Build dimension map by category
  const dimMap = new Map<string, { w: number; d: number; h?: number }>();
  for (const p of products) {
    const cat = (p.category || "").toLowerCase().replace(/[\s-]+/g, "_");
    const dims = getNormalizedDims(p);
    if (dims && cat) dimMap.set(cat, dims);
  }

  // Check relational scale rules
  let rulesChecked = 0;
  let rulesPassed = 0;
  for (const rel of SCALE_RELATIONS) {
    const a = dimMap.get(rel.catA);
    const b = dimMap.get(rel.catB);
    if (a && b) {
      rulesChecked++;
      if (rel.check(a, b)) {
        rulesPassed++;
      } else {
        issues.push(`Scale mismatch: ${rel.rule} (${rel.catA}: ${Math.round(a.w)}x${Math.round(a.d)}", ${rel.catB}: ${Math.round(b.w)}x${Math.round(b.d)}")`);
      }
    }
  }

  if (rulesChecked > 0) {
    score = 0.5 + (rulesPassed / rulesChecked) * 0.5;
  }

  return { score: Math.max(0, Math.min(1, score)), issues };
}

// --- Spatial feasibility (room area coverage, clearance estimation) ---

function parseRoomDimensions(floorPlan: Record<string, unknown>): { roomW: number; roomD: number } | null {
  const rdStr = JSON.stringify(floorPlan.room_dimensions || "");
  const match = rdStr.match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/);
  if (!match) return null;
  return { roomW: parseFloat(match[1]) * 12, roomD: parseFloat(match[2]) * 12 };
}

function computeSpatialFeasibility(products: BundleProduct[], ctx: BundleMathContext): { score: number; issues: string[] } {
  const issues: string[] = [];
  let score = 0.8;

  // Build dimension map by category
  const dimMap = new Map<string, { w: number; d: number; h?: number }>();
  for (const p of products) {
    const cat = (p.category || "").toLowerCase().replace(/[\s-]+/g, "_");
    const dims = getNormalizedDims(p);
    if (dims && cat) dimMap.set(cat, dims);
  }

  if (!ctx.floorPlan) {
    // No floor plan data — can't verify spatial feasibility
    return { score: 0.6, issues: ["No floor plan data available for spatial feasibility check"] };
  }

  const roomDims = parseRoomDimensions(ctx.floorPlan);
  if (!roomDims) return { score: 0.7, issues: [] };

  const { roomW, roomD } = roomDims;
  const roomArea = roomW * roomD;

  // 1. Total footprint coverage ratio
  let totalFootprint = 0;
  for (const [, dims] of dimMap) {
    totalFootprint += dims.w * dims.d;
  }

  if (totalFootprint > 0 && roomArea > 0) {
    const ratio = totalFootprint / roomArea;
    if (ratio > 0.75) {
      score -= 0.25;
      issues.push(`Bundle total footprint is ${Math.round(ratio * 100)}% of room area — likely overcrowded`);
    } else if (ratio > 0.60) {
      score -= 0.1;
      issues.push(`Bundle total footprint is ${Math.round(ratio * 100)}% of room area — may feel tight`);
    } else if (ratio < 0.15) {
      score -= 0.15;
      issues.push(`Bundle total footprint is only ${Math.round(ratio * 100)}% of room area — room may feel empty`);
    } else if (ratio >= 0.25 && ratio <= 0.55) {
      score += 0.1; // Ideal range
    }
  }

  // 2. Estimate walkway clearance: remaining area after furniture should allow 36" main paths
  // Rough heuristic: if room perimeter minus furniture widths along walls leaves < 36" gaps, penalize
  const largestDimension = Math.max(...[...dimMap.values()].map(d => Math.max(d.w, d.d)), 0);
  const smallerRoomDim = Math.min(roomW, roomD);
  if (largestDimension > 0 && largestDimension > smallerRoomDim * 0.65) {
    score -= 0.15;
    issues.push(`Largest piece (${Math.round(largestDimension)}") spans >${Math.round((largestDimension / smallerRoomDim) * 100)}% of room's narrower dimension (${Math.round(smallerRoomDim)}") — may block traffic flow`);
  }

  return { score: Math.max(0, Math.min(1, score)), issues };
}

// --- Room completeness ---

const EXPECTED_CATEGORIES: Record<string, string[]> = {
  living_room: ["sofa", "coffee_table", "area_rug", "floor_lamp", "side_table", "throw_pillows"],
  bedroom: ["bed", "nightstand", "area_rug", "table_lamp", "dresser"],
  dining_room: ["dining_table", "dining_chairs", "pendant_light", "area_rug"],
  home_office: ["desk", "desk_chair", "table_lamp", "bookshelf"],
  entryway: ["console_table", "mirror", "area_rug"],
  nursery: ["crib", "dresser", "area_rug", "table_lamp", "rocking_chair"],
  kitchen: ["bar_stools", "pendant_light", "kitchen_rug"],
  bathroom: ["bath_mat", "mirror", "storage"],
  guest_room: ["bed", "nightstand", "table_lamp", "dresser"],
  studio: ["sofa", "area_rug", "floor_lamp", "coffee_table", "desk", "bookshelf"],
};

function computeCompleteness(products: BundleProduct[], ctx: BundleMathContext): { score: number; issues: string[] } {
  const issues: string[] = [];
  const roomKey = (ctx.roomType || "living_room").toLowerCase().replace(/[\s-]+/g, "_");
  const expected = EXPECTED_CATEGORIES[roomKey] || EXPECTED_CATEGORIES["living_room"];

  const bundleCategories = new Set(
    products.map(p => (p.category || "").toLowerCase().replace(/[\s-]+/g, "_"))
  );

  const missing: string[] = [];
  for (const cat of expected) {
    // Flexible match: "area_rug" matches "rug", "dining_chairs" matches "dining_chair"
    const found = [...bundleCategories].some(bc =>
      bc.includes(cat) || cat.includes(bc) ||
      bc.replace(/s$/, "") === cat.replace(/s$/, "")
    );
    if (!found) missing.push(cat);
  }

  const coverage = expected.length > 0 ? (expected.length - missing.length) / expected.length : 0.7;

  if (missing.length > 0) {
    issues.push(`Missing expected categories: ${missing.join(", ")}`);
  }

  return { score: Math.max(0, Math.min(1, coverage)), issues };
}

// --- Price coherence (within-bundle consistency) ---

function computePriceCoherence(products: BundleProduct[]): { score: number; issues: string[] } {
  const issues: string[] = [];
  const prices = products.map(p => p.price).filter((p): p is number => p !== undefined && p > 0);

  if (prices.length < 2) return { score: 0.7, issues: [] };

  // Check coefficient of variation (relative spread)
  const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
  if (mean === 0) return { score: 0.3, issues: ["All product prices are $0 — invalid bundle pricing"] };
  const stdDev = Math.sqrt(prices.reduce((a, p) => a + (p - mean) ** 2, 0) / prices.length);
  const cv = stdDev / mean;

  // Also check for extreme outliers using proper quartile indices
  const sorted = [...prices].sort((a, b) => a - b);
  const q1 = sorted[Math.max(0, Math.ceil(sorted.length * 0.25) - 1)];
  const q3 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.75) - 1)];
  const iqr = q3 - q1;
  const outliers = prices.filter(p => p < q1 - 1.5 * iqr || p > q3 + 1.5 * iqr);

  let score = 0.8;

  // Moderate CV is fine (different categories have different price ranges)
  // But very high CV suggests incoherent tier
  if (cv > 1.5) {
    score -= 0.2;
    issues.push(`High price variance within bundle (CV=${cv.toFixed(2)}) — mixing very different price levels`);
  } else if (cv > 1.0) {
    score -= 0.1;
  }

  if (outliers.length > 0) {
    const outProducts = products.filter(p => p.price !== undefined && outliers.includes(p.price));
    for (const op of outProducts) {
      issues.push(`"${op.title || op.category}" at $${op.price} is a price outlier (mean: $${Math.round(mean)})`);
    }
    score -= outliers.length * 0.05;
  }

  return { score: Math.max(0.3, Math.min(1, score)), issues };
}

// --- Weights ---

const BUNDLE_MATH_WEIGHTS = {
  palette_harmony: 0.20,
  material_balance: 0.20,
  scale_balance: 0.18,
  spatial_feasibility: 0.15, // using scale_balance for spatial too
  completeness: 0.15,
  price_coherence: 0.12,
};

// --- Main export ---

export function computeBundleMathScores(
  products: BundleProduct[],
  ctx: BundleMathContext
): BundleMathScores {
  const palette = computeBundlePaletteHarmony(products, ctx);
  const material = computeBundleMaterialBalance(products, ctx);
  const scale = computeBundleScaleBalance(products, ctx);
  const spatial = computeSpatialFeasibility(products, ctx);
  const completeness = computeCompleteness(products, ctx);
  const priceCoherence = computePriceCoherence(products);

  const allIssues = [
    ...palette.issues,
    ...material.issues,
    ...scale.issues,
    ...spatial.issues,
    ...completeness.issues,
    ...priceCoherence.issues,
  ];

  const overall =
    BUNDLE_MATH_WEIGHTS.palette_harmony * palette.score +
    BUNDLE_MATH_WEIGHTS.material_balance * material.score +
    BUNDLE_MATH_WEIGHTS.scale_balance * scale.score +
    BUNDLE_MATH_WEIGHTS.spatial_feasibility * spatial.score +
    BUNDLE_MATH_WEIGHTS.completeness * completeness.score +
    BUNDLE_MATH_WEIGHTS.price_coherence * priceCoherence.score;

  return {
    palette_harmony: round2(palette.score),
    material_balance: round2(material.score),
    scale_balance: round2(scale.score),
    spatial_feasibility: round2(spatial.score),
    completeness: round2(completeness.score),
    price_coherence: round2(priceCoherence.score),
    overall: round2(overall),
    issues: allIssues,
  };
}

/**
 * Format bundle math scores for injection into the AI bundle evaluation prompt.
 */
export function formatBundleMathForPrompt(scores: BundleMathScores): string {
  const lines: string[] = [];
  lines.push("## MATHEMATICAL ANALYSIS (computed — these are FACTS, not opinions)");
  lines.push(`Overall bundle math score: ${scores.overall.toFixed(2)}/1.0`);
  lines.push("");
  lines.push(`### Cross-Product Analysis:`);
  lines.push(`- Palette harmony: ${scores.palette_harmony.toFixed(2)}/1.0`);
  lines.push(`- Material balance: ${scores.material_balance.toFixed(2)}/1.0`);
  lines.push(`- Scale balance: ${scores.scale_balance.toFixed(2)}/1.0`);
  lines.push(`- Spatial feasibility: ${scores.spatial_feasibility.toFixed(2)}/1.0`);
  lines.push(`- Room completeness: ${scores.completeness.toFixed(2)}/1.0`);
  lines.push(`- Price coherence: ${scores.price_coherence.toFixed(2)}/1.0`);

  if (scores.issues.length > 0) {
    lines.push("");
    lines.push("### Issues found:");
    for (const issue of scores.issues) {
      lines.push(`- ${issue}`);
    }
  }

  lines.push("");
  lines.push("Use these facts to inform your bundle scoring. If the math finds palette clashes, material conflicts, or scale mismatches between products, your corresponding score dimension should reflect it. Do NOT score 8+ on a dimension where math found a clear violation.");

  return lines.join("\n");
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
