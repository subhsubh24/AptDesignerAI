import { truncateContext, type ContextSection } from "@/lib/ai/context-truncation";
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
  existingItems?: string[],
  userContext?: string,
  replaceItems?: string[],
  whatShouldGo?: string[]
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

  // ─── Assemble context with priority-based truncation ──────
  const sections: ContextSection[] = [];

  sections.push({
    key: "room_context",
    priority: 2,
    content: `## ROOM CONTEXT\n- Room type: ${roomType}\n- Consider how ALL items work together as a set, not just individually\n- Use the building finishes, floor plan, and apartment context from the system prompt\n- Study the room photos to understand existing furniture and finishes${prioritiesContext ? `\n- ${prioritiesContext}` : ""}`,
  });

  sections.push({
    key: "existing_items",
    priority: 2,
    content: `## WHAT'S ALREADY IN THE ROOM\n${existingContext}${problemsContext ? `\n${problemsContext}` : ""}`,
  });

  if (directionContext) {
    sections.push({ key: "design_direction", priority: 2, content: `## DESIGN DIRECTION\n${directionContext}` });
  }

  if (spatialLayout) {
    sections.push({ key: "spatial_layout", priority: 3, content: `## SPATIAL LAYOUT PLAN\n${spatialLayout}` });
  }

  if (floorPlan) {
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

  if (replaceItems?.length) {
    sections.push({ key: "replace_items", priority: 3, content: `## ITEMS BEING REPLACED OR REMOVED\n${replaceItems.map((item) => `- ${item}`).join("\n")}\nThe bundle should include adequate replacements for these items. Verify the bundle addresses these removals.` });
  }
  if (whatShouldGo?.length) {
    sections.push({ key: "what_should_go", priority: 3, content: `## FROM DIAGNOSIS — ITEMS THAT SHOULD GO\n${whatShouldGo.map((item) => `- ${item}`).join("\n")}\nVerify this bundle doesn't repeat the same problems these items had.` });
  }

  if (userContext) {
    sections.push({ key: "user_notes", priority: 2, content: `## USER NOTES ABOUT THIS ROOM\n"${userContext}"\nIMPORTANT: Take these notes into account when evaluating the bundle. If the user mentions constraints or preferences not visible in photos, factor them into your scoring.` });
  }

  const contextResult = truncateContext(sections, 20000, 0);
  const assembledContext = contextResult.text;

  return `Evaluate this bundle of products as a COMPLETE ROOM CONCEPT. Score how well these items work TOGETHER as a set, not just individually.

## SCORING PROCESS — For each dimension, follow these steps:
1. List the relevant attributes of ALL products in the bundle
2. Compare them against each other AND the room context
3. Identify specific strengths and weaknesses
4. Assign a score based on the evidence

You are a world-class designer reviewing a proposed set of pieces for a real client's apartment. You know their building, their finishes, their room, and how they live.

${assembledContext}

## SCORE CALIBRATION — READ BEFORE SCORING
- **9-10 (Exceptional)**: Professional-grade curation. Every piece intentional. Materials, colors, scale all harmonize. THIS IS RARE.
- **7-8 (Strong)**: Solid set with minor concerns. One piece could be better but doesn't break the concept.
- **5-6 (Mediocre)**: Safe but uninspired. Products don't clash but don't elevate each other. THIS IS AVERAGE.
- **3-4 (Poor)**: Active conflicts between items. Wrong scale, clashing materials, or missing key pieces.
- **1-2 (Wrong)**: Incoherent set. Looks like random pieces from different homes.

CRITICAL: Use the FULL 0-10 range. If the bundle is just okay, score it 5-6. Do NOT give everything 6-8.

## SCORING DIMENSIONS (each 0-10)

1. **palette_harmony_score**: Do the colors work together as a cohesive set?
   - Step 1: List each product's primary color(s)
   - Step 2: Map each to warm/cool/neutral
   - Step 3: Check against the ACTUAL apartment finishes (floors, walls, cabinetry) from photos and system prompt
   - Step 4: Do they form a cohesive palette or clash?
   - 9-10: All products share 2-3 coordinating color families that work with building finishes
   - 7-8: Colors are compatible but not perfectly cohesive (e.g., slight warm/cool tension)
   - 5-6: Some color clashing — products feel like they came from different rooms
   - Below 5: Colors actively conflict or ignore the apartment's existing finishes

2. **material_balance_score**: Is there a healthy mix of textures and materials?
   - Step 1: List each product's material(s)
   - Step 2: Count distinct material TYPES: wood, textile/fabric, metal, stone/ceramic, glass, leather
   - Step 3: A good bundle has at least 3-4 distinct material types. All-wood or all-fabric = too monotone.
   - **Durability/maintenance**: Are materials practical for the room's use? White boucle in a pet-friendly home, glass with toddlers, or delicate fabrics in high-traffic zones should lower the score.
   - **Climate suitability**: Heavy wool in tropical climates, cold metal in northern apartments without nearby textiles, velvet in humid environments — all mismatches.
   - 9-10: Rich material variety — wood + textile + metal + organic creates visual depth, ALL durable and climate-appropriate
   - 7-8: Good variety with 3+ materials, minor gaps or one questionable durability choice
   - 5-6: Too monotone — everything is wood, or everything is fabric. Or good variety but poor durability choices.
   - Below 5: Material conflict, jarring mismatch, or fundamentally impractical material choices

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
   - Step 1: Mentally place every item in its intended position (see INTENDED PLACEMENTS above)
   - Step 2: Check traffic flow: can someone walk through the room naturally? 36" for main paths, 18" between coffee table and sofa
   - Step 3: Check zone clarity: in multi-function rooms, do items define clear zones (living, dining, work)?
   - Step 4: Check sightlines: is there a clear focal point? Can people see each other in conversation?
   - Step 5: Check relationships: are items that should be near each other actually near each other? (lamp by reading chair, side table within reach of sofa arm)
   - Check orientation: do seating pieces face each other or a focal point, not the wall?
   - **Window/door clearance**: Do any items block windows (reducing natural light), obstruct door swings, or crowd doorways? A tall bookshelf in front of a window = penalize. A console table blocking a closet door = penalize.
   - **Outlet access**: Do powered items (lamps, media consoles) have realistic outlet access in their intended positions? A floor lamp placed far from any wall outlet = impractical.
   - 9-10: Every piece has a clear home, flow is natural, zones are well-defined, nothing blocks windows/doors, the room feels intentional
   - 7-8: Arrangement mostly works, one piece feels slightly awkward in position
   - 5-6: Some spatial issues — crowded zone, unclear path, pieces that seem to float without purpose, or one item blocking a window/door
   - Below 5: Significant spatial problems — items blocking paths/windows/doors, no clear arrangement logic, zones collide

7. **practicality_score**: Is this livable? Think about how the client ACTUALLY uses this room:
   - Can they host guests? Count total seating capacity vs. client's hosting needs
   - Can they eat meals with friends? Is the dining setup adequate for their lifestyle?
   - Can they walk through easily? Check clearances (30+ inches for walkways)
   - Are pieces durable for daily use? (Fragile glass with kids? White fabric with pets?)
   - Does the total bundle price make sense for the tier?
   - **Lighting adequacy**: Does this bundle include enough lighting for the room's needs? Consider natural light direction and time of day. A north-facing room with only one table lamp = under-lit. Dark corners without task lighting = penalize. Glossy/reflective surfaces near windows creating glare = penalize.
   - **Acoustic balance**: Is there enough soft material to absorb sound? In rooms with hardwood floors, concrete walls, or large glass windows, the bundle MUST include textile elements (rug, curtains, upholstered seating) for acoustic comfort. All-hard-surface bundles in open floor plans are acoustically harsh — penalize.
   - 9-10: Perfectly serves the client's actual life — hosting, daily routines, comfort, adequate lighting, acoustically balanced
   - 7-8: Mostly practical, one minor concern (e.g., could use one more light source, or slightly under-textiled)
   - 5-6: Some impractical elements — e.g., beautiful but not enough seating for hosting, or acoustically harsh with no soft surfaces
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
  "room_vibe": {
    "vibe_summary": "2-3 sentence description of the overall mood and feeling this room will have with these pieces. Describe it the way an interior designer would pitch it to a client — what does walking into this room FEEL like? Reference specific pieces that drive the vibe.",
    "style_keywords": ["3-5 style keywords that capture the aesthetic, e.g. 'warm minimalist', 'lived-in modern', 'earthy calm', 'curated bohemian'"],
    "color_story": "1-2 sentences describing the color narrative — what's the dominant tone, what accents pop, how does light interact with the palette?",
    "mood": "one word or short phrase that captures the emotional quality of the room — e.g. 'cozy refuge', 'bright and energizing', 'calm sophistication', 'effortlessly cool'"
  },
  "verdict": "2-3 sentence summary of this bundle's quality. Would a professional designer recommend this to a client?"
}

## CRITICAL REMINDERS
- A product can score well individually but FAIL in the bundle context (e.g., two beautiful pieces that clash with each other). Focus on relationships between items, not just individual quality. Score the COMBINATION, not the average of individual scores.
- Use the FULL 0-10 scale. Not everything is 6-8.
- Every claim in analysis must reference a specific product by name.
- If you're unsure about dimensions fitting, say so and lower spatial_arrangement_score.`;
}
