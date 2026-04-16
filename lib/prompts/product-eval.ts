import { truncateContext, type ContextSection } from "@/lib/ai/context-truncation";
import { formatExtractedFloorPlanForPrompt } from "@/lib/agents/format-floor-plan";
import type { DiagnosisData, DesignDirection, ExtractedFloorPlan } from "@/lib/types/database";

export interface EvalContextArgs {
  roomType: string;
  category: string;
  existingItems: string[];
  budgetMode: string;
  otherRoomsContext?: string;
  priorities?: string[];
  diagnosis?: DiagnosisData;
  designDirection?: DesignDirection;
  placement?: string;
  spatialLayout?: string;
  floorPlan?: Record<string, unknown>;
  /** Structured floor plan extracted via vision model — preferred over legacy floorPlan */
  extractedFloorPlan?: ExtractedFloorPlan;
  lightingConditions?: string;
  windowDoorPositions?: string;
  outletPositions?: string;
  userContext?: string;
  replaceItems?: string[];
  /**
   * Pre-formatted "EXISTING IDENTIFIED PIECES" block (see
   * `buildIdentifiedPiecesBlock`). Empty/undefined keeps the prompt
   * byte-for-byte equivalent to the pre-feature shape.
   */
  identifiedContext?: string;
}

/**
 * Build the shared context section used by every product-eval prompt variant.
 * Extracted so aesthetic / functional / full prompts all share identical
 * situational grounding — different scoring instructions don't get different
 * diagnoses or room context.
 */
