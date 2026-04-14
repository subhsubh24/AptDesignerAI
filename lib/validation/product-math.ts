/**
 * Mathematical scoring for individual products.
 * Computes deterministic scores for scale fit, palette fit, material fit,
 * value fit, and proportion fit based on product data vs room context.
 * These scores are injected into the LLM prompt and used for composite scoring.
 */

import { lookupColor, lookupMaterial, identifyWoodSpecies, identifyMetalFinish, type HSL } from "./lookups";
import { deltaE2000, hslToLab } from "./color-math";
import { parseDimensions } from "./spatial-math";
import { scoreLifestyleFit, type LifestyleFlags } from "./durability-map";

export interface ProductMathScores {
  scale_fit: number;     // 0-1: product dimensions vs room/placement constraints
  palette_fit: number;   // 0-1: product colors vs recommended palette
  material_fit: number;  // 0-1: product materials vs recommended materials + conflict detection
  value_fit: number;     // 0-1: price positioning within tier
  proportion_fit: number; // 0-1: height relationships, rug sizing, etc.
  /** 0-1: product durability vs resolved lifestyle flags (pets/kids/traffic). 1 = neutral when no flags set. */
  lifestyle_fit: number;
  overall: number;       // 0-1: weighted combination
  issues: string[];      // specific mathematical findings
  /** Per-axis durability sub-scores for prompt transparency. */
  lifestyle_axes?: {
    pet_friendly: number;
    kid_friendly: number;
    high_traffic: number;
    easy_clean: number;
  };
}

interface ProductData {
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
  description?: string;
}

interface ProductMathContext {
  roomType: string;
  budgetMode: string;
  recommendedPalette?: string[];
  recommendedMaterials?: string[];
  existingItems?: string[];
  floorPlan?: Record<string, unknown>;
  placement?: string;
  /** Price range for the target tier [min, max] */
  tierPriceRange?: [number, number];
  /** Materials already used in the room (from other products or existing items) */
  roomWoodSpecies?: string[];
  roomMetalFinishes?: string[];
  /** Resolved lifestyle flags (pets/kids/traffic/WFH) — used for durability scoring. */
  lifestyle?: LifestyleFlags;
}

// HSL → Lab conversion imported from color-math.ts (single source of truth)

// --- Scale fit ---

// Standard size ranges for common furniture categories (inches)
const CATEGORY_SIZE_RANGES: Record<string, { width: [number, number]; depth: [number, number]; height?: [number, number] }> = {
  area_rug: { width: [60, 120], depth: [84, 144] },
  rug: { width: [60, 120], depth: [84, 144] },
  coffee_table: { width: [36, 54], depth: [18, 30], height: [15, 20] },
  side_table: { width: [14, 24], depth: [14, 24], height: [20, 28] },
  end_table: { width: [14, 24], depth: [14, 24], height: [20, 28] },
  dining_table: { width: [48, 84], depth: [30, 42], height: [28, 32] },
  desk: { width: [42, 72], depth: [20, 30], height: [28, 32] },
  nightstand: { width: [16, 28], depth: [14, 22], height: [22, 30] },
  console: { width: [36, 72], depth: [10, 18], height: [28, 36] },
  console_table: { width: [36, 72], depth: [10, 18], height: [28, 36] },
  media_console: { width: [48, 72], depth: [14, 22], height: [20, 30] },
  bookshelf: { width: [24, 48], depth: [10, 16], height: [60, 84] },
  bookcase: { width: [24, 48], depth: [10, 16], height: [60, 84] },
  dresser: { width: [48, 72], depth: [16, 22], height: [30, 40] },
  floor_lamp: { width: [10, 24], depth: [10, 24], height: [58, 72] },
  table_lamp: { width: [8, 18], depth: [8, 18], height: [18, 32] },
  accent_chair: { width: [24, 34], depth: [26, 36], height: [28, 36] },
  sofa: { width: [72, 96], depth: [32, 42], height: [30, 38] },
  bed: { width: [60, 80], depth: [80, 84], height: [36, 60] },
};

function normalizeProductDims(dims: ProductData["dimensions"]): { width: number; depth: number; height?: number } | null {
  if (!dims) return null;
  const toInches = (val: number, unit?: string): number => {
    if (!unit) return val;
    const u = unit.toLowerCase();
    if (u === "cm") return val / 2.54;
    if (u === "mm") return val / 25.4;
    if (u === "ft" || u === "feet") return val * 12;
    return val; // inches
  };
  const unit = dims.unit;
  const w = dims.width ? toInches(dims.width, unit) : dims.diameter ? toInches(dims.diameter, unit) : undefined;
  const d = dims.depth ? toInches(dims.depth, unit) : dims.diameter ? toInches(dims.diameter, unit) : undefined;
  const h = dims.height ? toInches(dims.height, unit) : undefined;
  if (w === undefined && d === undefined) return null;
  return { width: w || d!, depth: d || w!, height: h };
}

