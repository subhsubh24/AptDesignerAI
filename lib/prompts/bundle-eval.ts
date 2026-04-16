import { truncateContext, type ContextSection } from "@/lib/ai/context-truncation";
import { formatExtractedFloorPlanForPrompt } from "@/lib/agents/format-floor-plan";
import type { DiagnosisData, DesignDirection, ExtractedFloorPlan } from "@/lib/types/database";

export interface BundleEvalContextArgs {
  roomType: string;
  priorities?: string[];
  diagnosis?: DiagnosisData;
  designDirection?: DesignDirection;
  spatialLayout?: string;
  placementMap?: Record<string, string>;
  floorPlan?: Record<string, unknown>;
  /** Structured floor plan extracted via vision model — preferred over legacy floorPlan */
  extractedFloorPlan?: ExtractedFloorPlan;
  lightingConditions?: string;
  windowDoorPositions?: string;
  outletPositions?: string;
  existingItems?: string[];
  userContext?: string;
  replaceItems?: string[];
  whatShouldGo?: string[];
  identifiedContext?: string;
}

/**
 * Shared context builder for bundle-eval prompt variants.
 * Extracted so scoring / pairwise / vibe passes all see identical grounding.
 */
function buildBundleContext(args: BundleEvalContextArgs): string {
  const {
    roomType, priorities, diagnosis, designDirection, spatialLayout, placementMap, floorPlan,
    extractedFloorPlan,
    lightingConditions, windowDoorPositions, outletPositions,
    existingItems, userContext, replaceItems, whatShouldGo, identifiedContext,
  } = args;

  const existingContext = diagnosis?.what_is_working?.length
    ? `What's already working in this room: ${diagnosis.what_is_working.join("; ")}`
    : "Refer to the room photos and building context in the system prompt for existing elements.";

  const problemsContext = diagnosis?.what_is_not_working?.length
    ? `Problems this bundle should solve: ${diagnosis.what_is_not_working.join("; ")}`
    : "";

  const spatialGapsContext = (diagnosis as DiagnosisData & { spatial_gaps?: string[] })?.spatial_gaps?.length
    ? `Dead zones & empty spaces to fill: ${(diagnosis as DiagnosisData & { spatial_gaps?: string[] }).spatial_gaps!.join("; ")}`
    : "";

  const directionContext = designDirection
    ? [
        designDirection.recommended_palette?.length && `Target palette: ${designDirection.recommended_palette.join(", ")}`,
        designDirection.recommended_materials?.length && `Target materials: ${designDirection.recommended_materials.join(", ")}`,
        designDirection.style_notes && `Style direction: ${designDirection.style_notes}`,
      ].filter(Boolean).join("\n")
    : "";

  const prioritiesContext = priorities?.length
    ? `Client priorities: ${priorities.join(", ")}`
    : "";

  const sections: ContextSection[] = [];

  sections.push({
    key: "room_context",
    priority: 2,
    content: `## ROOM CONTEXT\n- Room type: ${roomType}\n- Consider how ALL items work together as a set, not just individually\n- Use the building finishes, floor plan, and apartment context from the system prompt\n- Study the room photos to understand existing furniture and finishes${prioritiesContext ? `\n- ${prioritiesContext}` : ""}`,
  });

  sections.push({
    key: "existing_items",
    priority: 2,
    content: `## WHAT'S ALREADY IN THE ROOM\n${existingContext}${problemsContext ? `\n${problemsContext}` : ""}${spatialGapsContext ? `\n${spatialGapsContext}` : ""}`,
  });

  if (directionContext) {
    sections.push({ key: "design_direction", priority: 2, content: `## DESIGN DIRECTION\n${directionContext}` });
  }

  if (spatialLayout) {
    sections.push({ key: "spatial_layout", priority: 3, content: `## SPATIAL LAYOUT PLAN\n${spatialLayout}` });
  }

  if (extractedFloorPlan) {
    sections.push({
      key: "floor_plan",
      priority: 2,
      content: `## FLOOR PLAN (EXTRACTED — AUTHORITATIVE)\n${formatExtractedFloorPlanForPrompt(extractedFloorPlan, roomType)}`,
    });
  } else if (floorPlan) {
    sections.push({ key: "floor_plan", priority: 3, content: `## FLOOR PLAN DIMENSIONS\nTotal sqft: ${floorPlan.total_sqft || "unknown"}\nRoom dimensions: ${JSON.stringify(floorPlan.room_dimensions || {})}\nRoom layout: ${floorPlan.room_layout || "unknown"}` });
  }

  if (placementMap && Object.keys(placementMap).length > 0) {
    sections.push({ key: "placements", priority: 3, content: `## INTENDED PLACEMENTS\n${Object.entries(placementMap).map(([cat, placement]) => `- **${cat}**: ${placement}`).join("\n")}` });
  }

  if (lightingConditions) {
    sections.push({ key: "lighting", priority: 3, content: `## LIGHTING CONDITIONS\n${lightingConditions}` });
  }
  if (windowDoorPositions) {
    sections.push({ key: "windows_doors", priority: 3, content: `## WINDOW & DOOR POSITIONS\n${windowDoorPositions}` });
  }
  if (outletPositions) {
    sections.push({ key: "outlets", priority: 3, content: `## OUTLET POSITIONS\n${outletPositions}\nCheck that powered items (lamps, media consoles, smart devices) have realistic outlet access in their intended positions.` });
  }

  if (existingItems?.length) {
    sections.push({ key: "existing_items_list", priority: 2, content: `## EXISTING ITEMS TO COORDINATE WITH\n${existingItems.map((item) => `- ${item}`).join("\n")}\nThe bundle must harmonize with these pieces in style, scale, and materials.` });
  }

  if (identifiedContext) {
    sections.push({
      key: "identified_products",
      priority: 2,
      content: `${identifiedContext}\nIMPORTANT for bundle evaluation: Treat these as GROUND-TRUTH EXISTING FIXTURES in the room. The bundle must:\n- Harmonize with their materials, colors, and style\n- Respect their canonical dimensions for scale math (within ~20%)\n- NOT include a REPLACEMENT for any identified piece (same category) unless that piece is explicitly listed in replace_items\nPenalize pairwise compatibility, scale_balance, palette_harmony, and style_consistency when bundle items conflict with these verified pieces.`,
    });
  }

  if (replaceItems?.length) {
    sections.push({ key: "replace_items", priority: 3, content: `## ITEMS BEING REPLACED OR REMOVED\n${replaceItems.map((item) => `- ${item}`).join("\n")}\nThe bundle should include adequate replacements for these items. Verify the bundle addresses these removals.` });
  }
  if (whatShouldGo?.length) {
    sections.push({ key: "what_should_go", priority: 3, content: `## FROM DIAGNOSIS — ITEMS THAT SHOULD GO\n${whatShouldGo.map((item) => `- ${item}`).join("\n")}\nVerify this bundle doesn't repeat the same problems these items had.` });
  }

  if (userContext) {
    sections.push({ key: "user_notes", priority: 2, content: `## USER NOTES ABOUT THIS ROOM\n"${userContext}"\nIMPORTANT: Take these notes into account when evaluating the bundle.` });
  }

  const contextResult = truncateContext(sections, 5000, 0);
  return contextResult.text;
}

