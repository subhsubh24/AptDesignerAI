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
  /**
   * Top anchor products already confirmed by quick-score for the room, keyed
   * by category (e.g. "sofa", "area_rug"). Format per value:
   *   "title | dimensions: W×D×H | material: … | colors: …"
   * Injected into scoring for dependent categories so the LLM scores against
   * the actual found anchor, not abstract requirements.
   */
  anchorSpecs?: Record<string, string>;
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
    anchorSpecs,
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

  if (anchorSpecs && Object.keys(anchorSpecs).length > 0) {
    const anchorLines = Object.entries(anchorSpecs)
      .map(([cat, spec]) => `- **${cat}**: ${spec}`)
      .join("\n");
    sections.push({
      key: "anchor_specs",
      priority: 1,
      content: `## ANCHOR PIECES ALREADY CONFIRMED FOR THIS ROOM\nThese are the top-scored products found during this search session for their categories. Treat them as the real items that will share the room with the product you're scoring.\n${anchorLines}\nFor scale scoring: the product being evaluated must be PROPORTIONAL to these anchors (e.g., a coffee table should be ~⅔ the sofa width; a rug should extend 12-18" beyond the sofa on each side). For material/palette scoring: it must COMPLEMENT these pieces — not match them identically, but harmonize.`,
    });
  }

  // Reserve 8K of 16K budget for scoring instructions + output format + thinking.
  const contextResult = truncateContext(sections, 8000, 0);
  return contextResult.text;
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
