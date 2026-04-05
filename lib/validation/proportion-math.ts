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

// --- Visual weight estimation ---

interface VisualWeight {
  category: string;
  weight: number; // 0-1
  zone: string;
}

function estimateVisualWeight(
  category: string,
  specs?: string,
): number {
  // Base weight by category type
  const heavyItems = new Set([
    "sofa", "sectional", "bed", "bookcase", "armoire", "dresser",
    "entertainment_center", "china_cabinet", "wardrobe",
  ]);
  const mediumItems = new Set([
    "chair", "armchair", "accent_chair", "desk", "dining_table",
    "coffee_table", "console", "credenza", "sideboard",
  ]);
  const lightItems = new Set([
    "side_table", "end_table", "nightstand", "floor_lamp",
    "table_lamp", "throw_pillow", "throw_blanket", "plant",
    "wall_art", "mirror", "vase", "candle",
  ]);

  const catLower = category.toLowerCase().replace(/[\s-]+/g, "_");
  let baseWeight = 0.5;
  if (heavyItems.has(catLower)) baseWeight = 0.85;
  else if (mediumItems.has(catLower)) baseWeight = 0.55;
  else if (lightItems.has(catLower)) baseWeight = 0.25;

  // Adjust by size if available
  if (specs) {
    const dims = parseDimensions(specs);
    if (dims) {
      const footprint = dims.width * dims.depth;
      if (footprint > 5000) baseWeight = Math.min(1, baseWeight + 0.15);
      else if (footprint < 500) baseWeight = Math.max(0.1, baseWeight - 0.1);
    }
  }

  return baseWeight;
}

function classifyZoneSide(placement: string): "left" | "right" | "center" | "unknown" {
  const lower = placement.toLowerCase();
  if (lower.includes("left") || lower.includes("west wall")) return "left";
  if (lower.includes("right") || lower.includes("east wall")) return "right";
  if (lower.includes("center") || lower.includes("middle") || lower.includes("between")) return "center";
  return "unknown";
}

// --- Grouping ratio check (odd numbers preferred for decorative items) ---

const DECORATIVE_CATEGORIES = new Set([
  "throw_pillow", "throw_pillows", "decorative_pillow",
  "vase", "candle", "decorative_object", "sculpture",
  "plant", "planter",
]);

function checkGroupingRatio(
  whatItNeeds: Array<{ category: string; specs?: string }>
): Array<{ item: string; issue: string; suggestion: string }> {
  const issues: Array<{ item: string; issue: string; suggestion: string }> = [];

  // Count decorative items by category
  const catCounts = new Map<string, number>();
  for (const item of whatItNeeds) {
    const catLower = item.category.toLowerCase().replace(/[\s-]+/g, "_");
    if (DECORATIVE_CATEGORIES.has(catLower)) {
      catCounts.set(catLower, (catCounts.get(catLower) || 0) + 1);
    }
  }

  for (const [cat, count] of catCounts) {
    if (count > 1 && count % 2 === 0 && count !== 2) {
      issues.push({
        item: cat,
        issue: `${count} ${cat} items — even number`,
        suggestion: `Use ${count - 1} or ${count + 1} for odd-number grouping (more visually dynamic)`,
      });
    }
  }

  return issues;
}

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

  // 3. Visual balance (left/right weight distribution)
  const sideWeights: Record<string, number> = { left: 0, right: 0, center: 0 };
  let assignedItems = 0;

  for (const item of whatItNeeds) {
    if (item.placement) {
      const side = classifyZoneSide(item.placement);
      if (side !== "unknown") {
        sideWeights[side] += estimateVisualWeight(item.category, item.specs);
        assignedItems++;
      }
    }
  }

  let visualBalance = 0.8; // Default
  if (assignedItems >= 3) {
    const leftRight = sideWeights.left + sideWeights.right;
    if (leftRight > 0) {
      const leftRatio = sideWeights.left / leftRight;
      // Ideal: 0.35-0.65 (not perfectly symmetric, but balanced)
      if (leftRatio >= 0.35 && leftRatio <= 0.65) {
        visualBalance = 1.0;
      } else {
        const imbalance = Math.max(
          Math.abs(leftRatio - 0.35),
          Math.abs(leftRatio - 0.65)
        );
        visualBalance = Math.max(0.4, 1.0 - imbalance * 2);
        const heavySide = leftRatio > 0.65 ? "left" : "right";
        issues.push({
          item: "room_layout",
          issue: `Visual weight skews ${heavySide} (${Math.round(leftRatio * 100)}% / ${Math.round((1 - leftRatio) * 100)}%)`,
          suggestion: `Move a heavier piece to the ${heavySide === "left" ? "right" : "left"} or add visual weight with art/plant`,
        });
      }
    }
  }

  // 4. Grouping ratios
  const groupIssues = checkGroupingRatio(whatItNeeds);
  issues.push(...groupIssues);

  return {
    rug_coverage: Math.round(rugCoverage * 100) / 100,
    height_relationships: Math.round(heightScore * 100) / 100,
    visual_balance: Math.round(visualBalance * 100) / 100,
    issues,
  };
}
