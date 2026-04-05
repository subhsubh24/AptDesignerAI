import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { geminiProvider } from "@/lib/ai/gemini";
import { selectModel } from "@/lib/ai/models";

/**
 * Attempt to repair truncated or malformed JSON by closing unclosed braces/brackets.
 */
function repairAndParseJSON(raw: string): Record<string, unknown> {
  let json = raw.trim();
  // Remove trailing commas before } or ]
  json = json.replace(/,\s*([}\]])/g, "$1");

  // Track structure to close properly
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  let lastNonWS = "";

  for (const ch of json) {
    if (escaped) { escaped = false; continue; }
    if (ch === "\\") { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") stack.push("}");
    else if (ch === "[") stack.push("]");
    else if (ch === "}" || ch === "]") stack.pop();
    if (ch.trim()) lastNonWS = ch;
  }

  // Close unclosed string
  if (inString) json += '"';

  // Remove trailing incomplete value (e.g., `"key": ` or `"key": "truncated`)
  // by removing the last key-value if it ends with : or : "...
  if (lastNonWS === ":" || lastNonWS === ",") {
    // Try to remove incomplete key-value pair first
    const repaired = json.replace(/,?\s*"[^"]*"\s*:\s*"?[^"]*"?\s*$/, "");
    if (repaired !== json) {
      json = repaired;
    } else {
      // Just a trailing comma — strip it
      json = json.replace(/,\s*$/, "");
    }
  }

  // Close unclosed structures in reverse order
  while (stack.length > 0) {
    json += stack.pop();
  }

  try {
    return JSON.parse(json);
  } catch (e) {
    console.error("[apartment-research] JSON repair failed:", (e as Error).message, "\nTruncated input:", raw.slice(0, 300));
    throw new Error("Could not parse building research response after repair attempt");
  }
}

