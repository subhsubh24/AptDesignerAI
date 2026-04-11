// Scale & proportion scoring: rug coverage, height relationships, visual balance, grouping ratios

import { parseDimensions } from "./spatial-math";

export interface ProportionResult {
  rug_coverage: number; // 0-1
  height_relationships: number; // 0-1
  visual_balance: number; // 0-1
  issues: Array<{
    item: string;
    issue: string;
    suggestion: string;
  }>;
}

// --- Height relationship rules (inches) ---

interface HeightRule {
  target: number; // target height in inches
  tolerance: number; // acceptable deviation
  context: string;
}

const HEIGHT_RELATIONSHIPS: Record<string, HeightRule[]> = {
  coffee_table: [
    { target: 18, tolerance: 2, context: "should be ±2\" of sofa seat height (~17-19\")" },
  ],
  side_table: [
    { target: 26, tolerance: 2, context: "should be within 2\" of sofa arm height (~24-28\")" },
  ],
  end_table: [
    { target: 26, tolerance: 2, context: "should be within 2\" of sofa arm height (~24-28\")" },
  ],
  dining_table: [
    { target: 30, tolerance: 2, context: "standard dining height (28-32\")" },
  ],
  desk: [
    { target: 30, tolerance: 2, context: "standard desk height (28-32\")" },
  ],
  nightstand: [
    { target: 26, tolerance: 3, context: "should be near mattress top height (~24-28\")" },
  ],
  console: [
    { target: 30, tolerance: 4, context: "standard console height (26-34\")" },
  ],
};

function getHeightRules(category: string): HeightRule[] {
  const key = category.toLowerCase().replace(/[\s-]+/g, "_");
  if (HEIGHT_RELATIONSHIPS[key]) return HEIGHT_RELATIONSHIPS[key];
  for (const [ruleKey, rules] of Object.entries(HEIGHT_RELATIONSHIPS)) {
    if (key.includes(ruleKey)) return rules;
  }
  return [];
}

// --- Rug sizing rules ---

interface RugRule {
  category: string;
  minExtension: number; // min inches rug should extend beyond furniture
}

const RUG_EXTENSIONS: Record<string, RugRule[]> = {
  living_room: [
    { category: "sofa", minExtension: 6 },
    { category: "chair", minExtension: 6 },
    { category: "coffee_table", minExtension: 12 },
  ],
  dining_room: [
    { category: "dining_table", minExtension: 24 }, // Chair pullback
  ],
  bedroom: [
    { category: "bed", minExtension: 18 }, // Beyond bed sides
  ],
};

// Visual weight estimation, left/right balance, and odd-number grouping heuristics
// removed — these are crude rules the AI handles better with its design judgment.
// Height relationships and rug coverage (above) provide real ergonomic/functional value.

// --- Main computation ---

export function computeProportionScores(
  analysis: Record<string, unknown>,
  context: {
    roomType?: string;
    floorPlan?: Record<string, unknown>;
  }
): ProportionResult {
  const whatItNeeds =
    (analysis.what_it_needs as Array<{
      category: string;
      specs?: string;
      placement?: string;
    }>) || [];

  const issues: ProportionResult["issues"] = [];

  // 1. Rug coverage
  let rugCoverage = 0.8; // Default if no rug
  const rugs = whatItNeeds.filter((i) =>
    i.category.toLowerCase().includes("rug")
  );
  if (rugs.length > 0) {
    const rug = rugs[0];
    const rugDims = rug.specs ? parseDimensions(rug.specs) : null;
    if (rugDims) {
      // Check if rug is appropriately sized for room type
      const roomKey = (context.roomType || "living_room")
        .toLowerCase()
        .replace(/[\s-]+/g, "_");
      const extensions = RUG_EXTENSIONS[roomKey] || RUG_EXTENSIONS["living_room"];

      let extensionScore = 1.0;
      for (const ext of extensions || []) {
        const relatedItem = whatItNeeds.find((i) =>
          i.category.toLowerCase().includes(ext.category)
        );
        if (relatedItem?.specs) {
          const itemDims = parseDimensions(relatedItem.specs);
          if (itemDims) {
            const widthExtension = (rugDims.width - itemDims.width) / 2;
            const depthExtension = (rugDims.depth - itemDims.depth) / 2;
            const minExtension = Math.min(widthExtension, depthExtension);
            if (minExtension < ext.minExtension) {
              extensionScore -= 0.2;
              issues.push({
                item: rug.category,
                issue: `Rug extends only ${Math.round(minExtension)}" beyond ${ext.category} (need ${ext.minExtension}")`,
                suggestion: `Rug should extend at least ${ext.minExtension}" beyond ${ext.category} on all sides`,
              });
            }
          }
        }
      }
      rugCoverage = Math.max(0.3, extensionScore);
    }
  }

  // 2. Height relationships
  let heightScore = 1.0;
  let heightChecks = 0;
  for (const item of whatItNeeds) {
    const rules = getHeightRules(item.category);
    if (rules.length === 0) continue;
    const dims = item.specs ? parseDimensions(item.specs) : null;
    const height = dims?.height;
    if (!height) continue;

    for (const rule of rules) {
      heightChecks++;
      const deviation = Math.abs(height - rule.target);
      if (deviation > rule.tolerance) {
        const penalty = Math.min(0.2, (deviation - rule.tolerance) / 10);
        heightScore -= penalty;
        issues.push({
          item: item.category,
          issue: `Height ${Math.round(height)}" — ${rule.context}`,
          suggestion: `Adjust to ~${rule.target}" (±${rule.tolerance}")`,
        });
      }
    }
  }
  if (heightChecks === 0) heightScore = 0.8; // Can't verify
  heightScore = Math.max(0.3, heightScore);

  // Visual balance: neutral constant — the AI evaluates layout balance
  // using its visual understanding of the room photos rather than crude
  // left/right weight heuristics.
  const visualBalance = 0.8;

  return {
    rug_coverage: Math.round(rugCoverage * 100) / 100,
    height_relationships: Math.round(heightScore * 100) / 100,
    visual_balance: visualBalance,
    issues,
  };
}
