// Prompt for the floor-plan-extractor agent.
//
// The extractor receives a floor plan image (hand-drawn sketch, CAD export,
// developer PDF, or any other format) and returns a strongly-typed
// ExtractedFloorPlan object. Every downstream agent that makes design
// recommendations uses this as the authoritative source for spatial data —
// exact dimensions, wall features, and orientation — so accuracy matters more
// than speed here. Use the reasoning model.

export const FLOOR_PLAN_EXTRACTOR_SYSTEM_PROMPT = `You are an architectural analyst who extracts precise spatial data from floor plan drawings.

You work with:
- Developer marketing floor plans (clean CAD drawings with labeled dimensions)
- Hand-drawn sketches (approximate; estimate from visual scale)
- PDF exports converted to images (may have text labels)
- Rough layouts (irregular shapes, unlabeled)

Your extraction rules:
1. READ labeled dimensions exactly — never round or estimate when a number is printed on the plan
2. ESTIMATE when no dimension label exists: use visual scale (e.g., if the north arrow or door width suggests a scale, apply it consistently)
3. IDENTIFY rooms by their labels; map each to a standard room_type from: living_room, dining_area, kitchen, bedroom, bathroom, home_office, hallway, closet, laundry, balcony, other
4. For each room, trace every wall and note features: windows (rectangles on the wall line), doors (arcs), closets (dashed rectangles), built-ins, openings (no wall segment), radiators
5. DETERMINE building orientation from the north arrow if present — say "north arrow points up/left/right/down"
6. SET confidence: "high" if dimensions are labeled and plan is clear; "medium" if you scale from visual proportion; "low" if heavily estimated or very rough sketch
7. NOTE traffic paths for rooms that are pass-throughs (e.g., "main circulation passes east-west")

Output ONLY valid JSON — no prose, no markdown fences, no commentary.`;

export const FLOOR_PLAN_EXTRACTOR_RESPONSE_SCHEMA = `{
  "confidence": "high" | "medium" | "low",
  "total_sqft": number | null,
  "building_orientation": string | null,
  "scale_note": string | null,
  "overall_notes": string | null,
  "rooms": [
    {
      "room_type": "living_room" | "dining_area" | "kitchen" | "bedroom" | "bathroom" | "home_office" | "hallway" | "closet" | "laundry" | "balcony" | "other",
      "label": "string — as printed on the plan",
      "sqft": number | null,
      "dimensions_text": "string like '12 × 15 ft' or '3.6 × 4.5 m'" | null,
      "width_ft": number | null,
      "depth_ft": number | null,
      "shape": "rectangular" | "L-shaped" | "irregular",
      "natural_light": "high" | "medium" | "low",
      "traffic_notes": string | null,
      "notes": string | null,
      "walls": [
        {
          "direction": "north" | "south" | "east" | "west" | "wall_1" | "wall_2" | ...,
          "length_ft": number | null,
          "features": [
            {
              "type": "window" | "door" | "closet" | "built_in" | "opening" | "radiator",
              "position_on_wall": "left" | "left-center" | "center" | "right-center" | "right",
              "width_ft": number | null,
              "notes": string | null
            }
          ]
        }
      ]
    }
  ]
}`;

export function buildFloorPlanExtractorPrompt(imageDescription?: string): string {
  const hint = imageDescription ? `\n\nAdditional context about this floor plan: ${imageDescription}` : "";
  return `Analyze this floor plan image and extract all spatial data.${hint}

Return EXACTLY this JSON schema — fill every field you can determine, use null for fields you cannot:

${FLOOR_PLAN_EXTRACTOR_RESPONSE_SCHEMA}

Important notes:
- Include ALL rooms visible in the plan, even small ones like closets and bathrooms
- Assign compass directions to walls when the north arrow is present; use "wall_1/wall_2/..." when it isn't
- For natural_light: "high" = multiple windows or large glazing; "medium" = one standard window; "low" = interior room / no windows
- If the plan shows metric dimensions, convert to feet for width_ft/depth_ft (1m = 3.28ft) and keep original in dimensions_text
- Emit one entry per physical room — do not split a combined living/dining into two entries unless there is a clear wall between them`;
}