function computeScaleFit(product: ProductData, ctx: ProductMathContext): { score: number; issues: string[] } {
  const issues: string[] = [];
  const dims = normalizeProductDims(product.dimensions);
  const cat = (product.category || "").toLowerCase().replace(/[\s-]+/g, "_");

  if (!dims) {
    // Try parsing from title/description
    const textDims = parseDimensions(product.title || "") || parseDimensions(product.description || "");
    if (!textDims) return { score: 0.5, issues: ["No dimensions available for scale check"] };
    return computeScaleFitFromDims(textDims, cat, ctx, issues);
  }

  return computeScaleFitFromDims(dims, cat, ctx, issues);
}

function computeScaleFitFromDims(
  dims: { width: number; depth: number; height?: number },
  category: string,
  ctx: ProductMathContext,
  issues: string[]
): { score: number; issues: string[] } {
  let score = 0.8; // Baseline

  // Check against category standard size ranges
  const range = CATEGORY_SIZE_RANGES[category];
  if (range) {
    const wInRange = dims.width >= range.width[0] && dims.width <= range.width[1];
    const dInRange = dims.depth >= range.depth[0] && dims.depth <= range.depth[1];
    const hInRange = !range.height || !dims.height || (dims.height >= range.height[0] && dims.height <= range.height[1]);

    if (wInRange && dInRange && hInRange) {
      score = 0.95;
    } else {
      if (!wInRange) {
        const deviation = dims.width < range.width[0]
          ? (range.width[0] - dims.width) / range.width[0]
          : (dims.width - range.width[1]) / range.width[1];
        score -= Math.min(deviation * 0.5, 0.3);
        issues.push(`Width ${Math.round(dims.width)}" ${dims.width < range.width[0] ? "below" : "above"} typical ${category} range (${range.width[0]}-${range.width[1]}")`);
      }
      if (!dInRange) {
        const deviation = dims.depth < range.depth[0]
          ? (range.depth[0] - dims.depth) / range.depth[0]
          : (dims.depth - range.depth[1]) / range.depth[1];
        score -= Math.min(deviation * 0.5, 0.3);
        issues.push(`Depth ${Math.round(dims.depth)}" ${dims.depth < range.depth[0] ? "below" : "above"} typical ${category} range (${range.depth[0]}-${range.depth[1]}")`);
      }
      if (!hInRange && dims.height && range.height) {
        const deviation = dims.height < range.height[0]
          ? (range.height[0] - dims.height) / range.height[0]
          : (dims.height - range.height[1]) / range.height[1];
        score -= Math.min(deviation * 0.4, 0.25);
        issues.push(`Height ${Math.round(dims.height)}" ${dims.height < range.height[0] ? "below" : "above"} typical ${category} range (${range.height[0]}-${range.height[1]}")`);
      }
    }
  }

  // Check against room dimensions if available
  if (ctx.floorPlan) {
    const roomDims = ctx.floorPlan.room_dimensions;
    if (roomDims && typeof roomDims === "object") {
      // Parse room dimensions (common formats: "12x15", { width: 12, length: 15 })
      let roomW: number | undefined, roomD: number | undefined;
      const rdStr = typeof roomDims === "string" ? roomDims : JSON.stringify(roomDims);
      const match = rdStr.match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/);
      if (match) {
        roomW = parseFloat(match[1]) * 12; // feet to inches
        roomD = parseFloat(match[2]) * 12;
      }

      if (roomW && roomD) {
        const footprint = dims.width * dims.depth;
        const roomArea = roomW * roomD;
        const ratio = footprint / roomArea;

        // Check if item is absurdly large for room
        if (ratio > 0.4) {
          score -= 0.3;
          issues.push(`Product footprint (${Math.round(dims.width)}x${Math.round(dims.depth)}") is ${Math.round(ratio * 100)}% of room area — too large`);
        }

        // For rugs: should cover 40-70% of room area
        if ((category === "rug" || category === "area_rug") && (ratio < 0.3 || ratio > 0.8)) {
          score -= 0.2;
          issues.push(`Rug covers ${Math.round(ratio * 100)}% of room — ideal is 40-70%`);
        }
      }
    }
  }

  return { score: Math.max(0, Math.min(1, score)), issues };
}

// --- Palette fit ---

