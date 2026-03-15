export function getBundleEvalPrompt(roomType: string): string {
  return `Evaluate this bundle of products as a complete room concept. Score the combination holistically.

## ROOM CONTEXT
- Room type: ${roomType}
- Consider how ALL items work together as a set, not just individually

## SCORING DIMENSIONS (each 0-10)

1. **palette_harmony_score**: Do the colors work together as a cohesive set? Consider the existing grey floors, white walls, dark cabinets, and dark gray KIVIK sofa.

2. **material_balance_score**: Is there a good mix of textures? Wood + textile + leather/stone etc. Not all one material. Not all the same texture.

3. **scale_balance_score**: Are the pieces proportioned well relative to each other? Nothing too dominant, nothing too small.

4. **style_consistency_score**: Is the aesthetic unified? No jarring style mismatches. Everything feels like it belongs in the same room.

5. **room_completion_score**: Does this bundle cover all the needed categories? What's still missing?

6. **practicality_score**: Is this livable? Can you actually use and maintain these items? Does the total budget make sense?

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

A product can score well individually but fail in the bundle context. Focus on how items relate to each other.`;
}