function buildEvalContext(args: EvalContextArgs): string {
  const {
    roomType,
    category,
    existingItems,
    budgetMode,
    otherRoomsContext,
    priorities,
    diagnosis,
    designDirection,
    placement,
    spatialLayout,
    floorPlan,
    extractedFloorPlan,
    lightingConditions,
    windowDoorPositions,
    outletPositions,
    userContext,
    replaceItems,
    identifiedContext,
  } = args;

  const paletteInfo = designDirection?.recommended_palette?.length
    ? `Target palette: ${designDirection.recommended_palette.join(", ")}`
    : "Infer the appropriate palette from the room photos and apartment context in the system prompt.";

  const materialsInfo = designDirection?.recommended_materials?.length
    ? `Target materials: ${designDirection.recommended_materials.join(", ")}`
    : "Infer appropriate materials from room photos and building finishes.";

  const styleInfo = designDirection?.style_notes
    ? `Style direction: ${designDirection.style_notes}`
    : "Infer the style direction from room photos and apartment context.";

  const diagnosisContext = diagnosis
    ? [
        diagnosis.what_is_working?.length && `What's working in this room: ${diagnosis.what_is_working.join("; ")}`,
        diagnosis.what_is_not_working?.length && `What's NOT working: ${diagnosis.what_is_not_working.join("; ")}`,
        diagnosis.biggest_improvement_opportunities?.length && `Biggest opportunities: ${diagnosis.biggest_improvement_opportunities.join("; ")}`,
        diagnosis.scale_proportion_issues?.length && `Scale/proportion issues: ${diagnosis.scale_proportion_issues.join("; ")}`,
        diagnosis.color_issues?.length && `Color issues: ${diagnosis.color_issues.join("; ")}`,
        diagnosis.texture_material_issues?.length && `Texture/material issues: ${diagnosis.texture_material_issues.join("; ")}`,
        diagnosis.layout_issues?.length && `Layout issues: ${diagnosis.layout_issues.join("; ")}`,
        diagnosis.lighting_issues?.length && `Lighting issues: ${diagnosis.lighting_issues.join("; ")}`,
      ].filter(Boolean).join("\n")
    : "";

  const prioritiesContext = priorities?.length
    ? `User priorities: ${priorities.join(", ")}`
    : "";

  const placementContext = placement
    ? `\n- **Intended placement**: ${placement}`
    : "";

  const sections: ContextSection[] = [];

  sections.push({
    key: "room_context",
    priority: 2,
    content: `## ROOM CONTEXT
- Room type: ${roomType}
- Product category: ${category}
- Budget mode: ${budgetMode}
- Existing items in room: ${existingItems.length > 0 ? existingItems.join(", ") : "See apartment context in system prompt and room photos"}${placementContext}
${prioritiesContext ? `\n${prioritiesContext}` : ""}
${replaceItems?.length ? `\n## ITEMS BEING REPLACED OR REMOVED\n${replaceItems.map((item) => `- ${item}`).join("\n")}\nThis product may be a REPLACEMENT for one of these items. If so, it should solve the same functional need but better match the design direction.` : ""}`,
  });

  if (otherRoomsContext) {
    // Priority 2 — cross-room coherence is a core fit-scoring signal (a sofa
    // that clashes with adjacent-room palettes fails apartment_fit_note). We
    // previously had this at 4, which meant it was the first section to get
    // truncated on long contexts even though it's as load-bearing as the
    // design direction or diagnosis.
    sections.push({
      key: "other_rooms",
      priority: 2,
      content: `## OTHER ROOMS IN APARTMENT (for cross-room coherence)\n${otherRoomsContext}`,
    });
  }

  sections.push({
    key: "design_direction",
    priority: 2,
    content: `## DESIGN DIRECTION (from room diagnosis)\n${paletteInfo}\n${materialsInfo}\n${styleInfo}`,
  });

  if (diagnosisContext) {
    sections.push({ key: "diagnosis", priority: 2, content: `## ROOM DIAGNOSIS — PROBLEMS TO SOLVE\n${diagnosisContext}` });
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
    sections.push({
      key: "floor_plan",
      priority: 3,
      content: `## FLOOR PLAN DIMENSIONS\nTotal sqft: ${floorPlan.total_sqft || "unknown"}\nRoom dimensions: ${JSON.stringify(floorPlan.room_dimensions || {})}\nRoom layout: ${floorPlan.room_layout || "unknown"}\nSpatial features: ${Array.isArray(floorPlan.notable_spatial_features) ? floorPlan.notable_spatial_features.join(", ") : "unknown"}`,
    });
  }

  if (lightingConditions) {
    sections.push({ key: "lighting", priority: 3, content: `## LIGHTING CONDITIONS\n${lightingConditions}` });
  }
  if (windowDoorPositions) {
    sections.push({ key: "windows_doors", priority: 3, content: `## WINDOW & DOOR POSITIONS\n${windowDoorPositions}` });
  }
  if (outletPositions) {
    sections.push({ key: "outlets", priority: 3, content: `## OUTLET POSITIONS\n${outletPositions}` });
  }

  if (userContext) {
    sections.push({
      key: "user_notes",
      priority: 2,
      content: `## USER NOTES ABOUT THIS ROOM\n"${userContext}"\nIMPORTANT: Take these notes into account when scoring. If they mention something not visible in photos, incorporate that information. If they say to ignore something, exclude it from scoring considerations.`,
    });
  }

  if (identifiedContext) {
    // Give identified-pieces block very high priority (1) so it never gets
    // truncated — it's the ground truth for scale/material math.
    sections.push({
      key: "identified_pieces",
      priority: 1,
      content: `${identifiedContext}\nIMPORTANT for scoring: Treat these as EXISTING FIXTURES. The product being evaluated must be COMPATIBLE with them — matching scale (within ~20% of canonical dimensions), complementary materials, and a palette that works alongside the listed colors. Products proposing a REPLACEMENT for any identified piece (same category) should be scored down hard unless the room's replace_items list it.`,
    });
  }

  // Reserve 8K of 16K budget for scoring instructions + output format + thinking.
  const contextResult = truncateContext(sections, 8000, 0);
  return contextResult.text;
}

