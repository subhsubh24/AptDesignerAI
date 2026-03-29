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
  outletPositions?: string
): string {
  // Build dynamic design direction from diagnosis
  const paletteInfo = designDirection?.recommended_palette?.length
    ? `Target palette: ${designDirection.recommended_palette.join(", ")}`
    : "Infer the appropriate palette from the room photos and apartment context in the system prompt.";

  const materialsInfo = designDirection?.recommended_materials?.length
    ? `Target materials: ${designDirection.recommended_materials.join(", ")}`
    : "Infer appropriate materials from room photos and building finishes.";

  const styleInfo = designDirection?.style_notes
    ? `Style direction: ${designDirection.style_notes}`
    : "Infer the style direction from room photos and apartment context.";

  // Build diagnosis context
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

  return `You are evaluating a specific product for a specific client's room. Think step-by-step through each scoring dimension.

## ROOM CONTEXT
- Room type: ${roomType}
- Product category: ${category}
- Budget mode: ${budgetMode}
- Existing items in room: ${existingItems.length > 0 ? existingItems.join(", ") : "See apartment context in system prompt and room photos"}${placementContext}
${prioritiesContext ? `\n${prioritiesContext}` : ""}
${otherRoomsContext ? `\n## OTHER ROOMS IN APARTMENT (for cross-room coherence)\n${otherRoomsContext}` : ""}

## DESIGN DIRECTION (from room diagnosis)
${paletteInfo}
${materialsInfo}
${styleInfo}
${diagnosisContext ? `\n## ROOM DIAGNOSIS — PROBLEMS TO SOLVE\n${diagnosisContext}` : ""}${spatialContext}${floorPlanContext}${environmentContext}

## SCORING PROCESS — Follow these steps for EACH dimension:

For each score, think through:
1. What specific evidence supports a high score?
2. What specific evidence supports a low score?
3. Based on the balance of evidence, what score is fair?

### Dimension 1: style_fit_score (0-10)
Does the product's style match the design direction?
- Compare the product's visual style tags and appearance to the style direction above.
- Example: If direction is "warm modern" and product is "industrial chrome wire shelf" → score 2-3 (wrong style family)
- Example: If direction is "warm modern" and product is "walnut shelf with clean lines" → score 8-9 (perfect match)

### Dimension 2: palette_fit_score (0-10)
Does the product's color complement the room's palette?
- List the product's colors. List the target palette colors. Do they coordinate?
- Check against building finishes (floors, cabinetry, countertops from system prompt)
- Example: Product is "warm oak" in a room with cool gray floors and chrome fixtures → score 4-5 (undertone clash)
- Example: Product is "warm walnut" in a room with warm oak floors and brass fixtures → score 8-9 (harmonious warm palette)

### Dimension 3: material_fit_score (0-10)
Does the material work with existing finishes? Is it practical?
- Does it add texture variety or create monotony?
- **Durability/maintenance**: Is the material practical for daily use? White boucle with pets = score 3. Performance fabric with pets = score 9. Delicate silk in high-traffic area = score 3.
- **Climate suitability**: Heavy wool in tropical climates feels wrong. Cold metal without textile warmth nearby = harsh.

### Dimension 4: scale_fit_score (0-10)
Will it physically fit and look proportional?
- Compare product dimensions to room dimensions / available space
- Rug rules: Must cover at least 60-80% of seating area. A 5x7 under an L-shaped sectional = score 2.
- Coffee table: Should be ⅔ to full width of sofa, height at or below sofa seat height.
- Dining table: Must seat enough people + 24" pullback clearance per chair.
- If dimensions unknown, score 5 (neutral) and note low confidence.
- **Window/door clearance**: Does it block windows (reducing light), obstruct door swings, or crowd doorways?

### Dimension 5: function_fit_score (0-10)
Does it solve a real problem?
- Check against the diagnosis above — does it address a specific identified issue?
- Does it serve the client's lifestyle (hosting needs, daily routines, comfort)?
- **Lighting suitability**: For lamps, does it address a known lighting gap? For glossy/reflective surfaces, will they create glare near windows?
- **Acoustic impact**: In rooms with all hard surfaces (hardwood + glass + concrete), textiles are critical. Adding more hard surfaces to an acoustically harsh room = penalize.
- **Outlet proximity**: For lamps, media consoles, powered items — is there an outlet near the intended placement?
- For seating: Does it add needed capacity for hosting?
- For storage: Does it solve a clutter problem?

### Dimension 6: cohesion_fit_score (0-10)
Does it work with what's ALREADY in the room?
- Look at room photos. What furniture, finishes, and decor are already there?
- Would this product look intentional next to the existing pieces, or random?

### Dimension 7: value_fit_score (0-10)
Is the price reasonable for the quality and impact?
${budgetMode === "budget" ? "- Weight this heavily. Products over the tier's price range = score 3 or below." : budgetMode === "best_possible" ? "- Weight this less — quality over price. Score based on materials and craftsmanship vs. cost." : "- Balance quality and price. Premium materials at fair prices score highest."}
- If price is missing, score 5 (neutral).

### Dimension 8: confidence_score (0-10)
How complete is the product data?
- 9-10: Have price, exact dimensions, materials list, clear images, lifestyle photo
- 7-8: Most data present, missing one element (e.g., no lifestyle image)
- 5-6: Partial data — have price and title but unclear dimensions or materials
- 3-4: Minimal data — substantial guessing required
- 1-2: Almost no reliable data

## SCORE CALIBRATION — Use these as reference points:
- **9-10 (Exceptional)**: Product solves specific diagnosed problems, perfect scale, materials and palette match the direction exactly. Example: A walnut coffee table with tapered legs for a mid-century room that already has a walnut media console and warm rug.
- **7-8 (Strong)**: Genuinely good fit with minor concerns. Example: A linen accent chair in a warm tone that mostly works but the exact shade might not be ideal.
- **5-6 (Mediocre)**: Safe but doesn't solve problems well. Example: A generic gray ottoman for a room that needs warmth and texture — it doesn't clash but doesn't help.
- **3-4 (Poor)**: Actively conflicts. Example: A glossy white lacquer table in a room with warm wood tones and matte finishes.
- **1-2 (Wrong)**: Completely wrong style/scale. Example: A farmhouse distressed table in a sleek modern apartment.

IMPORTANT: Do NOT cluster all scores in 6-8. If something is mediocre, score it 5. If it has problems, score it 3-4.

## OUTPUT FORMAT — Return this exact JSON:
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
    "top_reasons": ["3-5 strongest reasons it works or fails — name specific product attributes and specific room elements they relate to"],
    "risks": ["2-4 specific risks — e.g. 'rug is 5x7 but seating area needs at least 8x10', 'brass legs may clash with chrome kitchen fixtures'"],
    "suggestions": ["1-3 alternatives — e.g. 'the 8x10 version would be better', 'consider walnut finish instead of oak'"]
  },
  "area_fit_note": "2-3 sentences: how it works with other pieces in this area of the room. Name specific existing furniture.",
  "apartment_fit_note": "1-2 sentences: does it match the building's finishes and other rooms?"
}

## FINAL CHECKLIST before returning:
- Did I check product dimensions against room dimensions?
- Did I compare product colors to the recommended palette?
- Did I compare product materials to the recommended materials?
- Did I consider how the client lives (hosting, daily use, comfort)?
- Did I check durability/maintenance for the material given the room's use patterns?
- Did I check if this blocks windows/doors?
- Did I verify outlet access for powered items (lamps, media consoles)?
- Did I consider acoustic impact (more hard surfaces in an already hard room)?
- Am I using the full 0-10 scale, not clustering in 6-8?
- Does every entry in reasoning reference a SPECIFIC product attribute and room element?`;
}
