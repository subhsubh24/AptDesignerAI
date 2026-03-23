import type { DiagnosisData, DesignDirection } from "@/lib/types/database";

export function getProductEvalPrompt(
  roomType: string,
  category: string,
  existingItems: string[],
  budgetMode: string,
  otherRoomsContext?: string,
  priorities?: string[],
  diagnosis?: DiagnosisData,
  designDirection?: DesignDirection
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

  return `You are a world-class interior designer evaluating a specific product for a specific client. Think like a designer who has visited this apartment, studied the photos, knows the building's finishes, and understands how this person lives.

Evaluate the following product using THREE LAYERS of analysis:

## ROOM CONTEXT
- Room type: ${roomType}
- Product category: ${category}
- Budget mode: ${budgetMode}
- Existing items in room: ${existingItems.length > 0 ? existingItems.join(", ") : "See apartment context in system prompt and room photos"}
${prioritiesContext ? `\n${prioritiesContext}` : ""}
${otherRoomsContext ? `\n## OTHER ROOMS IN APARTMENT (for cross-room coherence)\n${otherRoomsContext}` : ""}

## DESIGN DIRECTION (from room diagnosis)
${paletteInfo}
${materialsInfo}
${styleInfo}
${diagnosisContext ? `\n## ROOM DIAGNOSIS — PROBLEMS TO SOLVE\n${diagnosisContext}` : ""}

## LAYER 1: INDIVIDUAL ITEM FIT (8 dimensions, each 0-10)

1. **style_fit_score**: Does it match the design direction above? Score based on the ACTUAL style direction for this apartment — not generic assumptions.

2. **palette_fit_score**: Does it complement the apartment's actual palette? Consider the building finishes (floors, cabinetry, countertops) from the system prompt and the colors visible in the room photos.

3. **material_fit_score**: Does the material work with the apartment's existing finishes? Consider what you SEE in the room photos — the flooring, the cabinetry, any existing furniture materials.

4. **scale_fit_score**: Is it correctly scaled for this specific room? Use the floor plan dimensions from the system prompt. Rules:
   - Rugs too small for the seating area: heavily penalize
   - Coffee tables too small or too large for the sofa arrangement: penalize
   - Dining tables: must seat the right number for the space and the client's needs
   - Art too small for the wall: penalize
   - Oversized pieces in a small room: penalize

5. **function_fit_score**: Does it solve a real problem identified in the room diagnosis? Consider:
   - Seating capacity — does the client need to host guests? Is there enough seating for entertaining?
   - Dining — can they host dinner parties? Is the table big enough?
   - Storage — does it address clutter or organization needs?
   - Lighting — does it solve a lighting gap?
   - Comfort — is it actually comfortable for daily use, not just pretty?
   - Flow — does it work with the room's traffic patterns and layout?

6. **cohesion_fit_score**: Does it work with what's already in the room? Look at the room photos — consider the existing furniture, finishes, and overall vibe. Don't assume what's there; base this on what you SEE.

7. **value_fit_score**: How strong is the value relative to impact and price? ${budgetMode === "budget" ? "Weight this heavily." : budgetMode === "best_possible" ? "Weight this less — quality over price." : "Balance quality and price."}

8. **confidence_score**: How confident are you based on evidence quality (image quality, metadata, dimensions, product details)?

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
    "top_reasons": ["3 strongest reasons it works or fails"],
    "risks": ["specific risks or concerns"],
    "suggestions": ["what would make it better, or alternatives"]
  },
  "area_fit_note": "1-2 sentences on how it works with the rest of this area",
  "apartment_fit_note": "1-2 sentences on apartment-wide coherence"
}

Be honest and specific. Do not inflate scores. A 7+ means it's genuinely strong. A 5 is mediocre. Below 4 means real problems.`;
}
