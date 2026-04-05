// Material cluster scoring: distribution balance, wood/metal conflicts, soft-hard ratio

import {
  lookupMaterial,
  identifyWoodSpecies,
  identifyMetalFinish,
  type MaterialProperties,
} from "./lookups";

export interface MaterialBalanceResult {
  material_balance: number; // 0-1: distribution across property axes
  wood_coherence: number; // 0-1: 1.0 if ≤2 wood species
  metal_coherence: number; // 0-1: 1.0 if ≤2 metal finishes
  soft_hard_ratio: number; // 0-1: how close to ideal balance
  conflicts: Array<{
    material1: string;
    material2: string;
    issue: string;
  }>;
}

// Room type → ideal soft-to-hard ratio (soft items / total items)
const IDEAL_SOFT_RATIO: Record<string, [number, number]> = {
  living_room: [0.40, 0.60],
  bedroom: [0.50, 0.70],
  dining_room: [0.20, 0.40],
  home_office: [0.25, 0.45],
  kitchen: [0.10, 0.30],
  bathroom: [0.15, 0.35],
  entryway: [0.25, 0.45],
  nursery: [0.50, 0.70],
};

const SOFT_MATERIALS = new Set([
  "linen", "cotton", "velvet", "silk", "wool", "cashmere",
  "jute", "sisal", "boucle", "chenille", "tweed",
  "performance fabric", "leather", "full grain leather", "faux leather",
]);

const SOFT_CATEGORIES = new Set([
  "rug", "area_rug", "curtains", "drapes", "throw_pillow", "throw_pillows",
  "throw_blanket", "throw", "cushion", "cushions", "bedding", "duvet",
  "upholstered_chair", "upholstered_bench",
]);

function isSoftItem(category: string, materials: string[]): boolean {
  const catLower = category.toLowerCase().replace(/[\s-]+/g, "_");
  if (SOFT_CATEGORIES.has(catLower)) return true;
  return materials.some((m) => SOFT_MATERIALS.has(m.toLowerCase().trim()));
}

// --- Material distribution variance ---

function computeDistributionBalance(props: MaterialProperties[]): number {
  if (props.length < 2) return 0.8; // Too few to judge

  // Compute variance along each axis
  const axes: (keyof MaterialProperties)[] = ["warmth", "roughness", "sheen", "weight"];
  let totalVariance = 0;

  for (const axis of axes) {
    const values = props.map((p) => p[axis]);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length;
    totalVariance += variance;
  }

  const avgVariance = totalVariance / axes.length;

  // Ideal variance: 0.03-0.10 (some variety but not chaotic)
  // Too low (<0.02) = monotonous, too high (>0.15) = chaotic
  if (avgVariance >= 0.03 && avgVariance <= 0.10) return 1.0;
  if (avgVariance < 0.03) return 0.7 + 0.3 * (avgVariance / 0.03);
  if (avgVariance <= 0.15) return 1.0 - 0.4 * ((avgVariance - 0.10) / 0.05);
  return 0.5;
}

// --- Main computation ---