/**
 * Split-pass Call A: dimension scores + verdict + analysis.
 * The 7-dimension holistic scoring — no pairwise or vibe. Paired with
 * getBundlePairwisePrompt and getBundleVibePrompt.
 */
export function getBundleScoringPrompt(args: BundleEvalContextArgs): string {
  const assembledContext = buildBundleContext(args);
  return `Evaluate this bundle of products as a COMPLETE ROOM CONCEPT. This pass scores the bundle on 7 dimensions plus a summary verdict and analysis. Pairwise conflicts and room vibe are handled by separate passes — do NOT produce them here.

You are a world-class designer reviewing a proposed set for a real client's apartment. You know their building, finishes, room, and how they live.

${assembledContext}

## SCORE CALIBRATION — READ BEFORE SCORING
- **9-10 (Exceptional)**: Professional-grade curation. Every piece intentional. THIS IS RARE.
- **7-8 (Strong)**: Solid set with minor concerns.
- **5-6 (Mediocre)**: Safe but uninspired. THIS IS AVERAGE.
- **3-4 (Poor)**: Active conflicts. Wrong scale, clashing materials, or missing key pieces.
- **1-2 (Wrong)**: Incoherent set.

CRITICAL: Use the FULL 0-10 range.

## SCORING DIMENSIONS (each 0-10)

1. **palette_harmony_score**: Do the colors work together? List each product's primary colors, map to warm/cool/neutral, check against actual apartment finishes, verdict: cohesive or clash?
2. **material_balance_score**: Is there a healthy mix of 3-4+ distinct material types (wood, textile, metal, stone/ceramic, glass, leather)? Check durability/maintenance for the room's use (pets/kids/humidity) and climate suitability.
3. **scale_balance_score**: Pieces correctly proportioned vs. each other AND the room? Rug covers 60-80% of seating area; coffee table ⅔-full width of sofa; dining table seats the needed count.
4. **style_consistency_score**: Unified aesthetic. Use visual style tags. Conflicting tags = lower score.
5. **room_completion_score**: Does this make the room feel fully furnished? Tiered: missing essentials (sofa/bed/table/rug/primary light) → below 6. Only essentials, no standard → below 7. No finishing (art/plants/objects) → cap at 7. Dead-zone activation = bonus.
6. **spatial_arrangement_score**: Physical arrangement feasible. Traffic flow (36" main paths, 18" between coffee table and sofa), zone clarity, window/door clearance, outlet access for powered items.
7. **practicality_score**: Livable. Seating capacity for hosting, dining capacity, durability, lighting adequacy, acoustic balance (textiles in hard-surface rooms).

## COMPOUNDING SCORING
Your 7 dimensions are combined using a weighted geometric mean. ONE bad dimension tanks the overall score. Be PRECISE — inflating one score cannot compensate.

## OUTPUT FORMAT (JSON only, no prose, no markdown fences)
{
  "scores": {
    "palette_harmony_score": number,
    "material_balance_score": number,
    "scale_balance_score": number,
    "style_consistency_score": number,
    "room_completion_score": number,
    "spatial_arrangement_score": number,
    "practicality_score": number
  },
  "analysis": {
    "strongest_aspect": "what works best — be specific, name items",
    "weakest_aspect": "biggest weakness — name item and problem",
    "what_feels_missing": "specific categories/elements still needed",
    "what_should_be_swapped_first": "which item, replaced with what, and why"
  },
  "verdict": "2-3 sentence summary. Would a designer recommend this?"
}`;
}