export function getProductEvalPrompt(
  roomType: string,
  category: string,
  existingItems: string[],
  budgetMode: string,
  otherRoomsContext?: string,
  priorities?: string[],
  diagnosis?: DiagnosisData,
  designDirection?: DesignDirection,
  placement?: string,
  spatialLayout?: string,
  floorPlan?: Record<string, unknown>,
  lightingConditions?: string,
  windowDoorPositions?: string,
  outletPositions?: string,
  userContext?: string,
  replaceItems?: string[]
): string {
  const assembledContext = buildEvalContext({
    roomType, category, existingItems, budgetMode,
    otherRoomsContext, priorities, diagnosis, designDirection,
    placement, spatialLayout, floorPlan,
    lightingConditions, windowDoorPositions, outletPositions,
    userContext, replaceItems,
  });

  return `You are a world-class interior designer evaluating a specific product for a specific client. Think like a designer who has visited this apartment, studied the photos, knows the building's finishes, and understands how this person lives.

## SCORING PROCESS — For each dimension below, follow these steps:
1. What specific evidence supports a high score?
2. What specific evidence supports a low score?
3. Based on the balance of evidence, what score is fair?

Evaluate the following product using THREE LAYERS of analysis:

${assembledContext}

## LAYER 1: INDIVIDUAL ITEM FIT (8 dimensions, each 0-10)

1. **style_fit_score**: Does it match the design direction above? Score based on the ACTUAL style direction for this apartment — not generic assumptions.
   - Example: If direction is "warm modern" and product is "industrial chrome wire shelf" → score 2-3. If product is "walnut shelf with clean lines" → score 8-9.

2. **palette_fit_score**: Does it complement the apartment's actual palette? Consider the building finishes (floors, cabinetry, countertops) from the system prompt and the colors visible in the room photos.
   - Example: Product is "warm oak" in a room with cool gray floors and chrome fixtures → score 4-5 (undertone clash). Product is "warm walnut" in a room with warm oak floors and brass → score 8-9.

3. **material_fit_score**: Does the material work with the apartment's existing finishes? Consider what you SEE in the room photos — the flooring, the cabinetry, any existing furniture materials.
   - Also consider **durability and maintenance**: Is this material practical for the room's use? White boucle with pets = problem. Glass coffee table with toddlers = risk. Velvet in humid climates degrades. Light fabrics in high-traffic areas stain. Outdoor-adjacent rooms need weather-resistant materials.
   - Consider **climate suitability**: Does the material suit the local climate? Heavy wool rugs in tropical apartments feel wrong. Metal furniture in cold climates feels harsh without textile warmth nearby.

4. **scale_fit_score**: Is it correctly scaled for its intended placement? Use the floor plan dimensions and room photos. Consider:
   - Will it PHYSICALLY FIT in the intended placement? Check dimensions against available space.
   - Rugs too small for the seating area: heavily penalize
   - Coffee tables too small or too large for the sofa arrangement: penalize
   - Dining tables: must seat the right number AND leave 24" pullback for chairs
   - Art too small for the wall space: penalize
   - Oversized pieces that would block walkways or crowd adjacent furniture: penalize
   - Check the intended placement description — does the product's size work in that specific spot?
   - **Window/door clearance**: Would this item block a window (reducing natural light), obstruct a door swing, or crowd a doorway? Check placement against known window/door positions.

5. **function_fit_score**: Does it solve a real problem AND work in its intended position? Consider:
   - Seating capacity — does the client need to host guests? Is there enough seating for entertaining?
   - Dining — can they host dinner parties? Is the table big enough?
   - Storage — does it address clutter or organization needs?
   - Lighting — does it solve a lighting gap? If it's a reading lamp, is it placed near the reading spot?
   - Comfort — is it actually comfortable for daily use, not just pretty?
   - Flow — does it work with the room's traffic patterns and spatial layout? Does the placement make functional sense (e.g., side table within arm's reach of seating, lamp near a task area)?
   - **Lighting suitability** — If it's a lamp, does it address a known lighting gap (dark corner, reading area, task zone)? For reflective/glossy surfaces, will they create glare near windows? For light-colored textiles, do they work with the room's natural light direction?
   - **Acoustic impact** — In rooms with all hard surfaces (hardwood + glass + concrete), textiles (rugs, curtains, upholstery) are critical for sound absorption. In open floor plans, soft materials matter even more. Penalize adding MORE hard surfaces to an already acoustically harsh room.
   - **Outlet proximity** — For lamps, media consoles, and powered items: is there a likely outlet near the intended placement? A floor lamp in the middle of the room with no nearby outlet = impractical.

6. **cohesion_fit_score**: Does it work with what's already in the room? Look at the room photos — consider the existing furniture, finishes, and overall vibe. Don't assume what's there; base this on what you SEE.

7. **value_fit_score**: How strong is the value relative to impact and price? ${budgetMode === "budget" ? "Weight this heavily." : budgetMode === "best_possible" ? "Weight this less — quality over price." : "Balance quality and price."}

8. **confidence_score**: How confident are you in this evaluation? Based on evidence quality:
   - 9-10: Complete data — price, exact dimensions, materials list, multiple clear images, lifestyle photo
   - 7-8: Most data present but missing one element (e.g., no lifestyle image or no exact dimensions)
   - 5-6: Partial data — have price and title but unclear dimensions, materials, or colors
   - 3-4: Minimal data — substantial guessing required, poor images
   - 1-2: Almost no reliable data — product details are vague or missing

## SCORE CALIBRATION — READ ALL EXAMPLES, THEN SCORE
- **9-10 (Exceptional)**: Product solves specific diagnosed problems, perfect scale, materials and palette match exactly. Example: A walnut coffee table with tapered legs for a mid-century room that already has a walnut media console and warm rug — materials match, scale is perfect (48" table for 84" sofa), style is cohesive. THIS IS RARE.
- **7-8 (Strong)**: Genuinely good fit with minor concerns. Example: A linen accent chair in warm ivory for a room with a leather sofa and oak floors — style works, palette compatible, good scale. Minor: exact shade might lean slightly cool.
- **5-6 (Mediocre)**: Safe but doesn't solve problems well. Example: A generic gray fabric ottoman for a room that needs warmth and texture — doesn't clash but doesn't help either. THIS IS AVERAGE.
- **3-4 (Poor)**: Actively conflicts. Example: A glossy white lacquer side table in a room with warm wood tones and matte finishes. Or: a 5x7 rug under an L-shaped sectional that needs an 8x10.
- **1-2 (Wrong)**: Completely wrong style/scale. Example: A farmhouse distressed dining table for a sleek modern apartment. Or: a 4-person table when client hosts parties of 8.

CRITICAL: Do NOT cluster all scores in the 6-8 range. Use the full 0-10 scale. If something is mediocre, score it 5. If it has problems, score 3-4.

If the room diagnosis lists scale_proportion_issues, you MUST check this product's dimensions against those issues and penalize heavily if it repeats the same problem (e.g., another undersized rug, another oversized table).

## LAYER 2: AREA FIT
How does this product work with the other pieces already in or planned for this specific area? Does it enhance the overall area or create conflict?

## LAYER 3: APARTMENT FIT
Does this product work with the overall apartment aesthetic? Would adding this to the ${roomType} make the apartment feel disconnected or more cohesive as a whole?

## IMPORTANT LIFESTYLE CONSIDERATIONS
Think like a designer who understands how people LIVE:
- A beautiful coffee table that's too fragile for daily use is a bad recommendation
- A stunning dining table that only seats 2 when the client hosts dinner parties is wrong
- An accent chair that blocks the walking path is useless
- A rug that's too small to anchor the seating area fails its purpose
- Consider hosting, entertaining, pets, kids, daily routines
- The best design serves the client's actual life, not just Instagram

## OUTPUT FORMAT
Return a JSON object:
{
  "scores": {
    "style_fit_score": number,
    "palette_fit_score": number,
    "material_fit_score": number,
    "scale_fit_score": number,
    "function_fit_score": number,
    "cohesion_fit_score": number,
    "value_fit_score": number,
    "confidence_score": number
  },
  "reasoning": {
    "top_reasons": ["3-5 strongest reasons it works or fails — be specific, reference actual product attributes and room diagnosis"],
    "risks": ["2-4 specific risks — e.g. 'rug is 5x7 but seating area needs at least 8x10', 'brass legs may clash with chrome kitchen fixtures'"],
    "suggestions": ["1-3 alternatives or modifications — e.g. 'the 8x10 version of this rug would be a better fit', 'consider the walnut finish instead of oak'"]
  },
  "area_fit_note": "2-3 sentences on how it works with other pieces in this area. Reference specific existing furniture and how this product relates to them.",
  "apartment_fit_note": "1-2 sentences on apartment-wide coherence — does it match the building's finishes and other rooms?"
}

## FINAL CHECKLIST before returning scores:
- Did I check the product's dimensions against the room's scale issues?
- Did I verify the product's colors against the recommended palette?
- Did I verify the product's materials against the recommended materials?
- Did I consider how the client actually LIVES (hosting, daily use, comfort)?
- Did I check durability/maintenance for the material given the room's use patterns?
- Did I check if this blocks windows, doors, or natural light paths?
- Did I verify outlet access for powered items (lamps, media consoles)?
- Did I consider acoustic impact (more hard surfaces in an already hard room)?
- Am I using the full 0-10 scale, not clustering everything in 6-8?

Be honest and specific. Do not inflate scores. A 7+ means it's genuinely strong. A 5 is mediocre. Below 4 means real problems.`;
}

