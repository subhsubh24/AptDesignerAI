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
  /**
   * Short summary of every other top-scored product across the room (all
   * categories, not just anchors). Used to catch cross-category material
   * clashes at scoring time — e.g. if sofa is walnut, side-table candidates
   * in rubberwood should score lower on material_fit than they would in
   * isolation. Each entry is a brief spec string.
   *
   * This is Plan item #7 (harmony context in deep-score) as a thin pass:
   * give the scorer room-wide awareness without waiting for a separate
   * validation call to surface the clash after the fact.
   */
  harmonyNeighbors?: Array<{ category: string; spec: string }>;
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
    harmonyNeighbors,
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

  if (harmonyNeighbors && harmonyNeighbors.length > 0) {
    const neighborLines = harmonyNeighbors
      .slice(0, 10)
      .map((n) => `- **${n.category}**: ${n.spec}`)
      .join("\n");
    sections.push({
      key: "harmony_neighbors",
      priority: 2,
      content: `## ROOM-WIDE HARMONY CONTEXT (other top picks under consideration)
These are the leading candidates from other categories in the same search. The product you're scoring will share the room with these — factor cross-category harmony into material_fit_score and palette_fit_score.
${neighborLines}

**Material harmony rules**:
- 3+ different wood species across the room = penalize material_fit (score ≤5)
- Warm metals (brass, gold, copper) mixed with cool metals (chrome, nickel) across the room = penalize material_fit
- Dominant material family should repeat (e.g. if 2 neighbors are walnut, prefer walnut/warm-wood harmonies over rubberwood/ash)

**Palette harmony rules**:
- Saturated accent color clashing with the neighbors' palette = penalize palette_fit
- Cold undertones against established warm neighbors (or vice versa) = penalize palette_fit`,
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
export function getAestheticEvalPrompt(args: EvalContextArgs & { includeFitNotes?: boolean }): string {
  const assembledContext = buildEvalContext(args);
  const includeFitNotes = args.includeFitNotes ?? false;

  return `<role>
You are a world-class interior designer evaluating a specific product for a specific client's room. This pass focuses exclusively on aesthetic fit — does the product look right in this apartment? A separate pass handles spatial and functional fit; do not score those dimensions here.
</role>

<task>
Score 4 aesthetic dimensions${includeFitNotes ? ", write area and apartment fit notes," : ""} and provide specific reasoning. Every score must be grounded in evidence from the product image, room photos, and design direction above.
</task>

${assembledContext}

<reasoning_process>
For each dimension:
1. What specific evidence (product image + room photos) supports a HIGH score?
2. What specific evidence supports a LOW score?
3. What is the honest score based on the balance of evidence?
Score based on the ACTUAL apartment context — not generic assumptions about the style category.
</reasoning_process>

<scoring_calibration>
Read ALL anchors before scoring. These are concrete examples of what each score level looks like.

style_fit_score:
- 8: Warm modern room (light oak floors, linen sofa, brass accents) + walnut shelf with tapered legs and clean lines → every design tag aligns
- 5: Warm modern room + blonde Scandi shelf — adjacent style, not actively wrong but the warm undertone is missing
- 3: Warm modern room + black industrial pipe shelf with hairpin legs → completely different vocabulary, no shared tags

palette_fit_score:
- 8: Room anchored by warm oak + cream linen + brushed brass; product has warm walnut finish + natural linen seat → shares the warm undertone
- 5: Room with warm oak floors + product has cool gray upholstery → undertones fight at arm's length; coexists but doesn't sing
- 3: Room built on warm neutrals + product is a saturated navy velvet — the accent color has no echo anywhere in the room

material_fit_score:
- 8: High-traffic family living room + performance velvet + metal frame → durability matches use; material family echoes existing pieces
- 5: Low-humidity apartment + linen sofa — linen works in dry climates but not humid ones; slightly risky
- 3: Household with two dogs + white boucle chair → maintenance disaster waiting to happen; material is actively wrong for lifestyle

cohesion_fit_score:
- 8: Every visible room element (floors, existing sofa, lighting) shares the same warm-organic vocabulary as the product being evaluated
- 5: Product works with most of the room but one existing anchor piece (e.g., chrome floor lamp) creates a minor undertone clash
- 3: Product belongs to a different era or aesthetic than the rest of the room — feels like it wandered in from a different apartment

CRITICAL: Use the FULL 0-10 range. Do NOT cluster scores in 6-8. A genuinely mediocre fit is a 5, not a 7.
</scoring_calibration>

<scoring_dimensions>
Score each 0-10 using the calibration above:

1. **style_fit_score**: Does it match the design direction? Reference the ACTUAL style notes from the room diagnosis — name specific style tags and whether this product carries them.

2. **palette_fit_score**: Does it complement the apartment's actual palette? Check undertones (warm/cool/neutral) against building finishes (floors, cabinetry, countertops) and colors visible in room photos. Undertone clashes lower this score even when the hue is close.

3. **material_fit_score**: Does the material work with existing finishes AND the lifestyle?
   - White boucle + pets = 3 regardless of style fit
   - Glass top + toddlers = flag as risk
   - Material must complement existing finishes visible in room photos

4. **cohesion_fit_score**: Does it work with what's ALREADY IN THE ROOM? Look at the room photos — existing furniture, finishes, overall vibe. Base this on what you SEE, not what should theoretically be there.
</scoring_dimensions>

<output_contract>
JSON only. No prose, no markdown fences.

{
  "scores": {
    "style_fit_score": number,
    "palette_fit_score": number,
    "material_fit_score": number,
    "cohesion_fit_score": number
  },
  "reasoning": {
    "top_reasons": ["3-5 strongest reasons — reference actual product attributes and specific room elements"],
    "risks": ["2-4 specific risks — e.g. 'brass legs may clash with chrome kitchen fixtures visible in photo'"],
    "suggestions": ["1-3 actionable alternatives or modifications"]
  }${includeFitNotes ? `,
  "area_fit_note": "2-3 sentences on how this product works with OTHER pieces in the same area — reference specific existing furniture",
  "apartment_fit_note": "1-2 sentences on apartment-wide coherence — does it match building finishes and other rooms?"` : ""}
}
</output_contract>`;
}

/**
 * Functional-pass prompt: 3 spatial/objective dimensions + confidence.
 * No reasoning text — just scores. Paired with getAestheticEvalPrompt.
 */
export function getFunctionalEvalPrompt(args: EvalContextArgs): string {
  const { budgetMode } = args;
  const assembledContext = buildEvalContext(args);

  return `<role>
You are a world-class interior designer evaluating the spatial and functional fit of a specific product. This pass focuses exclusively on: will it fit, will it work, is it good value? A separate pass handles aesthetic fit — do not score style, palette, material, or cohesion here.
</role>

<task>
Score 4 functional dimensions. Every score must be grounded in specific evidence: product dimensions, placement description, floor plan data, and room photos.
</task>

${assembledContext}

<reasoning_process>
For each dimension:
1. What specific evidence (dimensions, placement, floor plan, room photos) supports a HIGH score?
2. What specific evidence supports a LOW score?
3. What is the honest score?
If the room diagnosis lists scale_proportion_issues, CHECK this product's dimensions against them — penalize if it repeats the same problem.
</reasoning_process>

<scoring_calibration>
scale_fit_score:
- 8: 8×10 rug anchors a 7-piece seating group; 18" extension beyond sofa legs on each side; coffee table ≈ ⅔ sofa width — textbook proportions with no clearance issues
- 5: 6×9 rug mostly covers the seating group with sofa legs barely on it — undersized but the room is functional; no clearance violations
- 3: 5×7 rug in a 12×16 living room with an L-shaped sectional — rug is visually lost, wrong by two size classes, reads as an error

function_fit_score:
- 8: Floor lamp placed between sofa and reading chair, within 3 feet of a likely outlet (outlet position known from floor plan); solves the "dark corner" diagnosis issue directly
- 5: Floor lamp goes in a reasonable spot but no outlet confirmed nearby and the diagnosed lighting issue is only partially addressed
- 3: Dining table that seats 4 for a client whose diagnosis noted "needs seating for 6-8 guests" — functional need not met

value_fit_score (budget mode: ${budgetMode}):
${budgetMode === "budget" ? "- 8: Under $300, solid construction, no visible quality compromises\n- 5: $450 for what should be a $200 item — over-tier for this budget\n- 2: $800+ product in a budget search — wrong tier entirely" : budgetMode === "best_possible" ? "- 8: Premium brand, verified quality materials, price justified by craftsmanship\n- 5: Good quality but mid-tier brand without premium justification\n- 3: Mid-tier quality at luxury price — the value equation is off" : "- 8: Quality matches price; no over-pay or under-quality signals\n- 5: Reasonable but not notable value\n- 3: Clearly over-priced or clearly low quality for the ask"}

confidence_score:
- 9-10: title + price + materials + all three dimensions + multiple clear product images + lifestyle photo
- 7-8: mostly complete, missing one field (e.g., depth only)
- 5-6: title and maybe price, but materials/dimensions unclear or absent
- 3-4: only title and retailer name — no specs
- 1-2: almost no reliable data; product identity uncertain
</scoring_calibration>

<scoring_dimensions>
Score each 0-10 using the calibration above:

1. **scale_fit_score**: Will it physically fit and be correctly proportioned?
   - Check dimensions against available space and intended placement
   - Rugs too small for seating area: heavily penalize
   - Dining tables must seat the required count AND leave 24" chair pullback
   - Art too small for the wall: penalize. Pieces that block walkways: penalize.
   - Window/door clearance: would this obstruct a door swing or crowd a doorway?
   - If no dimensions listed, score 5 (neutral)

2. **function_fit_score**: Does it solve a real problem AND work in its intended position?
   - Seating capacity; dining capacity; storage; task lighting placement
   - Traffic flow: does it work with the room's spatial layout?
   - Acoustic impact: in all-hard-surface rooms, more hard surfaces = penalize
   - Outlet proximity: lamps, powered items — is there a likely outlet nearby?

3. **value_fit_score**: Price vs. quality/impact. ${budgetMode === "budget" ? "Weight HEAVILY. Over-tier products → score 3 or below." : budgetMode === "best_possible" ? "Weight less — quality over price." : "Balance quality and price."}
   - If price is missing, score 5 (neutral) — do NOT assume good value

4. **confidence_score**: How reliable is the product data? (see calibration above)
</scoring_dimensions>

<output_contract>
JSON only. No prose, no markdown fences.

{
  "scores": {
    "scale_fit_score": number,
    "function_fit_score": number,
    "value_fit_score": number,
    "confidence_score": number
  }
}
</output_contract>`;
}

/**
 * Combined single-pass prompt: all 8 dimensions in one call.
 * Replaces the two parallel calls (aesthetic + functional) — saves one LLM
 * call per product scored (~120 calls / run on a 5-category × 3-tier config).
 */
export function getCombinedEvalPrompt(args: EvalContextArgs & { includeFitNotes?: boolean }): string {
  const { budgetMode } = args;
  const assembledContext = buildEvalContext(args);
  const includeFitNotes = args.includeFitNotes ?? false;

  return `<role>
You are a world-class interior designer evaluating a specific product for a client's room. Score all 8 fit dimensions: 4 aesthetic (style/palette/material/cohesion) and 4 functional (scale/function/value/confidence). Provide detailed reasoning for the aesthetic dimensions.
</role>

<task>
Score 8 dimensions${includeFitNotes ? ", write area and apartment fit notes," : ""} and provide specific reasoning for aesthetic dimensions. Every score must be grounded in evidence from the product image, room photos, and design context.
</task>

${assembledContext}

<reasoning_process>
For each aesthetic dimension:
1. What specific evidence (product image + room photos) supports a HIGH score?
2. What specific evidence supports a LOW score?
3. What is the honest score based on the balance of evidence?

For each functional dimension:
1. What dimensions/specs support a HIGH scale/function score?
2. What gaps in data lower the confidence score?
3. Does the price match the quality signals visible in photos?
</reasoning_process>

<scoring_calibration>
Read ALL anchors before scoring. Use the FULL 0-10 range.

**AESTHETIC DIMENSIONS:**

style_fit_score:
- 8: Warm modern room + walnut shelf with tapered legs → every design tag aligns
- 5: Warm modern room + blonde Scandi shelf — adjacent style, not wrong but warm undertone missing
- 3: Warm modern room + black industrial pipe shelf → completely different vocabulary

palette_fit_score:
- 8: Room with warm oak + cream linen + brushed brass; product has warm walnut + natural linen → shares warm undertone
- 5: Room with warm oak floors + product has cool gray upholstery → undertones fight
- 3: Room built on warm neutrals + product is saturated navy velvet — no echo anywhere

material_fit_score:
- 8: High-traffic family room + performance velvet + metal frame → durability matches use
- 5: Low-humidity apartment + linen sofa — linen works in dry climates, slightly risky
- 3: Household with two dogs + white boucle chair → maintenance disaster

cohesion_fit_score:
- 8: Every visible room element shares the same warm-organic vocabulary as this product
- 5: Product works with most of the room but one anchor piece creates a minor clash
- 3: Product belongs to a different era than the rest of the room

**FUNCTIONAL DIMENSIONS:**

scale_fit_score:
- 8: 8×10 rug anchors a 7-piece seating group; 18" extension beyond sofa; coffee table ≈ ⅔ sofa width
- 5: 6×9 rug mostly covers seating group — undersized but functional
- 3: 5×7 rug in 12×16 living room with L-sectional — wrong by two size classes

function_fit_score:
- 8: Floor lamp between sofa + chair, within 3' of outlet, solves "dark corner" diagnosis directly
- 5: Lamp goes in reasonable spot but outlet not confirmed and issue only partially addressed
- 3: Dining table for 4 when diagnosis noted "needs seating for 6-8"

value_fit_score (budget mode: ${budgetMode}):
${budgetMode === "budget" ? "- 8: Under $300, solid construction\n- 5: $450 for what should be $200 — over-tier\n- 2: $800+ in a budget search — wrong tier" : budgetMode === "best_possible" ? "- 8: Premium brand, quality justified by craftsmanship\n- 5: Good quality but mid-tier without premium justification\n- 3: Mid-tier quality at luxury price" : "- 8: Quality matches price cleanly\n- 5: Reasonable but not notable value\n- 3: Clearly over-priced or clearly low quality"}

confidence_score:
- 9-10: title + price + materials + all dimensions + multiple clear images + lifestyle photo
- 7-8: mostly complete, missing one field
- 5-6: title + maybe price, but materials/dimensions unclear
- 3-4: only title and retailer — no specs
- 1-2: almost no reliable data

CRITICAL: Use the FULL 0-10 range. Do NOT cluster scores in 6-8.

**BAND DISCIPLINE — enforce this before writing any score:**
- Reserve **9-10** for exceptional matches that check EVERY anchor above — specific evidence on all three bullets for that dimension. If a dimension has even ONE weakness, it cannot score 9+.
- **7-8** is strong-but-not-perfect: matches most anchors, has a minor qualifier.
- **5-6** is the default band for "works but is unremarkable" — this is where the average product lands. If nothing specific jumps out as outstanding, score 5-6, NOT 7.
- **3-4** is "noticeably off" — one anchor clearly fails.
- **0-2** is "wrong" — fundamental mismatch.

Self-check before finalizing each score: Can you name *three specific pieces of evidence* supporting a 9? If not, the score is NOT a 9. A "nice modern shelf in a modern room" is a 6, not an 8. Do not inflate because the product is competently photographed or reasonably styled.

Anti-pattern to avoid: giving 8/9 across all dimensions to "safe" products. If every score is 8+ the distribution is wrong — real products have specific strengths and specific weaknesses.
</scoring_calibration>

<scoring_dimensions>
**AESTHETIC (vision + taste):**

1. **style_fit_score**: Does it match the design direction? Reference ACTUAL style notes — name specific style tags this product carries or lacks.

2. **palette_fit_score**: Does it complement the apartment's actual palette? Check undertones (warm/cool/neutral) against building finishes visible in room photos.

3. **material_fit_score**: Does the material work with existing finishes AND the lifestyle?
   - White boucle + pets = 3 regardless of style fit
   - Material must complement existing finishes visible in room photos

4. **cohesion_fit_score**: Does it work with what's ALREADY IN THE ROOM? Base this on what you SEE in photos, not what should theoretically be there.

**FUNCTIONAL (objective):**

5. **scale_fit_score**: Will it physically fit and be correctly proportioned?
   - Check dimensions against available space and intended placement
   - Rugs too small for seating area: heavily penalize
   - If no dimensions listed, score 5 (neutral)

6. **function_fit_score**: Does it solve a real problem AND work in its intended position?
   - Seating/dining capacity; storage; task lighting placement; traffic flow
   - Outlet proximity: lamps, powered items — is there a likely outlet nearby?

7. **value_fit_score**: Price vs. quality/impact. ${budgetMode === "budget" ? "Weight HEAVILY. Over-tier products → score 3 or below." : budgetMode === "best_possible" ? "Weight less — quality over price." : "Balance quality and price."}
   - If price is missing, score 5 (neutral) — do NOT assume good value

8. **confidence_score**: How reliable is the product data? (see calibration above)
</scoring_dimensions>

<output_contract>
JSON only. No prose, no markdown fences.

{
  "scores": {
    "style_fit_score": number,
    "palette_fit_score": number,
    "material_fit_score": number,
    "cohesion_fit_score": number,
    "scale_fit_score": number,
    "function_fit_score": number,
    "value_fit_score": number,
    "confidence_score": number
  },
  "reasoning": {
    "top_reasons": ["3-5 strongest reasons — reference actual product attributes and specific room elements"],
    "risks": ["2-4 specific risks — e.g. 'brass legs may clash with chrome kitchen fixtures visible in photo'"],
    "suggestions": ["1-3 actionable alternatives or modifications"]
  }${includeFitNotes ? `,
  "area_fit_note": "2-3 sentences on how this product works with OTHER pieces in the same area — reference specific existing furniture",
  "apartment_fit_note": "1-2 sentences on apartment-wide coherence — does it match building finishes and other rooms?"` : ""}
}
</output_contract>`;
}
