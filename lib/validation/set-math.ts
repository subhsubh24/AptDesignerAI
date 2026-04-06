/**
 * Mathematical scoring for product set validation (validateProductSet).
 * Evaluates cross-product coherence, duplicate detection, tier price
 * differentiation, and collective room coverage for the full product set.
 */

import { lookupColor, lookupMaterial, identifyWoodSpecies, identifyMetalFinish, type HSL, type MaterialProperties } from "./lookups";
import { deltaE2000, hslToLab } from "./color-math";

export interface SetMathScores {
  cross_product_coherence: number; // 0-1: how well all products' colors work together
  material_coherence: number;      // 0-1: material balance, wood/metal conflicts across set
  duplicate_score: number;         // 0-1: 1.0 = no duplicates, lower = suspicious similarity
  tier_differentiation: number;    // 0-1: price separation between budget/middle/luxury
  collective_coverage: number;     // 0-1: does the set cover diverse functional categories
  overall: number;                 // 0-1: weighted combination
  issues: string[];
  per_product: Array<{
    title: string;
    category: string;
    math_harmony: number; // 0-1: this product's fit with the rest
    issues: string[];
  }>;
}

interface SetProduct {
  title: string;
  category: string;
  tier: string;
  materials?: string[];
  colors?: string[];
  price?: number;
  description?: string;
  dimensions?: {
    width?: number;
    depth?: number;
    height?: number;
    diameter?: number;
    unit?: string;
  };
  visual_style_tags?: string[];
}

interface SetMathContext {
  roomType: string;
  designDirection: string;
  existingItems: string[];
  recommendedPalette?: string[];
  recommendedMaterials?: string[];
  floorPlan?: Record<string, unknown>;
}

// HSL → Lab conversion imported from color-math.ts (single source of truth)

// --- Cross-product color coherence ---

function computeColorCoherence(products: SetProduct[], ctx: SetMathContext): {
  score: number;
  issues: string[];
  perProduct: Map<string, { score: number; issues: string[] }>;
} {
  const issues: string[] = [];
  const perProduct = new Map<string, { score: number; issues: string[] }>();

  // Resolve all product colors
  const productColorMap = new Map<string, Array<{ name: string; hsl: HSL }>>();
  for (const p of products) {
    const key = p.title;
    const resolved: Array<{ name: string; hsl: HSL }> = [];
    for (const c of (p.colors || [])) {
      const hsl = lookupColor(c);
      if (hsl) resolved.push({ name: c, hsl });
    }
    productColorMap.set(key, resolved);
  }

  // Resolve palette
  const paletteHsls: HSL[] = [];
  if (ctx.recommendedPalette) {
    for (const c of ctx.recommendedPalette) {
      const hsl = lookupColor(c);
      if (hsl) paletteHsls.push(hsl);
    }
  }

  // For each product, compute its average Delta-E distance to all other products' colors
  for (const p of products) {
    const pColors = productColorMap.get(p.title) || [];
    if (pColors.length === 0) {
      perProduct.set(p.title, { score: 0.5, issues: ["No resolvable colors"] });
      continue;
    }

    let totalDist = 0;
    let pairCount = 0;
    const pIssues: string[] = [];

    // Distance to other products
    for (const [otherTitle, otherColors] of productColorMap) {
      if (otherTitle === p.title || otherColors.length === 0) continue;
      for (const pc of pColors) {
        for (const oc of otherColors) {
          const de = deltaE2000(hslToLab(pc.hsl), hslToLab(oc.hsl));
          totalDist += de;
          pairCount++;
          if (de > 55) {
            pIssues.push(`"${pc.name}" clashes with "${oc.name}" of ${otherTitle} (Delta-E=${Math.round(de)})`);
          }
        }
      }
    }

    // Distance to recommended palette
    let paletteDist = 0;
    let paletteCount = 0;
    if (paletteHsls.length > 0) {
      for (const pc of pColors) {
        let minDe = Infinity;
        for (const ph of paletteHsls) {
          minDe = Math.min(minDe, deltaE2000(hslToLab(pc.hsl), hslToLab(ph)));
        }
        paletteDist += minDe;
        paletteCount++;
      }
    }

    const avgCrossDist = pairCount > 0 ? totalDist / pairCount : 30;
    const avgPaletteDist = paletteCount > 0 ? paletteDist / paletteCount : 20;

    // Score: moderate distance is ideal (15-35 = varied but cohesive)
    let crossScore = avgCrossDist <= 35 ? 1.0 : Math.max(0.3, 1.0 - (avgCrossDist - 35) / 40);
    if (avgCrossDist < 5) crossScore = 0.7; // Too similar = monotone

    let paletteScore = avgPaletteDist <= 20 ? 1.0 : Math.max(0.3, 1.0 - (avgPaletteDist - 20) / 40);

    const productScore = crossScore * 0.6 + paletteScore * 0.4;
    perProduct.set(p.title, { score: Math.round(productScore * 100) / 100, issues: pIssues });
  }

  // Overall = average of per-product scores
  const allScores = [...perProduct.values()].map(v => v.score);
  const overallScore = allScores.length > 0 ? allScores.reduce((a, b) => a + b, 0) / allScores.length : 0.5;

  return { score: Math.round(overallScore * 100) / 100, issues, perProduct };
}