/**
 * Aesthetic-pass prompt: 4 visual/taste dimensions + reasoning + notes.
 * Paired with getFunctionalEvalPrompt — together they replace the 8-dim
 * monolith with two focused parallel calls so each pass gets full model
 * attention on its own question.
 */
export function getAestheticEvalPrompt(args: EvalContextArgs): string {
  const { budgetMode } = args;
  const assembledContext = buildEvalContext(args);

  return `You are a world-class interior designer evaluating a specific product for a specific client. This pass focuses exclusively on **aesthetic fit** — does the product look right in this apartment? A separate pass handles spatial/functional fit; do not score those dimensions here.

## SCORING PROCESS — For each dimension below:
1. What specific evidence (in the product image and room photos) supports a high score?
2. What specific evidence supports a low score?
3. Based on the balance of evidence, what score is fair?

${assembledContext}

## AESTHETIC SCORING (4 dimensions, each 0-10)

1. **style_fit_score**: Does it match the design direction above? Score based on the ACTUAL style direction for this apartment — not generic assumptions.
   - Example: If direction is "warm modern" and product is "industrial chrome wire shelf" → 2-3. If "walnut shelf with clean lines" → 8-9.

2. **palette_fit_score**: Does it complement the apartment's actual palette? Consider building finishes (floors, cabinetry, countertops) and colors visible in room photos.
   - Example: "warm oak" in a room with cool gray floors and chrome fixtures → 4-5 (undertone clash). "warm walnut" in warm oak + brass room → 8-9.

3. **material_fit_score**: Does the material work with existing finishes visible in room photos?
   - Also consider **durability/maintenance**: white boucle with pets = problem. Glass coffee table with toddlers = risk. Velvet in humid climates degrades.
   - Consider **climate suitability** of the material for the apartment's climate.

4. **cohesion_fit_score**: Does it work with what's already in the room? Look at the room photos — consider existing furniture, finishes, and overall vibe. Base this on what you SEE.

## SCORE CALIBRATION — READ ALL, THEN SCORE
- **9-10 (Exceptional)**: Materials/palette match exactly, style is cohesive. RARE.
- **7-8 (Strong)**: Genuinely good fit with minor concerns.
- **5-6 (Mediocre)**: Safe but uninspired. THIS IS AVERAGE.
- **3-4 (Poor)**: Actively conflicts (wrong finish family, clashing undertones).
- **1-2 (Wrong)**: Completely wrong style family.

CRITICAL: Use the full 0-10 scale. Do NOT cluster scores in 6-8.

${budgetMode ? "" : ""}## AREA FIT NOTE
2-3 sentences on how this product works with OTHER pieces in the same area. Reference specific existing furniture.

## APARTMENT FIT NOTE
1-2 sentences on apartment-wide coherence — does it match building finishes and other rooms?

## OUTPUT FORMAT (JSON, no prose, no markdown fences)
{
  "scores": {
    "style_fit_score": number,
    "palette_fit_score": number,
    "material_fit_score": number,
    "cohesion_fit_score": number
  },
  "reasoning": {
    "top_reasons": ["3-5 strongest reasons — reference actual product attributes and diagnosis"],
    "risks": ["2-4 specific risks — e.g. 'brass legs may clash with chrome kitchen fixtures'"],
    "suggestions": ["1-3 alternatives or modifications"]
  },
  "area_fit_note": "2-3 sentences on area-level fit",
  "apartment_fit_note": "1-2 sentences on apartment-wide coherence"
}`;
}