function computePaletteFit(product: ProductData, ctx: ProductMathContext): { score: number; issues: string[] } {
  const issues: string[] = [];
  const productColors = product.colors || [];
  const palette = ctx.recommendedPalette || [];

  if (productColors.length === 0 || palette.length === 0) {
    return { score: 0.5, issues: productColors.length === 0 ? ["No product colors available"] : [] };
  }

  // Resolve product colors and palette to HSL/Lab
  const productHsls: Array<{ name: string; hsl: HSL }> = [];
  for (const c of productColors) {
    const hsl = lookupColor(c);
    if (hsl) productHsls.push({ name: c, hsl });
  }

  const paletteHsls: Array<{ name: string; hsl: HSL }> = [];
  for (const c of palette) {
    const hsl = lookupColor(c);
    if (hsl) paletteHsls.push({ name: c, hsl });
  }

  if (productHsls.length === 0 || paletteHsls.length === 0) {
    return { score: 0.5, issues: ["Could not resolve colors for comparison"] };
  }

  // For each product color, find the closest palette color by Delta-E
  let totalMinDeltaE = 0;
  for (const pc of productHsls) {
    let minDe = Infinity;
    let closestPalette = "";
    for (const palC of paletteHsls) {
      const de = deltaE2000(hslToLab(pc.hsl), hslToLab(palC.hsl));
      if (de < minDe) {
        minDe = de;
        closestPalette = palC.name;
      }
    }
    totalMinDeltaE += minDe;

    if (minDe > 40) {
      issues.push(`"${pc.name}" is far from palette (closest: "${closestPalette}", Delta-E=${Math.round(minDe)})`);
    } else if (minDe > 25) {
      issues.push(`"${pc.name}" is moderately distant from palette (closest: "${closestPalette}", Delta-E=${Math.round(minDe)})`);
    }
  }

  const avgDeltaE = totalMinDeltaE / productHsls.length;

  // Score: ≤10 = perfect (1.0), 10-25 = good (0.7-1.0), 25-40 = mediocre (0.5-0.7), >40 = poor (<0.5)
  let score: number;
  if (avgDeltaE <= 10) score = 1.0;
  else if (avgDeltaE <= 25) score = 1.0 - (avgDeltaE - 10) * 0.02;
  else if (avgDeltaE <= 40) score = 0.7 - (avgDeltaE - 25) * 0.013;
  else score = Math.max(0.2, 0.5 - (avgDeltaE - 40) * 0.01);

  return { score: Math.max(0, Math.min(1, score)), issues };
}

// --- Material fit ---

function computeMaterialFit(product: ProductData, ctx: ProductMathContext): { score: number; issues: string[] } {
  const issues: string[] = [];
  const productMaterials = product.materials || [];
  const recommendedMaterials = ctx.recommendedMaterials || [];

  if (productMaterials.length === 0) {
    return { score: 0.5, issues: ["No product materials listed"] };
  }

  let score = 0.7; // Baseline for having materials listed

  // Check material property similarity to recommended materials
  if (recommendedMaterials.length > 0) {
    let matchCount = 0;
    for (const pm of productMaterials) {
      const pmLower = pm.toLowerCase().trim();
      const pmProps = lookupMaterial(pmLower);
      if (!pmProps) continue;

      // Find closest recommended material by property distance
      let bestDist = Infinity;
      for (const rm of recommendedMaterials) {
        const rmProps = lookupMaterial(rm.toLowerCase().trim());
        if (!rmProps) continue;
        const dist = Math.sqrt(
          (pmProps.warmth - rmProps.warmth) ** 2 +
          (pmProps.roughness - rmProps.roughness) ** 2 +
          (pmProps.sheen - rmProps.sheen) ** 2 +
          (pmProps.weight - rmProps.weight) ** 2
        );
        bestDist = Math.min(bestDist, dist);
      }

      if (bestDist < 0.3) matchCount++;
      else if (bestDist > 0.6) {
        issues.push(`"${pm}" property vector is distant from recommended materials (distance=${bestDist.toFixed(2)})`);
      }
    }

    const matchRatio = matchCount / productMaterials.length;
    score = 0.5 + matchRatio * 0.5;
  }

  // Check wood species conflicts
  for (const pm of productMaterials) {
    const species = identifyWoodSpecies(pm);
    if (species && ctx.roomWoodSpecies && ctx.roomWoodSpecies.length >= 2) {
      if (!ctx.roomWoodSpecies.includes(species)) {
        score -= 0.15;
        issues.push(`Wood "${species}" introduces a 3rd wood species (room already has: ${ctx.roomWoodSpecies.join(", ")})`);
      }
    }
  }

  // Check metal finish conflicts
  for (const pm of productMaterials) {
    const metal = identifyMetalFinish(pm);
    if (metal && ctx.roomMetalFinishes) {
      const existingWarm = ctx.roomMetalFinishes.some(m => {
        const f = identifyMetalFinish(m);
        return f?.warm === true;
      });
      const existingCool = ctx.roomMetalFinishes.some(m => {
        const f = identifyMetalFinish(m);
        return f?.warm === false;
      });
      if ((metal.warm && existingCool) || (!metal.warm && existingWarm)) {
        score -= 0.15;
        issues.push(`"${pm}" (${metal.warm ? "warm" : "cool"}) clashes with existing ${metal.warm ? "cool" : "warm"} metals in room`);
      }
    }
  }

  return { score: Math.max(0, Math.min(1, score)), issues };
}