// --- Material coherence ---

function computeMaterialCoherence(products: SetProduct[]): {
  score: number;
  issues: string[];
  perProduct: Map<string, { score: number; issues: string[] }>;
} {
  const issues: string[] = [];
  const perProduct = new Map<string, { score: number; issues: string[] }>();

  // Collect all materials across set
  const allWoodSpecies = new Set<string>();
  const allWarmMetals = new Set<string>();
  const allCoolMetals = new Set<string>();
  const allMaterialProps: MaterialProperties[] = [];

  for (const p of products) {
    for (const m of (p.materials || [])) {
      const lower = m.toLowerCase().trim();
      const species = identifyWoodSpecies(lower);
      if (species) allWoodSpecies.add(species);
      const metal = identifyMetalFinish(lower);
      if (metal) {
        if (metal.warm) allWarmMetals.add(metal.name);
        else allCoolMetals.add(metal.name);
      }
      const props = lookupMaterial(lower);
      if (props) allMaterialProps.push(props);
    }
  }

  // Global wood/metal conflict checks
  if (allWoodSpecies.size > 2) {
    issues.push(`${allWoodSpecies.size} wood species across set (${[...allWoodSpecies].join(", ")}) — max 2 recommended`);
  }
  if (allWarmMetals.size > 0 && allCoolMetals.size > 0) {
    issues.push(`Mixing warm metals (${[...allWarmMetals].join(", ")}) with cool metals (${[...allCoolMetals].join(", ")}) across set`);
  }

  // Per-product: check if each product's materials align with the set
  for (const p of products) {
    const pIssues: string[] = [];
    let pScore = 0.8;

    for (const m of (p.materials || [])) {
      const lower = m.toLowerCase().trim();

      // Wood conflict
      const species = identifyWoodSpecies(lower);
      if (species && allWoodSpecies.size > 2 && ![...allWoodSpecies].slice(0, 2).includes(species)) {
        pScore -= 0.15;
        pIssues.push(`"${m}" is a 3rd+ wood species`);
      }

      // Metal conflict
      const metal = identifyMetalFinish(lower);
      if (metal) {
        if (metal.warm && allCoolMetals.size > 0) {
          pScore -= 0.1;
          pIssues.push(`Warm "${m}" conflicts with cool metals in set`);
        } else if (!metal.warm && allWarmMetals.size > 0) {
          pScore -= 0.1;
          pIssues.push(`Cool "${m}" conflicts with warm metals in set`);
        }
      }

      // Material property distance from set average
      const props = lookupMaterial(lower);
      if (props && allMaterialProps.length > 1) {
        const avgWarmth = allMaterialProps.reduce((a, p2) => a + p2.warmth, 0) / allMaterialProps.length;
        const warmthDiff = Math.abs(props.warmth - avgWarmth);
        if (warmthDiff > 0.4) {
          pScore -= 0.1;
          pIssues.push(`"${m}" warmth (${props.warmth.toFixed(1)}) is far from set average (${avgWarmth.toFixed(1)})`);
        }
      }
    }

    perProduct.set(p.title, { score: Math.max(0.2, Math.min(1, pScore)), issues: pIssues });
  }

  // Global score
  let globalScore = 0.8;
  if (allWoodSpecies.size > 2) globalScore -= 0.15;
  if (allWarmMetals.size > 0 && allCoolMetals.size > 0) globalScore -= 0.15;

  return { score: Math.max(0.2, Math.min(1, globalScore)), issues, perProduct };
}

// --- Duplicate detection ---

