// Mathematical harmony validation orchestrator
// Combines color, spatial, material, and proportion scoring into a unified result

import { computeColorHarmony, type ColorHarmonyResult } from "./color-math";
import { computeSpatialConstraints, type SpatialConstraintResult } from "./spatial-math";
import { computeMaterialBalance, type MaterialBalanceResult } from "./material-math";
import { computeProportionScores, type ProportionResult } from "./proportion-math";

export interface MathHarmonyItemScore {
  category: string;
  math_score: number; // 0-1
  violations: string[];
}

export interface MathHarmonyResult {
  overall: number; // 0-1
  color: ColorHarmonyResult;
  spatial: SpatialConstraintResult;
  material: MaterialBalanceResult;
  proportion: ProportionResult;
  itemScores: MathHarmonyItemScore[];
}

// Weights: spatial heaviest (hard physical constraints)
const WEIGHTS = {
  spatial: 0.30,
  color: 0.20,
  material: 0.20,
  proportion: 0.15,
  specificity: 0.15,
};

function computeSpecificityScore(
  item: { category: string; specs?: string; placement?: string }
): number {
  let score = 0.5;

  if (item.specs) {
    const specLen = item.specs.length;
    // Longer, more detailed specs = higher specificity
    if (specLen > 100) score += 0.3;
    else if (specLen > 50) score += 0.2;
    else if (specLen > 20) score += 0.1;

    // Bonus for having actual dimensions
    if (/\d+\s*["'x×-]\s*\d+/.test(item.specs)) score += 0.1;
    // Bonus for mentioning specific materials
    if (/\b(walnut|oak|brass|marble|linen|velvet|leather)\b/i.test(item.specs)) score += 0.05;
  }

  if (item.placement && item.placement.length > 10) {
    score += 0.1;
  }

  return Math.min(1, score);
}

export function computeHarmonyScores(
  analysis: Record<string, unknown>,
  context: {
    roomType?: string;
    floorPlan?: Record<string, unknown>;
    otherRooms?: Array<{ palette?: string[]; materials?: string[] }>;
  }
): MathHarmonyResult {
  const color = computeColorHarmony(analysis, context);
  const spatial = computeSpatialConstraints(analysis, context);
  const material = computeMaterialBalance(analysis, context);
  const proportion = computeProportionScores(analysis, context);

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

    const specificity = computeSpecificityScore(item);

    // Weighted average of all dimensions
    const mathScore =
      WEIGHTS.color * ((color.palette_harmony + color.cross_room_coherence) / 2) +
      WEIGHTS.spatial * ((spatial.room_coverage_ratio + spatial.clearance_score) / 2) +
      WEIGHTS.material *
        ((material.material_balance + material.wood_coherence + material.metal_coherence + material.soft_hard_ratio) / 4) +
      WEIGHTS.proportion *
        ((proportion.rug_coverage + proportion.height_relationships + proportion.visual_balance) / 3) +
      WEIGHTS.specificity * specificity;

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
    itemScores,
  };
}

/**
 * Format math scores as a text block for injection into the AI validation prompt.
 */
export function formatMathScoresForPrompt(result: MathHarmonyResult): string {
  const lines: string[] = [];

  lines.push("## MATHEMATICAL ANALYSIS (computed — these are FACTS, not opinions)");
  lines.push(`Overall math score: ${result.overall.toFixed(2)}/1.0`);
  lines.push("");

  // Color
  lines.push(`### Color Harmony: ${result.color.palette_harmony.toFixed(2)}/1.0`);
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

  // Material
  const matAvg = (result.material.material_balance + result.material.wood_coherence + result.material.metal_coherence + result.material.soft_hard_ratio) / 4;
  lines.push(`### Material Balance: ${matAvg.toFixed(2)}/1.0`);
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

  // Per-item scores
  lines.push("### Per-item math scores:");
  for (const item of result.itemScores) {
    const status = item.violations.length === 0 ? "no violations" : item.violations.join("; ");
    lines.push(`- ${item.category}: ${item.math_score.toFixed(2)} | ${status}`);
  }
  lines.push("");
  lines.push("You CANNOT score an item 10/10 if it has math violations. Fix violations in revised_specs/placement. Focus your scoring on SUBJECTIVE aspects math can't capture (aesthetic feel, style coherence, visual appeal).");

  return lines.join("\n");
}
