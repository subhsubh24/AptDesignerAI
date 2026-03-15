export function getProductEvalPrompt(
  roomType: string,
  category: string,
  existingItems: string[],
  budgetMode: string,
  otherRoomsContext?: string
): string {
  return `Evaluate the following product using THREE LAYERS of analysis:

## ROOM CONTEXT
- Room type: ${roomType}
- Product category: ${category}
- Budget mode: ${budgetMode}
- Existing items in room: ${existingItems.length > 0 ? existingItems.join(", ") : "See apartment context in system prompt"}
${otherRoomsContext ? `\n## OTHER ROOMS IN APARTMENT (for cross-room coherence)\n${otherRoomsContext}` : ""}

## LAYER 1: INDIVIDUAL ITEM FIT (8 dimensions, each 0-10)

1. **style_fit_score**: How well does it match modern warm, sophisticated, urban, upscale-without-flashy? Penalize boho, farmhouse, overly industrial, loud trendy.

2. **palette_fit_score**: How well does it fit walnut/oatmeal/taupe/cream/camel/olive/warm neutrals? Penalize bright colors, cool greys, harsh contrast, random multicolor.

3. **material_fit_score**: How well does the material align? Prefer walnut, linen, wool, boucle, leather, matte stone. Penalize cheap glossy or overly synthetic.

4. **scale_fit_score**: Is it correctly scaled for the room and surrounding furniture? Rules:
   - Rugs too small: heavily penalize
   - Coffee tables too small/light: penalize
   - Dining tables too bulky: penalize
   - Art too small: penalize
   - Oversized chairs that overpower: penalize

5. **function_fit_score**: How well does it solve the room's actual need?

6. **cohesion_fit_score**: How well does it work with the dark gray KIVIK sofa, arc lamp, TV stand, dark cabinetry, grey floors, white walls?

7. **value_fit_score**: How strong is the value relative to impact and price? ${budgetMode === "budget" ? "Weight this heavily." : budgetMode === "best_possible" ? "Weight this less — quality over price." : "Balance quality and price."}

8. **confidence_score**: How confident are you based on evidence quality (image quality, metadata, dimensions, product details)?

## LAYER 2: AREA FIT
How does this product work with the other pieces already in or planned for this specific area? Does it enhance the overall area or create conflict?

## LAYER 3: APARTMENT FIT
Does this product work with the overall apartment aesthetic? Would adding this to the ${roomType} make the apartment feel disconnected or more cohesive as a whole?

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