/**
 * Research an apartment building using Gemini Google Search + URL Context.
 * Gemini 3 models support combining these tools with structured JSON output.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { building_name, building_url, city, state, neighborhood, project_id, bedrooms, bathrooms, building_place_id } = await request.json();

  if (!building_name && !building_url) {
    return NextResponse.json({ error: "building_name or building_url required" }, { status: 400 });
  }

  const searchContext = [
    building_name,
    city,
    state,
    neighborhood,
    "apartments",
  ].filter(Boolean).join(" ");

  // Build unit type filter for floor plan search
  const unitBed = bedrooms ?? 1;
  const unitBath = bathrooms ?? 1;
  const unitLabel = `${unitBed} bedroom ${unitBath} bathroom`;

  const jsonSchema = `{
  "building_style": "description of architectural and interior style",
  "finishes": {
    "flooring": "type and color",
    "countertops": "material and color",
    "cabinetry": "style and color",
    "appliances": "brand/tier",
    "fixtures": "style"
  },
  "features": ["list of notable features"],
  "windows": "description of window style and size",
  "ceiling_height": "estimated height or null if not found",
  "layout_style": "open concept, traditional, etc.",
  "floor_plan": {
    "found": true or false,
    "source": "where you found floor plan info — include the exact URL(s) you visited",
    "unit_type_searched": "${unitLabel}",
    "total_sqft": "square footage for the ${unitLabel} unit, or range if multiple options — DO NOT GUESS",
    "unit_variants": [
      {
        "name": "unit/plan name (e.g. 'A1', 'The Loop', 'Plan B')",
        "sqft": "square footage for this specific variant",
        "floor_plan_image_url": "direct URL to the floor plan image if one exists, or null",
        "room_layout": "description of how rooms connect based on the floor plan image or diagram",
        "living_dining_combined": true/false/null,
        "kitchen_style": "open to living, galley, U-shaped, etc.",
        "room_dimensions": {
          "living_room": "dimensions ONLY if explicitly stated (e.g. '15x20 ft'), otherwise null",
          "bedroom": "dimensions ONLY if explicitly stated, otherwise null",
          "kitchen": "dimensions ONLY if explicitly stated, otherwise null"
        },
        "notable_spatial_features": ["features visible in the floor plan — e.g. 'L-shaped layout', 'walk-in closet', 'balcony off living room', 'en-suite bathroom'"]
      }
    ],
    "room_layout": "summary of most common layout for ${unitLabel} units, or null",
    "living_dining_combined": true/false/null,
    "kitchen_style": "most common kitchen style for ${unitLabel} units",
    "room_dimensions": {
      "living_room": "dimensions if found for any ${unitLabel} variant, otherwise null",
      "bedroom": "dimensions if found, otherwise null",
      "kitchen": "dimensions if found, otherwise null"
    },
    "notable_spatial_features": ["combined list of features across ${unitLabel} variants"]
  },
  "amenities": ["relevant amenities"],
  "neighborhood_vibe": "description of neighborhood character",
  "design_aesthetic": "the overall aesthetic the building conveys",
  "website_url": "URL of the building website if found",
  "confidence_notes": ["List what you could NOT find or verify"],
  "summary": "2-3 sentence summary useful for a designer. Be explicit about what is based on the website vs what is inferred."
}`;

  const honesty = `
CRITICAL RULES:
- ONLY include information you can actually find on the website or in search results.
- If you cannot find floor plans, room dimensions, or square footage, set those fields to null and mark floor_plan.found as false.
- NEVER invent or estimate room dimensions — only include them if explicitly stated on the website.
- Use confidence_notes to list what you couldn't find. This is important for user trust.
- If the website doesn't have certain finishes info, say "not specified" rather than guessing.`;

  const floorPlanInstructions = `
## FLOOR PLAN DEEP CRAWL — THIS IS CRITICAL
The user has a ${unitLabel} apartment. You MUST follow this process to find floor plans:

1. **Find the floor plans page**: Most apartment websites have a "Floor Plans" link in the navigation, or a page at /floor-plans, /floorplans, or /apartments. Navigate to it.

2. **Filter by unit type**: On the floor plans page, look for filters or tabs for "${unitBed} Bed" / "${unitBed} BR" / "${unitBed} Bedroom". Select/filter for ${unitLabel} units specifically.

3. **Click through EVERY unit variant**: Buildings typically have multiple floor plan options for the same bed/bath count (e.g. "A1", "A2", "B1", or named plans like "The Loop", "The Park"). Visit EACH individual floor plan option to see:
   - The floor plan image/diagram
   - Square footage for that specific unit
   - Room dimensions if listed
   - Layout details (combined living/dining, kitchen style, etc.)

4. **Extract floor plan image URLs**: If the website shows floor plan diagrams/images, capture the direct image URL. This is extremely valuable — look for <img> tags or image links on the floor plan detail pages.

5. **Record every variant**: In unit_variants, create an entry for each distinct ${unitLabel} floor plan you find, with its specific details.

6. **If the building website doesn't have a floor plans page**, try:
   - Searching "${building_name || searchContext} floor plans" on Google
   - Looking at apartment listing sites (apartments.com, zillow, etc.) for floor plan images
   - Checking if the building has virtual tours that show the layout

7. **If the website has no floor plans at all**, set floor_plan.found to false and note it in confidence_notes.`;

  const prompt = building_url
    ? `Read and analyze this apartment building's website: ${building_url}

Also search online for additional details about "${searchContext}".

The user lives in a **${unitLabel}** apartment in this building.

Extract everything useful for an interior designer advising a resident:
- Building style and architecture (modern, historic, industrial, etc.)
- Standard finishes and fixtures (flooring, countertops, cabinetry, appliances)
- Apartment features (windows, ceiling height, layout style)
- Building amenities that affect lifestyle
- Neighborhood vibe and character
- Any design aesthetic the building promotes
${floorPlanInstructions}
${honesty}

Return JSON:
${jsonSchema}`
    : `Search for "${searchContext}" and find the official apartment building website. Read the website and extract information useful for an interior designer advising a resident.

The user lives in a **${unitLabel}** apartment in this building.

Extract:
- Building style and architecture
- Standard finishes (flooring, countertops, cabinetry)
- Apartment features (windows, ceiling height, layout)
- Building amenities
- Neighborhood character
- Design aesthetic
${floorPlanInstructions}
${honesty}

Return JSON:
${jsonSchema}`;

  try {
    const response = await geminiProvider.chat({
      model: selectModel("apartment_research"),
      system: `You are an expert interior designer researching an apartment building to advise a new resident on furniture and decor. Extract every detail that would help with design recommendations.

PROCESS:
1. Visit the building's website and read ALL relevant pages (amenities, gallery, floor plans, finishes).
2. For floor plans: navigate to the floor plans page, filter for ${unitLabel}, click through EACH layout variant. Most buildings have multiple layouts per bed/bath count.
3. Capture floor plan image URLs when available.
4. Note all finishes: flooring material+color, countertop material, cabinetry style+color, appliance brand, fixtures finish.
5. Return ONLY facts you found on the website or via search. Never guess finishes or features.`,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 8000,
      temperature: 0.2,
      tools: [{ googleSearch: {} }, { urlContext: {} }, { googleMaps: {} }],
      // Note: responseMimeType is incompatible with built-in tools (googleSearch, urlContext)
    });

    // Gemini 3 models support structured output + built-in tools,
    // but keep fallback parsing for edge cases (transient empty responses, etc.)
    let research: Record<string, unknown>;
    const raw = response.content.trim();
    if (!raw) {
      throw new Error("Building research returned empty response — please try again");
    }
    try {
      research = JSON.parse(raw);
    } catch {
      // Fallback: extract JSON from markdown code blocks or raw braces
      const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        try {
          research = JSON.parse(jsonMatch[1].trim());
        } catch {
          research = repairAndParseJSON(jsonMatch[1].trim());
        }
      } else {
        const braceStart = raw.indexOf("{");
        const braceEnd = raw.lastIndexOf("}");
        if (braceStart !== -1 && braceEnd > braceStart) {
          try {
            research = JSON.parse(raw.slice(braceStart, braceEnd + 1));
          } catch {
            research = repairAndParseJSON(raw.slice(braceStart));
          }
        } else if (braceStart !== -1) {
          // Truncated — only opening brace found, try to repair
          research = repairAndParseJSON(raw.slice(braceStart));
        } else {
          console.error("[apartment-research] Unparseable response:", raw.slice(0, 500));
          throw new Error("Could not parse building research response");
        }
      }
    }

    // Save to project if project_id provided
    if (project_id) {
      await supabase
        .from("projects")
        .update({
          building_research: research,
          building_name: building_name || research.building_name,
          building_url: building_url || research.website_url,
          city,
          state,
          neighborhood,
          ...(building_place_id ? { building_place_id } : {}),
        })
        .eq("id", project_id);
    }

    return NextResponse.json({ research });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Research failed";
    console.error("[apartment-research]", error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