// --- Value fit ---

function computeValueFit(product: ProductData, ctx: ProductMathContext): { score: number; issues: string[] } {
  const issues: string[] = [];

  if (!product.price) {
    return { score: 0.5, issues: ["No price available"] };
  }

  if (!ctx.tierPriceRange) {
    return { score: 0.7, issues: [] }; // No tier range to compare against
  }

  const [tierMin, tierMax] = ctx.tierPriceRange;
  const price = product.price;

  // Within range = good, below range = great value, above range = poor value
  if (price >= tierMin && price <= tierMax) {
    // Position within range (centered is best)
    const mid = (tierMin + tierMax) / 2;
    const rangePct = Math.abs(price - mid) / (tierMax - tierMin);
    return { score: 0.85 + (1 - rangePct) * 0.15, issues: [] };
  }

  if (price < tierMin) {
    // Below range — could be great value or suspiciously cheap
    const underPct = (tierMin - price) / tierMin;
    if (underPct > 0.5) {
      issues.push(`Price $${price} is ${Math.round(underPct * 100)}% below tier minimum $${tierMin} — may indicate quality concerns`);
      return { score: 0.5, issues };
    }
    return { score: 0.9, issues: [] }; // Slightly below = good value
  }

  // Above range
  const overPct = (price - tierMax) / tierMax;
  if (overPct > 0.5) {
    issues.push(`Price $${price} is ${Math.round(overPct * 100)}% above tier maximum $${tierMax}`);
    return { score: 0.3, issues };
  }
  issues.push(`Price $${price} slightly above tier range ($${tierMin}-$${tierMax})`);
  return { score: Math.max(0.4, 0.7 - overPct), issues };
}

// --- Proportion fit (height relationships for specific categories) ---