export function computeMaterialBalance(
  analysis: Record<string, unknown>,
  context: {
    roomType?: string;
  }
): MaterialBalanceResult {
  const recommendedMaterials =
    (analysis.recommended_materials as string[]) || [];
  const whatItNeeds =
    (analysis.what_it_needs as Array<{
      category: string;
      specs?: string;
    }>) || [];
  const whatWorks = (analysis.what_works as string[]) || [];

  // Collect all material mentions
  const allMaterialNames: string[] = [...recommendedMaterials];
  for (const item of whatItNeeds) {
    if (item.specs) {
      // Extract material mentions from specs
      const specLower = item.specs.toLowerCase();
      // Try matching known materials
      const words = specLower.split(/[,;/\s]+/);
      for (let i = 0; i < words.length; i++) {
        // Try two-word combos
        if (i < words.length - 1) {
          const twoWord = `${words[i]} ${words[i + 1]}`;
          if (lookupMaterial(twoWord)) {
            allMaterialNames.push(twoWord);
            continue;
          }
        }
        if (lookupMaterial(words[i])) {
          allMaterialNames.push(words[i]);
        }
      }
    }
  }

  // Also extract from what_works strings
  for (const item of whatWorks) {
    const lower = item.toLowerCase();
    const words = lower.split(/[,;/\s]+/);
    for (const word of words) {
      if (lookupMaterial(word)) allMaterialNames.push(word);
    }
  }

  const uniqueMaterials = [...new Set(allMaterialNames.map((m) => m.toLowerCase().trim()))];

  // 1. Resolve material properties
  const resolved: Array<{ name: string; props: MaterialProperties }> = [];
  for (const mat of uniqueMaterials) {
    const props = lookupMaterial(mat);
    if (props) resolved.push({ name: mat, props });
  }

  // Distribution balance
  const materialBalance =
    resolved.length >= 2
      ? computeDistributionBalance(resolved.map((r) => r.props))
      : 0.7;

  // 2. Wood species conflicts
  const woodSpecies = new Set<string>();
  for (const mat of uniqueMaterials) {
    const species = identifyWoodSpecies(mat);
    if (species) woodSpecies.add(species);
  }
  // Also check specs
  for (const item of whatItNeeds) {
    if (item.specs) {
      const species = identifyWoodSpecies(item.specs);
      if (species) woodSpecies.add(species);
    }
  }

  const woodCoherence =
    woodSpecies.size <= 2 ? 1.0 : Math.max(0.4, 1.0 - (woodSpecies.size - 2) * 0.2);

  // 3. Metal finish conflicts
  const metalFinishes: Array<{ name: string; warm: boolean }> = [];
  for (const mat of uniqueMaterials) {
    const metal = identifyMetalFinish(mat);
    if (metal) metalFinishes.push(metal);
  }
  for (const item of whatItNeeds) {
    if (item.specs) {
      const metal = identifyMetalFinish(item.specs);
      if (metal) metalFinishes.push(metal);
    }
  }

  const uniqueMetals = [
    ...new Map(metalFinishes.map((m) => [m.name, m])).values(),
  ];
  const warmMetals = uniqueMetals.filter((m) => m.warm);
  const coolMetals = uniqueMetals.filter((m) => !m.warm);

  let metalCoherence = 1.0;
  if (warmMetals.length > 0 && coolMetals.length > 0) {
    // Mixing warm and cool metals
    metalCoherence = 0.6;
  }
  if (uniqueMetals.length > 3) {
    metalCoherence = Math.min(metalCoherence, 0.5);
  }

  // 4. Soft-to-hard ratio
  let softCount = 0;
  let hardCount = 0;
  for (const item of whatItNeeds) {
    const itemMaterials = uniqueMaterials.filter((m) =>
      item.specs?.toLowerCase().includes(m)
    );
    if (isSoftItem(item.category, itemMaterials)) {
      softCount++;
    } else {
      hardCount++;
    }
  }

  const total = softCount + hardCount;
  let softHardRatio = 0.7; // default
  if (total > 0) {
    const ratio = softCount / total;
    const roomKey = (context.roomType || "living_room")
      .toLowerCase()
      .replace(/[\s-]+/g, "_");
    const [idealMin, idealMax] = IDEAL_SOFT_RATIO[roomKey] || [0.35, 0.55];

    if (ratio >= idealMin && ratio <= idealMax) {
      softHardRatio = 1.0;
    } else if (ratio < idealMin) {
      softHardRatio = Math.max(0.5, ratio / idealMin);
    } else {
      softHardRatio = Math.max(0.5, 1 - (ratio - idealMax) / (1 - idealMax));
    }
  }

  // 5. Collect conflicts
  const conflicts: MaterialBalanceResult["conflicts"] = [];

  if (woodSpecies.size > 2) {
    const speciesList = [...woodSpecies];
    conflicts.push({
      material1: speciesList[0],
      material2: speciesList[2],
      issue: `${woodSpecies.size} wood species (${speciesList.join(", ")}) — max 2 recommended`,
    });
  }

  if (warmMetals.length > 0 && coolMetals.length > 0) {
    conflicts.push({
      material1: warmMetals[0].name,
      material2: coolMetals[0].name,
      issue: `Mixing warm (${warmMetals.map((m) => m.name).join(", ")}) and cool (${coolMetals.map((m) => m.name).join(", ")}) metals`,
    });
  }

  return {
    material_balance: Math.round(materialBalance * 100) / 100,
    wood_coherence: Math.round(woodCoherence * 100) / 100,
    metal_coherence: Math.round(metalCoherence * 100) / 100,
    soft_hard_ratio: Math.round(softHardRatio * 100) / 100,
    conflicts,
  };
}