/**
 * Split-pass Call B: pairwise conflicts between all products.
 * Focused O(n²) compatibility analysis.
 */
export function getBundlePairwisePrompt(args: BundleEvalContextArgs): string {
  const assembledContext = buildBundleContext(args);
  return `You are evaluating PAIRWISE COMPATIBILITY between products in a bundle. This pass has ONE job: identify which pairs of items don't work well together, and why. Do NOT score the bundle overall; that's a separate pass.

${assembledContext}

## YOUR TASK
For every PAIR of products in the bundle, silently assess compatibility (0-10). Then:

- Report ONLY pairs with compatibility < 9.0. Omit pairs that work well together.
- For each reported pair: compatibility (0-10), conflict_type, reason.
- conflict_type examples: "color_clash", "material_mismatch", "scale_conflict", "style_conflict", "spatial_crowding"
- Two individually great products can be terrible together (two different wood species; warm lamp + cool art; oversized sofa + oversized coffee table).

## CRITICAL
- Be specific. Name product titles or categories.
- If all pairs are compatible (all ≥ 9.0), return an empty array.
- Do NOT invent conflicts that aren't visible in product attributes/images.

## OUTPUT FORMAT (JSON only, no prose, no markdown fences)
{
  "pairwise_conflicts": [
    {
      "product_a": "category_or_title_of_first_item",
      "product_b": "category_or_title_of_second_item",
      "compatibility": number_0_to_10,
      "conflict_type": "type_of_clash",
      "reason": "specific explanation"
    }
  ]
}`;
}

/**
 * Split-pass Call C: room vibe narrative.
 * Purely descriptive — paints what the room FEELS like. Consumes Call A's
 * verdict so the narrative aligns with the scored assessment.
 */
export function getBundleVibePrompt(args: BundleEvalContextArgs, scoringVerdict?: string): string {
  const assembledContext = buildBundleContext(args);
  return `You are writing the "vibe" narrative for a proposed bundle of products. This pass is purely descriptive — imagine walking into the finished room and describe what it feels like. Do NOT score dimensions or identify conflicts; those are separate passes.

${scoringVerdict ? `## SCORING VERDICT (from earlier pass — match the tone of your vibe to this)\n${scoringVerdict}\n` : ""}
${assembledContext}

## YOUR TASK
Write a designer's pitch of the room's atmosphere. Reference specific products that drive the vibe. Be evocative, not generic.

## OUTPUT FORMAT (JSON only, no prose, no markdown fences)
{
  "room_vibe": {
    "vibe_summary": "2-3 sentences describing the mood and feeling of walking into this room. Reference specific products that create the vibe.",
    "style_keywords": ["3-5 style keywords — e.g., 'warm minimalist', 'lived-in modern', 'earthy calm'"],
    "color_story": "1-2 sentences on the color narrative — dominant tone, accents, light interaction",
    "mood": "one word or short phrase capturing the emotional quality — e.g., 'cozy refuge', 'calm sophistication'"
  }
}`;
}