const HEIGHT_TARGETS: Record<string, { target: number; tolerance: number; description: string }> = {
  coffee_table: { target: 18, tolerance: 2, description: "Coffee table should be ±2\" of sofa seat height (~17-19\")" },
  side_table: { target: 26, tolerance: 3, description: "Side table should match sofa arm height (~24-28\")" },
  end_table: { target: 26, tolerance: 3, description: "End table should match sofa arm height (~24-28\")" },
  nightstand: { target: 26, tolerance: 3, description: "Nightstand should match mattress top height (~24-28\")" },
  dining_table: { target: 30, tolerance: 2, description: "Dining table standard height (28-32\")" },
  desk: { target: 30, tolerance: 2, description: "Desk standard height (28-32\")" },
  console: { target: 30, tolerance: 4, description: "Console standard height (26-34\")" },
  console_table: { target: 30, tolerance: 4, description: "Console table standard height (26-34\")" },
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function computeProportionFit(product: ProductData, _ctx: ProductMathContext): { score: number; issues: string[] } {
  const issues: string[] = [];
  const cat = (product.category || "").toLowerCase().replace(/[\s-]+/g, "_");
  const target = HEIGHT_TARGETS[cat];

  if (!target) return { score: 0.8, issues: [] }; // Category doesn't have height constraints

  const dims = normalizeProductDims(product.dimensions);
  const height = dims?.height;

  if (!height) {
    // Try parsing from title/description
    const textDims = parseDimensions(product.title || "") || parseDimensions(product.description || "");
    if (!textDims?.height) return { score: 0.6, issues: ["No height data for proportion check"] };
    return evaluateHeight(textDims.height, target, issues);
  }

  return evaluateHeight(height, target, issues);
}

function evaluateHeight(
  height: number,
  target: { target: number; tolerance: number; description: string },
  issues: string[]
): { score: number; issues: string[] } {
  const deviation = Math.abs(height - target.target);
  if (deviation <= target.tolerance) {
    return { score: 1.0, issues: [] };
  }
  const penalty = Math.min((deviation - target.tolerance) / 8, 0.5);
  issues.push(`Height ${Math.round(height)}" — ${target.description}`);
  return { score: Math.max(0.3, 1.0 - penalty), issues };
}

// --- Weights ---

const PRODUCT_MATH_WEIGHTS = {
  scale_fit: 0.24,
  palette_fit: 0.20,
  material_fit: 0.20,
  value_fit: 0.12,
  proportion_fit: 0.16,
  lifestyle_fit: 0.08,
};

// --- Main export ---

export function computeProductMathScores(
  product: ProductData,
  ctx: ProductMathContext
): ProductMathScores {
  const scale = computeScaleFit(product, ctx);
  const palette = computePaletteFit(product, ctx);
  const material = computeMaterialFit(product, ctx);
  const value = computeValueFit(product, ctx);
  const proportion = computeProportionFit(product, ctx);

  // Lifestyle fit only scores if there are actual flags (pets/kids/traffic).
  // Otherwise returns a neutral 1.0 so it doesn't drag the overall score.
  const lifestyleFlags = ctx.lifestyle;
  const anyFlag =
    !!lifestyleFlags &&
    (lifestyleFlags.has_pets || lifestyleFlags.has_kids || lifestyleFlags.high_traffic);
  const lifestyle = anyFlag
    ? scoreLifestyleFit(
        { category: product.category, materials: product.materials, colors: product.colors },
        lifestyleFlags!,
      )
    : null;
  const lifestyleScore = lifestyle ? lifestyle.score : 1.0;

  const allIssues = [
    ...scale.issues,
    ...palette.issues,
    ...material.issues,
    ...value.issues,
    ...proportion.issues,
    ...(lifestyle?.issues ?? []),
  ];

  const overall =
    PRODUCT_MATH_WEIGHTS.scale_fit * scale.score +
    PRODUCT_MATH_WEIGHTS.palette_fit * palette.score +
    PRODUCT_MATH_WEIGHTS.material_fit * material.score +
    PRODUCT_MATH_WEIGHTS.value_fit * value.score +
    PRODUCT_MATH_WEIGHTS.proportion_fit * proportion.score +
    PRODUCT_MATH_WEIGHTS.lifestyle_fit * lifestyleScore;

  return {
    scale_fit: round2(scale.score),
    palette_fit: round2(palette.score),
    material_fit: round2(material.score),
    value_fit: round2(value.score),
    proportion_fit: round2(proportion.score),
    lifestyle_fit: round2(lifestyleScore),
    overall: round2(overall),
    issues: allIssues,
    lifestyle_axes: lifestyle
      ? {
          pet_friendly: lifestyle.axes.pet_friendly,
          kid_friendly: lifestyle.axes.kid_friendly,
          high_traffic: lifestyle.axes.high_traffic,
          easy_clean: lifestyle.axes.easy_clean,
        }
      : undefined,
  };
}

/**
 * Format product math scores for injection into the AI scoring prompt.
 */
export function formatProductMathForPrompt(scores: ProductMathScores): string {
  const lines: string[] = [];
  lines.push("## MATHEMATICAL ANALYSIS (computed — these are FACTS, not opinions)");
  lines.push(`Overall math score: ${scores.overall.toFixed(2)}/1.0`);
  lines.push("");
  lines.push(`- Scale fit: ${scores.scale_fit.toFixed(2)}/1.0`);
  lines.push(`- Palette fit: ${scores.palette_fit.toFixed(2)}/1.0`);
  lines.push(`- Material fit: ${scores.material_fit.toFixed(2)}/1.0`);
  lines.push(`- Value fit: ${scores.value_fit.toFixed(2)}/1.0`);
  lines.push(`- Proportion fit: ${scores.proportion_fit.toFixed(2)}/1.0`);
  if (scores.lifestyle_axes) {
    lines.push(
      `- Lifestyle fit: ${scores.lifestyle_fit.toFixed(2)}/1.0 (pet=${scores.lifestyle_axes.pet_friendly.toFixed(2)} kid=${scores.lifestyle_axes.kid_friendly.toFixed(2)} traffic=${scores.lifestyle_axes.high_traffic.toFixed(2)} clean=${scores.lifestyle_axes.easy_clean.toFixed(2)})`,
    );
  }

  if (scores.issues.length > 0) {
    lines.push("");
    lines.push("### Issues found:");
    for (const issue of scores.issues) {
      lines.push(`- ${issue}`);
    }
  }

  lines.push("");
  lines.push("Use these facts to inform your scoring. If the math detects a scale, palette, or material problem, your corresponding score dimension should reflect it. Do NOT score 8+ on a dimension where math found a clear violation.");

  return lines.join("\n");
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