function computeDuplicateScore(products: SetProduct[]): { score: number; issues: string[] } {
  const issues: string[] = [];
  const seen = new Map<string, SetProduct[]>();

  // Group by category + tier
  for (const p of products) {
    const key = `${p.category}|${p.tier}`;
    if (!seen.has(key)) seen.set(key, []);
    seen.get(key)!.push(p);
  }

  let duplicatePenalty = 0;

  for (const [key, group] of seen) {
    if (group.length <= 1) continue;

    // Check if products in same category+tier are too similar
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i], b = group[j];
        let similarity = 0;

        // Title similarity (Jaccard on words)
        const wordsA = new Set((a.title || "").toLowerCase().split(/\s+/));
        const wordsB = new Set((b.title || "").toLowerCase().split(/\s+/));
        const intersection = [...wordsA].filter(w => wordsB.has(w)).length;
        const union = new Set([...wordsA, ...wordsB]).size;
        if (union > 0) similarity += (intersection / union) * 0.4;

        // Material overlap
        const matsA = new Set((a.materials || []).map(m => m.toLowerCase()));
        const matsB = new Set((b.materials || []).map(m => m.toLowerCase()));
        const matIntersection = [...matsA].filter(m => matsB.has(m)).length;
        const matUnion = new Set([...matsA, ...matsB]).size;
        if (matUnion > 0) similarity += (matIntersection / matUnion) * 0.3;

        // Price proximity
        if (a.price && b.price) {
          const priceDiff = Math.abs(a.price - b.price) / Math.max(a.price, b.price);
          if (priceDiff < 0.1) similarity += 0.3;
          else if (priceDiff < 0.2) similarity += 0.15;
        }

        if (similarity > 0.7) {
          duplicatePenalty += 0.15;
          issues.push(`Near-duplicate: "${a.title}" and "${b.title}" in ${key} (similarity=${(similarity * 100).toFixed(0)}%)`);
        } else if (similarity > 0.5) {
          duplicatePenalty += 0.05;
          issues.push(`Similar products: "${a.title}" and "${b.title}" in ${key}`);
        }
      }
    }
  }

  return { score: Math.max(0.3, 1.0 - duplicatePenalty), issues };
}

// --- Tier differentiation ---

function computeTierDifferentiation(products: SetProduct[]): { score: number; issues: string[] } {
  const issues: string[] = [];

  // Group prices by tier
  const tierPrices: Record<string, number[]> = {};
  for (const p of products) {
    if (!p.price || !p.tier) continue;
    if (!tierPrices[p.tier]) tierPrices[p.tier] = [];
    tierPrices[p.tier].push(p.price);
  }

  const tiers = Object.keys(tierPrices).sort();
  if (tiers.length < 2) return { score: 0.7, issues: [] };

  // Check that tiers have meaningful price separation
  const tierMedians: Record<string, number> = {};
  for (const [tier, prices] of Object.entries(tierPrices)) {
    const sorted = [...prices].sort((a, b) => a - b);
    tierMedians[tier] = sorted[Math.floor(sorted.length / 2)];
  }

  let score = 1.0;
  const tierOrder = ["budget", "middle", "luxury", "best_possible"];
  const orderedTiers = tiers.sort((a, b) =>
    tierOrder.indexOf(a.toLowerCase()) - tierOrder.indexOf(b.toLowerCase())
  );

  for (let i = 0; i < orderedTiers.length - 1; i++) {
    const lowerTier = orderedTiers[i];
    const upperTier = orderedTiers[i + 1];
    const lowerMedian = tierMedians[lowerTier];
    const upperMedian = tierMedians[upperTier];

    if (lowerMedian && upperMedian) {
      const separation = (upperMedian - lowerMedian) / lowerMedian;
      if (separation < 0.2) {
        score -= 0.2;
        issues.push(`Weak price separation between ${lowerTier} ($${Math.round(lowerMedian)}) and ${upperTier} ($${Math.round(upperMedian)}) — only ${Math.round(separation * 100)}% difference`);
      } else if (separation < 0) {
        score -= 0.3;
        issues.push(`${upperTier} tier ($${Math.round(upperMedian)}) is CHEAPER than ${lowerTier} ($${Math.round(lowerMedian)}) — inverted pricing`);
      }
    }
  }

  return { score: Math.max(0.2, score), issues };
}

// --- Collective functional coverage ---

