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
 * Paired with getBundleVibePrompt for the narrative pass.
 */
export function getBundleScoringPrompt(args: BundleEvalContextArgs): string {
  const assembledContext = buildBundleContext(args);
  return `<role>
You are a world-class interior designer evaluating a proposed set of products as a complete room concept for a real client. You know their building, finishes, room, and how they live. You have reviewed thousands of rooms and you use the FULL scoring range — most rooms you see are average (5-6), genuinely good ones are 7-8, exceptional sets are rare (9-10).
</role>

<task>
Evaluate the bundle below on 7 dimensions plus a verdict. This pass only scores dimensions and writes a verdict. Pairwise conflicts and room vibe are handled by separate passes — do NOT produce them here.
</task>

${assembledContext}

<scoring_calibration>
Read ALL examples before scoring. Use these as anchors.

**9-10 (Exceptional — RARE)**: Professional-grade curation. Every piece intentional, nothing redundant. Style thread runs through every item. Would appear in an editorial shoot.
**7-8 (Strong)**: Solid, cohesive set. Minor concerns that a swap would fix. A skilled designer would recommend it.
**5-6 (Mediocre — THIS IS AVERAGE)**: Safe but uninspired. Items don't actively fight but don't reinforce each other either. A showroom floor.
**3-4 (Poor)**: Active conflicts. Wrong scale, clashing materials, or essential categories missing.
**1-2 (Wrong)**: Incoherent. Random items assembled with no design logic.

CONCRETE ANCHORS — use these to calibrate, not to copy:

palette_harmony_score:
- 8: Warm walnut table + cream linen sofa + brushed brass lamp in a room with oak floors — materials share the same warm undertone and reinforce each other.
- 5: Off-white sofa + chrome side table + warm oak coffee table — inconsistent undertones; neither fully warm nor fully cool. Items coexist but don't sing together.
- 3: Navy velvet chair + rust throw pillows + teal rug in a room with beige walls — accent colors compete rather than harmonize; no clear palette anchor.

scale_balance_score:
- 8: 8×10 rug anchors the seating group with 18" extending beyond the sofa; 48" coffee table ≈ ⅔ the 72" sofa — textbook proportions.
- 5: 5×7 rug only covers under the coffee table, leaving sofa legs off the rug — too small but the room is still somewhat functional.
- 3: 36" coffee table for a 108" sectional — visually lost; the disconnect reads as a mistake, not a design choice.

room_completion_score:
- 7: Sofa + coffee table + side table + rug + floor lamp — all essentials present; no finishing layer (plants, art, objects) but the room is livable.
- 5: Sofa and rug only — missing coffee table (nowhere to set a drink), no dedicated lighting beyond overhead.
- 3: Only a sofa — the room is not furnished, it just has a seat.

style_consistency_score:
- 8: Every item shares 2-3 consistent style tags (e.g., "organic", "textured", "warm-toned") — the room has a clear point of view.
- 5: Mix of two compatible but distinct sub-styles (e.g., mid-century modern sofa + Scandi side table) — coherent but unfocused.
- 3: Industrial metal shelving + ornate traditional mirror + minimalist white sofa — three unrelated aesthetic vocabularies.

CRITICAL: Use the FULL 0-10 range. ONE low-scoring dimension tanks the bundle — be precise, not generous.
</scoring_calibration>

<scoring_dimensions>
Score each 0-10 using the calibration above as your reference:

1. **palette_harmony_score**: Do the colors work together? Map each product's primary color to warm/cool/neutral. Check against actual apartment finishes. Verdict: cohesive or clash?

2. **material_balance_score**: Is there a healthy mix of 3-4+ distinct material types (wood, textile, metal, stone/ceramic, glass, leather)? Check durability/maintenance for the room's use (pets/kids/humidity). Consider climate suitability — velvet in humid climates degrades, untreated wood outdoors fails. Does it work with the building's existing finishes?

3. **scale_balance_score**: Pieces correctly proportioned vs each other AND the room? Rug covers the seating area (≥60%); coffee table ≈ ⅔ the sofa width; dining table seats the needed count and leaves 24" chair pullback. Use floor plan dimensions if available.

4. **style_consistency_score**: Unified aesthetic. Identify the style tags each item carries — conflicting tags lower this score. Two items can be individually beautiful and wrong together.

5. **room_completion_score**: Does this make the room feel fully furnished?
   - Missing essentials (sofa/bed/table/rug/primary light) → cap at 5
   - Essentials only, nothing standard → cap at 7
   - No finishing layer (art/plants/objects) → cap at 7
   - Activates a diagnosed dead zone → +0.5 bonus

6. **spatial_arrangement_score**: Physical arrangement feasible. Traffic flow (36" main paths, 18" coffee table to sofa), zone clarity, window/door clearance, outlet access for powered items. Penalize if the bundle would create obvious bottlenecks.

7. **practicality_score**: Livable for how THIS client lives. Seating capacity for hosting needs, dining capacity, durability for pets/kids/use-pattern, lighting adequacy, acoustic balance (textiles needed in hard-surface rooms).
</scoring_dimensions>

<output_contract>
JSON only. No prose, no markdown fences. Think hard before scoring — your numbers never appear without being grounded in specific evidence from the product data and room context above.

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
  "verdict": "2-3 sentence summary. Would a designer recommend this set?"
}
</output_contract>`;
}

/**
 * Split-pass Call B: room vibe narrative.
 * Purely descriptive — paints what the room FEELS like. Consumes Call A's
 * verdict so the narrative aligns with the scored assessment.
 */
export function getBundleVibePrompt(args: BundleEvalContextArgs, scoringVerdict?: string): string {
  const assembledContext = buildBundleContext(args);
  return `<role>
You are writing the "vibe" narrative for a proposed room bundle. This pass is purely descriptive — imagine walking into the finished room and describe what it feels and looks like. You do NOT score dimensions or identify conflicts; those are separate passes.
</role>

<task>
Write a designer's pitch of the room's atmosphere. Reference specific products that drive the vibe. Be evocative and concrete — not generic. A good vibe narrative makes the client see, feel, and want to live in the room.
</task>

${scoringVerdict ? `<scoring_context>\n${scoringVerdict}\nAlign the tone of your narrative to this verdict — a mediocre-scoring bundle gets honest, grounded language; a strong bundle gets energetic, aspirational language.\n</scoring_context>\n` : ""}
${assembledContext}

<constraints>
- Reference specific products by name or category — not vague gestures at "the furniture"
- Style keywords must be specific (e.g., "warm minimalist", "lived-in modern") not generic ("cozy", "nice")
- Color story must name the dominant tone and explain how light interacts with it
- Mood must be a single evocative phrase, not a description of the furniture
</constraints>

<output_contract>
JSON only. No prose, no markdown fences.

{
  "room_vibe": {
    "vibe_summary": "2-3 sentences describing the mood and feeling of walking into this room. Reference specific products that create the vibe.",
    "style_keywords": ["3-5 specific style keywords — e.g., 'warm minimalist', 'lived-in modern', 'earthy calm'"],
    "color_story": "1-2 sentences on the color narrative — dominant tone, accents, how light interacts",
    "mood": "one evocative phrase — e.g., 'cozy refuge', 'calm sophistication', 'grounded warmth'"
  }
}
</output_contract>`;
}
