import { truncateContext, type ContextSection } from "@/lib/ai/context-truncation";
import type { DiagnosisData, DesignDirection } from "@/lib/types/database";

export interface BundleEvalContextArgs {
  roomType: string;
  priorities?: string[];
  diagnosis?: DiagnosisData;
  designDirection?: DesignDirection;
  spatialLayout?: string;
  placementMap?: Record<string, string>;
  floorPlan?: Record<string, unknown>;
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
  const assembledContext = buildBundleContext({
    roomType, priorities, diagnosis, designDirection, spatialLayout, placementMap, floorPlan,
    lightingConditions, windowDoorPositions, outletPositions,
    existingItems, userContext, replaceItems, whatShouldGo,
  });

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
   - **Use visual style tags**: If products include visual style tags (e.g., "mid-century", "organic modern"), check whether they belong to the same style family. Conflicting tags across products = lower score.
   - 9-10: Looks like a professional designed this room — every piece is intentional
   - 7-8: Mostly cohesive with one piece that's slightly off but still works
   - 5-6: Mixed signals — some pieces are mid-century, some are farmhouse, some are industrial
   - Below 5: Jarring style clash — furniture looks randomly collected

5. **room_completion_score**: Does this bundle make the room feel fully furnished?
   - Check the diagnosis: are all identified issues addressed?
   - List what's still missing after this bundle
   - **Dead zones & empty corners**: Does this bundle activate empty corners, fill awkward gaps behind furniture, and address unused wall stretches identified in the diagnosis? A room with barren corners or empty gaps behind the sofa loses points. A tall plant, arc lamp, corner shelf, or accent chair in a dead zone = bonus.
   - **Tiered completeness scoring**:
     - Missing ANY essential item (primary sofa/bed/table, rug, primary lighting) → score below 6
     - Missing more than half the standard items (accent lighting, textiles, storage) → score below 7
     - Zero finishing items (no art, no plants, no decorative objects) → cap at 7
     - A bundle with ONLY essential items should score 4-5, not 7-8
   - 9-10: All tiers represented, dead zones activated, room feels intentionally complete
   - 7-8: Essentials + most standard items, minor finishing gaps (e.g., still needs plants)
   - 5-6: Has essentials but significant standard/finishing gaps (no art, no textiles, no accent lighting)
   - Below 5: Missing essential items or fails to address the main diagnosed problems

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

## PAIRWISE INTERACTION CHECK
For every PAIR of products in this bundle, evaluate how well they work together.
- Only report pairs with compatibility BELOW 9.0 (omit pairs that work well together — assume they're 9.5+).
- compatibility is 0-10: 10 = perfect pairing, 0 = catastrophic clash.
- conflict_type examples: "color_clash", "material_mismatch", "scale_conflict", "style_conflict", "spatial_crowding"
- This is CRITICAL: two individually great products can be terrible together (e.g., two different wood species, warm lamp + cool art, oversized sofa + oversized coffee table).

## COMPOUNDING SCORING — HOW YOUR SCORES ARE USED
Your 7 dimension scores are combined using a **weighted geometric mean**, not an arithmetic average.
This means ONE bad dimension tanks the overall score:
- Arithmetic: (10+10+10+10+10+10+2)/7 = 8.86 — hides the 2
- Geometric: (10×10×10×10×10×10×2)^(1/7) = 7.24 — the 2 drags it down

So be PRECISE with each dimension. Inflating one score cannot compensate for a real weakness elsewhere.

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
  "pairwise_conflicts": [
    {
      "product_a": "category_or_title_of_first_item",
      "product_b": "category_or_title_of_second_item",
      "compatibility": number_0_to_10,
      "conflict_type": "type_of_clash",
      "reason": "specific explanation of why these two items conflict"
    }
  ],
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