/**
 * Functional-pass prompt: 3 spatial/objective dimensions + confidence.
 * No reasoning text — just scores. Paired with getAestheticEvalPrompt.
 */
export function getFunctionalEvalPrompt(args: EvalContextArgs): string {
  const { budgetMode } = args;
  const assembledContext = buildEvalContext(args);

  return `You are a world-class interior designer evaluating the **spatial and functional fit** of a specific product. This pass focuses exclusively on: will it fit, will it work, is it good value? A separate pass handles aesthetic fit — do not score style/palette/material/cohesion here.

## SCORING PROCESS — For each dimension below:
1. What specific evidence (dimensions, placement, room photos, floor plan) supports a high score?
2. What specific evidence supports a low score?
3. Based on the balance of evidence, what score is fair?

${assembledContext}

## FUNCTIONAL SCORING (4 dimensions, each 0-10)

1. **scale_fit_score**: Will it physically fit and be correctly scaled? Use the floor plan, placement, and room photos.
   - Check dimensions against available space and the intended placement description.
   - Rugs too small for the seating area: heavily penalize.
   - Dining tables must seat the right number AND leave 24" pullback for chairs.
   - Art too small for the wall: penalize. Oversized pieces that block walkways: penalize.
   - **Window/door clearance**: Would this block a window, obstruct a door swing, or crowd a doorway?
   - If no dimensions listed, score 5 (neutral).

2. **function_fit_score**: Does it solve a real problem AND work in its intended position?
   - Seating capacity for hosting; dining capacity; storage for clutter; task lighting near reading areas.
   - **Flow**: does it work with the room's traffic patterns and spatial layout?
   - **Lighting suitability**: reading lamp near reading spot? Glossy surfaces near windows creating glare?
   - **Acoustic impact**: in all-hard-surface rooms (hardwood + glass + concrete), textiles matter. Penalize adding MORE hard surfaces to an acoustically harsh room.
   - **Outlet proximity**: lamps, media consoles, powered items — is there a likely outlet near the intended placement?

3. **value_fit_score**: Price vs. quality/impact. ${budgetMode === "budget" ? "Weight HEAVILY. Over-tier products → score 3 or below." : budgetMode === "best_possible" ? "Weight less — quality over price." : "Balance quality and price."}
   - If price is missing, score 5 (neutral) — do NOT assume good value.

4. **confidence_score**: How reliable is the product data?
   - 9-10: complete — title, price, materials, dimensions, multiple clear images, lifestyle photo
   - 7-8: mostly complete, missing one field
   - 5-6: partial — title and maybe price, but materials/dimensions unclear
   - 3-4: minimal — only title and retailer
   - 1-2: almost no reliable data

## SCORE CALIBRATION
- **9-10**: Perfect fit for the space, solves a diagnosed problem, strong value.
- **7-8**: Works with minor concerns.
- **5-6**: Acceptable but not ideal. THIS IS AVERAGE.
- **3-4**: Obvious issues (wrong size, blocks flow, missing dimensions = likely trouble).
- **1-2**: Clearly wrong (won't fit, blocks a walkway, completely impractical).

CRITICAL: Use the full 0-10 scale. If the room diagnosis lists scale_proportion_issues, you MUST check this product's dimensions against them and penalize if it repeats the problem.

## OUTPUT FORMAT (JSON, no prose, no markdown fences)
{
  "scores": {
    "scale_fit_score": number,
    "function_fit_score": number,
    "value_fit_score": number,
    "confidence_score": number
  }
}`;
}
