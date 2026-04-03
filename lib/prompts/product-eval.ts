import { truncateContext, type ContextSection } from "@/lib/ai/context-truncation";
import type { DiagnosisData, DesignDirection } from "@/lib/types/database";

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
  // Build dynamic design direction from diagnosis — no hardcoded values
  const paletteInfo = designDirection?.recommended_palette?.length
    ? `Target palette: ${designDirection.recommended_palette.join(", ")}`
    : "Infer the appropriate palette from the room photos and apartment context in the system prompt.";

  const materialsInfo = designDirection?.recommended_materials?.length
    ? `Target materials: ${designDirection.recommended_materials.join(", ")}`
    : "Infer appropriate materials from room photos and building finishes.";

  const styleInfo = designDirection?.style_notes
    ? `Style direction: ${designDirection.style_notes}`
    : "Infer the style direction from room photos and apartment context.";

  // Build diagnosis context so scorer knows what problems to solve
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

  // Build priorities context — this captures hosting, seating, lifestyle needs
  const prioritiesContext = priorities?.length
    ? `User priorities: ${priorities.join(", ")}`
    : "";

  // Build spatial context
  const placementContext = placement
    ? `\n- **Intended placement**: ${placement}`
    : "";

  const spatialContext = spatialLayout
    ? `\n\n## SPATIAL LAYOUT PLAN\n${spatialLayout}`
    : "";

  const floorPlanContext = floorPlan
    ? `\n\n## FLOOR PLAN DIMENSIONS\nTotal sqft: ${floorPlan.total_sqft || "unknown"}\nRoom dimensions: ${JSON.stringify(floorPlan.room_dimensions || {})}\nRoom layout: ${floorPlan.room_layout || "unknown"}\nSpatial features: ${Array.isArray(floorPlan.notable_spatial_features) ? floorPlan.notable_spatial_features.join(", ") : "unknown"}`
    : "";

  const environmentContext = [
    lightingConditions && `\n\n## LIGHTING CONDITIONS\n${lightingConditions}`,
    windowDoorPositions && `\n\n## WINDOW & DOOR POSITIONS\n${windowDoorPositions}`,
    outletPositions && `\n\n## OUTLET POSITIONS\n${outletPositions}`,
  ].filter(Boolean).join("");

  // ─── Assemble context with priority-based truncation ──────
  // Priority 1 = critical (scoring instructions), 2 = important (room/design),
  // 3 = helpful (environment/spatial), 4 = nice-to-have (other rooms)
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
    sections.push({
      key: "other_rooms",
      priority: 4,
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

  if (floorPlan) {
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

  // Truncate context sections to fit within a reasonable token budget.
  // Reserve ~8000 tokens for the scoring instructions + output format below.
  const contextResult = truncateContext(sections, 25000, 0);
  const assembledContext = contextResult.text;

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
