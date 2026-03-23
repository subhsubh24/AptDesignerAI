import type { DiagnosisData, DesignDirection } from "@/lib/types/database";

export function getBundleEvalPrompt(
  roomType: string,
  priorities?: string[],
  diagnosis?: DiagnosisData,
  designDirection?: DesignDirection
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
${directionContext ? `\n## DESIGN DIRECTION\n${directionContext}` : ""}

## SCORING DIMENSIONS (each 0-10)

1. **palette_harmony_score**: Do the colors work together as a cohesive set? Consider the ACTUAL apartment finishes visible in the photos — floors, walls, cabinetry, existing furniture. Don't assume generic finishes.

2. **material_balance_score**: Is there a good mix of textures? Wood + textile + leather/stone etc. Not all one material. Not all the same texture. Consider what materials are already present in the apartment's finishes.

3. **scale_balance_score**: Are the pieces proportioned well relative to each other AND to the room? Use the floor plan dimensions. Nothing too dominant, nothing too small for the space.

4. **style_consistency_score**: Is the aesthetic unified? No jarring style mismatches. Everything feels like it belongs in the same apartment. Cross-reference with the design direction.

5. **room_completion_score**: Does this bundle cover all the needed categories? What's still missing? Does it solve the problems identified in the diagnosis?

6. **practicality_score**: Is this livable? Think about how the client actually uses this room:
   - Can they host guests comfortably? Is there enough seating?
   - Can they eat meals with friends? Is the dining situation adequate?
   - Can they move through the room easily? Is there good traffic flow?
   - Are the pieces durable enough for daily life?
   - Does the total budget make sense for the tier?

## OUTPUT FORMAT
Return a JSON object:
{
  "scores": {
    "palette_harmony_score": number,
    "material_balance_score": number,
    "scale_balance_score": number,
    "style_consistency_score": number,
    "room_completion_score": number,
    "practicality_score": number
  },
  "analysis": {
    "strongest_aspect": "what works best about this combination",
    "weakest_aspect": "the biggest weakness of this bundle",
    "what_feels_missing": "what category or element is still needed",
    "what_should_be_swapped_first": "which item should be replaced first and why"
  },
  "verdict": "string summarizing the overall quality of this bundle"
}

A product can score well individually but fail in the bundle context. Focus on how items relate to each other AND to the room they're going into.`;
}