function computeCollectiveCoverage(products: SetProduct[]): { score: number; issues: string[] } {
  const issues: string[] = [];
  const categories = new Set(products.map(p => p.category.toLowerCase().replace(/[\s-]+/g, "_")));

  // Check for diversity of functional roles
  const functionalRoles = {
    seating: ["sofa", "accent_chair", "armchair", "dining_chair", "desk_chair", "rocking_chair"],
    surface: ["coffee_table", "dining_table", "side_table", "end_table", "desk", "console", "console_table"],
    storage: ["bookshelf", "bookcase", "dresser", "media_console", "credenza", "storage_cabinet", "sideboard"],
    lighting: ["floor_lamp", "table_lamp", "pendant_light", "sconce", "chandelier"],
    textile: ["area_rug", "rug", "curtains", "throw_pillows", "throw_blanket"],
    decorative: ["wall_art", "plant", "vase", "mirror", "candle", "tray", "sculpture"],
  };

  let rolesCovered = 0;
  const missingRoles: string[] = [];
  for (const [role, roleCats] of Object.entries(functionalRoles)) {
    const found = roleCats.some(rc => [...categories].some(c => c.includes(rc) || rc.includes(c)));
    if (found) rolesCovered++;
    else missingRoles.push(role);
  }

  const coverageRatio = rolesCovered / Object.keys(functionalRoles).length;
  if (missingRoles.length > 0 && missingRoles.length <= 3) {
    issues.push(`No products in functional roles: ${missingRoles.join(", ")}`);
  }

  return { score: Math.round(coverageRatio * 100) / 100, issues };
}

// --- Weights ---

const SET_MATH_WEIGHTS = {
  cross_product_coherence: 0.25,
  material_coherence: 0.22,
  duplicate_score: 0.15,
  tier_differentiation: 0.15,
  collective_coverage: 0.23,
};

// --- Main export ---

export function computeSetMathScores(
  products: SetProduct[],
  ctx: SetMathContext
): SetMathScores {
  const color = computeColorCoherence(products, ctx);
  const material = computeMaterialCoherence(products);
  const duplicate = computeDuplicateScore(products);
  const tier = computeTierDifferentiation(products);
  const coverage = computeCollectiveCoverage(products);

  const allIssues = [
    ...color.issues,
    ...material.issues,
    ...duplicate.issues,
    ...tier.issues,
    ...coverage.issues,
  ];

  // Per-product scores
  const perProduct = products.map(p => {
    const colorEntry = color.perProduct.get(p.title) || { score: 0.5, issues: [] };
    const matEntry = material.perProduct.get(p.title) || { score: 0.5, issues: [] };
    const combinedScore = colorEntry.score * 0.5 + matEntry.score * 0.5;
    return {
      title: p.title,
      category: p.category,
      math_harmony: Math.round(combinedScore * 100) / 100,
      issues: [...colorEntry.issues, ...matEntry.issues],
    };
  });

  const overall =
    SET_MATH_WEIGHTS.cross_product_coherence * color.score +
    SET_MATH_WEIGHTS.material_coherence * material.score +
    SET_MATH_WEIGHTS.duplicate_score * duplicate.score +
    SET_MATH_WEIGHTS.tier_differentiation * tier.score +
    SET_MATH_WEIGHTS.collective_coverage * coverage.score;

  return {
    cross_product_coherence: round2(color.score),
    material_coherence: round2(material.score),
    duplicate_score: round2(duplicate.score),
    tier_differentiation: round2(tier.score),
    collective_coverage: round2(coverage.score),
    overall: round2(overall),
    issues: allIssues,
    per_product: perProduct,
  };
}

/**
 * Format set math scores for injection into the AI product set validation prompt.
 */
export function formatSetMathForPrompt(scores: SetMathScores): string {
  const lines: string[] = [];
  lines.push("## MATHEMATICAL ANALYSIS (computed — these are FACTS, not opinions)");
  lines.push(`Overall set math score: ${scores.overall.toFixed(2)}/1.0`);
  lines.push("");
  lines.push(`### Cross-Set Analysis:`);
  lines.push(`- Color coherence: ${scores.cross_product_coherence.toFixed(2)}/1.0`);
  lines.push(`- Material coherence: ${scores.material_coherence.toFixed(2)}/1.0`);
  lines.push(`- Duplicate score: ${scores.duplicate_score.toFixed(2)}/1.0`);
  lines.push(`- Tier differentiation: ${scores.tier_differentiation.toFixed(2)}/1.0`);
  lines.push(`- Collective coverage: ${scores.collective_coverage.toFixed(2)}/1.0`);

  if (scores.issues.length > 0) {
    lines.push("");
    lines.push("### Issues found:");
    for (const issue of scores.issues) {
      lines.push(`- ${issue}`);
    }
  }

  if (scores.per_product.some(p => p.issues.length > 0)) {
    lines.push("");
    lines.push("### Per-product math harmony:");
    for (const p of scores.per_product) {
      const status = p.issues.length > 0 ? p.issues.join("; ") : "no issues";
      lines.push(`- ${p.category} "${p.title}": ${p.math_harmony.toFixed(2)} | ${status}`);
    }
  }

  lines.push("");
  lines.push("Use these facts when scoring each product's harmony. If the math finds color clashes, material conflicts, or duplicates, your per-product harmony_score should reflect it. A product with math violations should NOT score 8+.");

  return lines.join("\n");
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
