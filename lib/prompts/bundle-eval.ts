import type { DiagnosisData, DesignDirection } from "@/lib/types/database";

export function getBundleEvalPrompt(
  roomType: string,
  priorities?: string[],
  diagnosis?: DiagnosisData,
  designDirection?: DesignDirection,
  spatialLayout?: string,
  placementMap?: Record<string, string>,
  floorPlan?: Record<string, unknown>,
  lightingConditions?: string,
  windowDoorPositions?: string,
  outletPositions?: string,
  existingItems?: string[]
): string {
  // Build dynamic context from diagnosis
  const existingContext = diagnosis?.what_is_working?.length
    ? `What's already working in this room: ${diagnosis.what_is_working.join("; ")}`
    : "Refer to the room photos and building context in the system prompt for existing elements.";

  const problemsContext = diagnosis?.what_is_not_working?.length
    ? `Problems this bundle should solve: ${diagnosis.what_is_not_working.join("; ")}`
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

  // Build spatial context
  const spatialCtx = spatialLayout
    ? `\n\n## SPATIAL LAYOUT PLAN\n${spatialLayout}`
    : "";

  const floorPlanCtx = floorPlan
    ? `\n\n## FLOOR PLAN DIMENSIONS\nTotal sqft: ${floorPlan.total_sqft || "unknown"}\nRoom dimensions: ${JSON.stringify(floorPlan.room_dimensions || {})}\nRoom layout: ${floorPlan.room_layout || "unknown"}`
    : "";

  const placementCtx = placementMap && Object.keys(placementMap).length > 0
    ? `\n\n## INTENDED PLACEMENTS\n${Object.entries(placementMap).map(([cat, p]) => `- **${cat}**: ${p}`).join("\n")}`
    : "";

  const lightingCtx = lightingConditions
    ? `\n\n## LIGHTING CONDITIONS\n${lightingConditions}`
    : "";

  const windowDoorCtx = windowDoorPositions
    ? `\n\n## WINDOW & DOOR POSITIONS\n${windowDoorPositions}`
    : "";

  const outletCtx = outletPositions
    ? `\n\n## OUTLET POSITIONS\n${outletPositions}\nCheck that powered items (lamps, media consoles) have realistic outlet access.`
    : "";

  const existingItemsCtx = existingItems?.length
    ? `\n\n## EXISTING ITEMS TO COORDINATE WITH\n${existingItems.map((item) => `- ${item}`).join("\n")}\nThe bundle must harmonize with these pieces in style, scale, and materials.`
    : "";

  return `Evaluate this bundle of products as a COMPLETE ROOM CONCEPT. Score how well these items work TOGETHER as a set, not just individually.

## ROOM CONTEXT
- Room type: ${roomType}
- Study the room photos to understand existing furniture and finishes
- Use the building finishes, floor plan, and apartment context from the system prompt
${prioritiesContext ? `- ${prioritiesContext}` : ""}

## WHAT'S ALREADY IN THE ROOM
${existingContext}
${problemsContext ? `\n${problemsContext}` : ""}
${directionContext ? `\n## DESIGN DIRECTION\n${directionContext}` : ""}${spatialCtx}${floorPlanCtx}${placementCtx}${lightingCtx}${windowDoorCtx}${outletCtx}${existingItemsCtx}

## SCORING PROCESS — For each dimension, follow these steps:
1. List the relevant attributes of ALL products in the bundle
2. Compare them against each other AND the room context
3. Identify specific strengths and weaknesses
4. Assign a score based on the evidence

### 1. palette_harmony_score (0-10): Color coordination
- Step 1: List each product's primary color(s)
- Step 2: Map each to warm/cool/neutral
- Step 3: Check against apartment finishes (floors, walls, cabinetry) from photos
- Step 4: Do they form a cohesive palette or clash?
- 9-10: All products share 2-3 coordinating color families that work with building finishes
- 7-8: Colors compatible but not perfectly cohesive (slight warm/cool tension)
- 5-6: Some color clashing — products feel from different rooms
- Below 5: Colors actively conflict

### 2. material_balance_score (0-10): Texture variety + practicality
- Step 1: List each product's material(s)
- Step 2: Count distinct material TYPES: wood, textile, metal, stone, glass, leather, ceramic
- Step 3: A good bundle has 3-4+ distinct types. All-wood or all-fabric = too monotone.
- Step 4: **Durability/maintenance**: white boucle with pets? Glass with kids? Delicate fabrics in high-traffic areas?
- Step 5: **Climate suitability**: Heavy wool in tropical climates? Cold metal without nearby textiles?
- 9-10: Rich variety (wood + textile + metal + organic), all durable and practical
- 7-8: Good variety with 3+ materials, minor gaps
- 5-6: Too monotone OR poor durability choices
- Below 5: Material conflict or fundamentally impractical

### 3. scale_balance_score (0-10): Proportions
- Step 1: Note each product's dimensions
- Step 2: Check rug covers 60-80% of seating area
- Step 3: Check coffee table is ⅔ to full width of sofa, no taller than sofa seat
- Step 4: Check dining table seats enough + 24" chair pullback
- Step 5: Will everything fit without crowding?
- 9-10: Every piece correctly scaled, anchored by dominant piece
- 7-8: Most right, one slightly over/under
- 5-6: One or more feels wrong for the space
- Below 4: Clearly wrong sizes

### 4. style_consistency_score (0-10): Aesthetic unity
- Step 1: Identify each product's style family (mid-century, contemporary, traditional, etc.)
- Step 2: Do they all belong to same family or a deliberate curated mix?
- Step 3: Cross-reference with the design direction
- 9-10: Looks professionally designed — every piece intentional
- 7-8: Mostly cohesive, one piece slightly off but still works
- 5-6: Mixed signals (some mid-century, some farmhouse, some industrial)
- Below 5: Random collection feel

### 5. room_completion_score (0-10): Does it solve the diagnosed problems?
- Step 1: List every diagnosed problem from above
- Step 2: Check off which ones this bundle addresses
- Step 3: What's still missing?
- 9-10: Every diagnosed issue addressed, room will feel complete
- 7-8: Most issues addressed, 1-2 minor gaps (plant, tray)
- 5-6: Some gaps — still missing major elements (no rug, no art)
- Below 5: Fails to address main problems

### 6. spatial_arrangement_score (0-10): Physical arrangement
- Step 1: Mentally place every item in its intended position
- Step 2: Check traffic flow (36" main paths, 18" coffee table to sofa gap)
- Step 3: Check zone clarity in multi-function rooms
- Step 4: Check sightlines and focal points
- Step 5: **Window/door clearance**: Does anything block windows (reducing light) or door swings?
- Step 6: **Outlet access**: Do powered items (lamps, media consoles) have realistic outlet access?
- 9-10: Every piece has a clear home, flow is natural, nothing blocked
- 7-8: Arrangement mostly works, one piece slightly awkward
- 5-6: Some spatial issues (crowded zone, blocked path)
- Below 5: Significant problems (blocked paths, colliding zones)

### 7. practicality_score (0-10): Real-world livability
- Step 1: Can the client host guests? Count seating.
- Step 2: Check clearances (30"+ walkways)
- Step 3: Are pieces durable for daily use?
- Step 4: **Lighting adequacy**: Enough light sources for evening use? Dark corners without task lighting?
- Step 5: **Acoustic balance**: Enough soft materials (rug, curtains, upholstery) to absorb sound in rooms with hard surfaces?
- 9-10: Perfectly serves client's actual life
- 7-8: Mostly practical, one minor concern
- 5-6: Some impractical elements
- Below 5: Fundamentally impractical

## OUTPUT FORMAT — Return this exact JSON:
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
    "strongest_aspect": "What works best — name the specific items and why they work together",
    "weakest_aspect": "The single biggest weakness — name the item and the problem",
    "what_feels_missing": "Specific categories or elements still needed after this bundle",
    "what_should_be_swapped_first": "Which item to replace first, what to replace it with, and why"
  },
  "verdict": "2-3 sentence summary. Would a professional designer recommend this to a client? Be honest."
}

## CRITICAL REMINDERS
- Score the COMBINATION, not individual items. Two beautiful pieces that clash = low scores.
- Use the FULL 0-10 scale. Not everything is 6-8.
- Every claim in analysis must reference a specific product by name.
- If you're unsure about dimensions fitting, say so and lower spatial_arrangement_score.`;
}
