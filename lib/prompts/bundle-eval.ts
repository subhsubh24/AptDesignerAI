import type { DiagnosisData, DesignDirection } from "@/lib/types/database";

export function getBundleEvalPrompt(
  roomType: string,
  priorities?: string[],
  diagnosis?: DiagnosisData,
  designDirection?: DesignDirection,
  spatialLayout?: string,
  placementMap?: Record<string, string>,
  floorPlan?: Record<string, unknown>
): string {
  // Build dynamic context from diagnosis — no hardcoded apartment references
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
    ? `\n\n## INTENDED PLACEMENTS\n${Object.entries(placementMap).map(([cat, placement]) => `- **${cat}**: ${placement}`).join("\n")}`
    : "";

  return `Evaluate this bundle of products as a complete room concept. You are a world-class designer reviewing a proposed set of pieces for a real client's apartment. You know their building, their finishes, their room, and how they live.

## ROOM CONTEXT
- Room type: ${roomType}
- Consider how ALL items work together as a set, not just individually
- Use the building finishes, floor plan, and apartment context from the system prompt
- Study the room photos to understand existing furniture and finishes
${prioritiesContext ? `- ${prioritiesContext}` : ""}

## WHAT'S ALREADY IN THE ROOM
${existingContext}
${problemsContext ? `\n${problemsContext}` : ""}
${directionContext ? `\n## DESIGN DIRECTION\n${directionContext}` : ""}${spatialCtx}${floorPlanCtx}${placementCtx}

## SCORING DIMENSIONS (each 0-10)

1. **palette_harmony_score**: Do the colors work together as a cohesive set?
   - Map each product's color to warm/cool/neutral
   - Check against the ACTUAL apartment finishes (floors, walls, cabinetry) from photos and system prompt
   - 9-10: All products share 2-3 coordinating color families that work with building finishes
   - 7-8: Colors are compatible but not perfectly cohesive (e.g., slight warm/cool tension)
   - 5-6: Some color clashing — products feel like they came from different rooms
   - Below 5: Colors actively conflict or ignore the apartment's existing finishes

2. **material_balance_score**: Is there a healthy mix of textures and materials?
   - Count distinct material types: wood, textile/fabric, metal, stone/ceramic, glass, leather
   - A good bundle has at least 3-4 distinct material types
   - 9-10: Rich material variety — wood + textile + metal + organic creates visual depth
   - 7-8: Good variety with 3+ materials, minor gaps
   - 5-6: Too monotone — everything is wood, or everything is fabric
   - Below 5: Material conflict or jarring mismatch (e.g., all cheap-looking particleboard)

3. **scale_balance_score**: Are pieces correctly proportioned relative to each other AND the room?
   - Check rug size: should cover at least 60-80% of seating area footprint
   - Check coffee table: should be ⅔ to full width of sofa, no taller than sofa seat
   - Check dining table: must accommodate the seating the client needs
   - 9-10: Every piece is correctly scaled; dominant piece (sofa/table) anchors without overwhelming
   - 7-8: Most pieces are right, one might be slightly over/under sized
   - 5-6: One or more pieces feel wrong for the space
   - Below 4: Clearly wrong — e.g., 5x7 rug under an L-shaped sectional, or oversized table cramming the room

4. **style_consistency_score**: Is the aesthetic unified?
   - All pieces should belong to the same style family or a deliberate, curated mix
   - Cross-reference with the design direction from the room diagnosis
   - 9-10: Looks like a professional designed this room — every piece is intentional
   - 7-8: Mostly cohesive with one piece that's slightly off but still works
   - 5-6: Mixed signals — some pieces are mid-century, some are farmhouse, some are industrial
   - Below 5: Jarring style clash — furniture looks randomly collected

5. **room_completion_score**: Does this bundle solve the room's diagnosed problems?
   - Check the diagnosis: are all identified issues addressed?
   - List what's still missing after this bundle
   - 9-10: Every diagnosed issue is addressed, room will feel complete
   - 7-8: Most issues addressed, 1-2 minor gaps remain (e.g., still needs a plant or tray)
   - 5-6: Addresses some issues but leaves major gaps (e.g., still no rug, still no art)
   - Below 5: Fails to address the main diagnosed problems

6. **spatial_arrangement_score**: Does this bundle work as a physical arrangement?
   - Mentally place every item in its intended position (see INTENDED PLACEMENTS above)
   - Check traffic flow: can someone walk through the room naturally? 36" for main paths, 18" between coffee table and sofa
   - Check zone clarity: in multi-function rooms, do items define clear zones (living, dining, work)?
   - Check sightlines: is there a clear focal point? Can people see each other in conversation?
   - Check relationships: are items that should be near each other actually near each other? (lamp by reading chair, side table within reach of sofa arm)
   - Check orientation: do seating pieces face each other or a focal point, not the wall?
   - 9-10: Every piece has a clear home, flow is natural, zones are well-defined, the room feels intentional
   - 7-8: Arrangement mostly works, one piece feels slightly awkward in position
   - 5-6: Some spatial issues — crowded zone, unclear path, pieces that seem to float without purpose
   - Below 5: Significant spatial problems — items blocking paths, no clear arrangement logic, zones collide

7. **practicality_score**: Is this livable? Think about how the client ACTUALLY uses this room:
   - Can they host guests? Count total seating capacity vs. client's hosting needs
   - Can they eat meals with friends? Is the dining setup adequate for their lifestyle?
   - Can they walk through easily? Check clearances (30+ inches for walkways)
   - Are pieces durable for daily use? (Fragile glass with kids? White fabric with pets?)
   - Does the total bundle price make sense for the tier?
   - 9-10: Perfectly serves the client's actual life — hosting, daily routines, comfort
   - 7-8: Mostly practical, one minor concern
   - 5-6: Some impractical elements — e.g., beautiful but not enough seating for hosting
   - Below 5: Fundamentally impractical for how the client lives

## OUTPUT FORMAT
Return a JSON object:
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
    "strongest_aspect": "what works best about this combination — be specific, name the items",
    "weakest_aspect": "the single biggest weakness — name the item and the problem",
    "what_feels_missing": "specific categories or elements still needed after this bundle",
    "what_should_be_swapped_first": "which specific item should be replaced first, what it should be replaced with, and why"
  },
  "verdict": "2-3 sentence summary of this bundle's quality. Would a professional designer recommend this to a client?"
}

## IMPORTANT
A product can score well individually but FAIL in the bundle context (e.g., two beautiful pieces that clash with each other). Focus on relationships between items, not just individual quality. Score the COMBINATION, not the average of individual scores.`;
}
