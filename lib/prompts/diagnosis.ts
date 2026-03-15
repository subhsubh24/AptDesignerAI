import { USER_DESIGN_PROFILE } from "@/lib/design-context/user-profile";

export function getDiagnosisPrompt(roomType: string, keepItems: string[], replaceItems: string[], priorities: string[]): string {
  const roomPriorities = USER_DESIGN_PROFILE.room_priorities[roomType as keyof typeof USER_DESIGN_PROFILE.room_priorities];

  return `Analyze the room photos provided and produce a comprehensive room diagnosis.

## ROOM CONTEXT
- Room type: ${roomType}
- Items to keep: ${keepItems.length > 0 ? keepItems.join(", ") : "none specified"}
- Items to replace: ${replaceItems.length > 0 ? replaceItems.join(", ") : "none specified"}
- User priorities: ${priorities.length > 0 ? priorities.join(", ") : "not specified"}
${roomPriorities ? `- Room-specific goals: ${roomPriorities.goals.join(", ")}` : ""}
${roomPriorities ? `- Likely needs: ${roomPriorities.likely_needs.join(", ")}` : ""}

## INSTRUCTIONS
Examine the room photos carefully. Consider:
1. The architectural context (floors, walls, windows, ceiling, lighting)
2. Existing furniture and how it relates to the space
3. What's working and what isn't
4. Scale and proportion of current items
5. Color balance and temperature
6. Texture and material variety
7. Layout and traffic flow
8. Lighting (natural and artificial)
9. What's missing for a complete, intentional room

## OUTPUT FORMAT
Return a JSON object with this exact structure:
{
  "diagnosis": {
    "current_vibe_summary": "string - 2-3 sentences describing the current feel of the room",
    "what_is_working": ["array of specific things that work well, with reasoning"],
    "what_is_not_working": ["array of specific issues, with reasoning"],
    "biggest_improvement_opportunities": ["top 3-5 highest-impact changes"],
    "missing_furniture_categories": ["e.g. rug, coffee_table, accent_chair, art, plant"],
    "color_issues": ["specific color/palette observations and issues"],
    "texture_material_issues": ["texture/material gaps or conflicts"],
    "scale_proportion_issues": ["anything that feels too small, too large, or wrong"],
    "layout_issues": ["traffic flow, furniture arrangement, zoning issues"],
    "lighting_issues": ["natural light, artificial light, evening ambience needs"],
    "clutter_editing_issues": ["things that should be removed or edited"]
  },
  "design_direction": {
    "recommended_palette": ["list of recommended colors/tones for this room"],
    "recommended_materials": ["materials that would work well"],
    "recommended_textures": ["textures to introduce"],
    "recommended_furniture_types": ["specific furniture types needed with notes"],
    "style_notes": "string - overall style direction for this room"
  },
  "missing_categories": ["rug", "coffee_table", etc.],
  "action_list": [
    {
      "priority": 1,
      "action": "specific action to take",
      "category": "furniture category",
      "reasoning": "why this matters"
    }
  ]
}

Be specific and opinionated. This is not a generic analysis — it is tailored to this specific person and apartment.`;
}
