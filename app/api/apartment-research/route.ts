import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { geminiProvider } from "@/lib/ai/gemini";
import { selectModel } from "@/lib/ai/models";

/**
 * Research an apartment building using Gemini Google Search + URL Context.
 * Gemini 3 models support combining these tools with structured JSON output.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { building_name, building_url, city, state, neighborhood, project_id } = await request.json();

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
    "source": "where you found floor plan info (e.g. 'building website floor plan page', 'virtual tour', 'unit listing') or null if not found",
    "total_sqft": "square footage if explicitly stated on website, or null if not found — DO NOT GUESS",
    "room_layout": "description of how rooms connect if visible in floor plan, or null",
    "living_dining_combined": true/false/null,
    "kitchen_style": "open to living, galley, U-shaped, etc. — only if you can see it in floor plan or photos",
    "room_dimensions": {
      "living_room": "dimensions ONLY if explicitly stated (e.g. '15x20 ft'), otherwise null",
      "bedroom": "dimensions ONLY if explicitly stated, otherwise null",
      "kitchen": "dimensions ONLY if explicitly stated, otherwise null"
    },
    "notable_spatial_features": ["ONLY features you can actually verify from floor plan or photos — e.g. 'L-shaped layout', 'balcony off living room'"]
  },
  "amenities": ["relevant amenities"],
  "neighborhood_vibe": "description of neighborhood character",
  "design_aesthetic": "the overall aesthetic the building conveys",
  "website_url": "URL of the building website if found",
  "confidence_notes": ["List what you could NOT find or verify — e.g. 'No floor plan available on website', 'Room dimensions not listed', 'Could not access virtual tour'"],
  "summary": "2-3 sentence summary useful for a designer. Be explicit about what is based on the website vs what is inferred."
}`;

  const honesty = `
CRITICAL RULES:
- ONLY include information you can actually find on the website or in search results.
- If you cannot find floor plans, room dimensions, or square footage, set those fields to null and mark floor_plan.found as false.
- NEVER invent or estimate room dimensions — only include them if explicitly stated on the website.
- Use confidence_notes to list what you couldn't find. This is important for user trust.
- If the website doesn't have certain finishes info, say "not specified" rather than guessing.`;

  const prompt = building_url
    ? `Read and analyze this apartment building's website: ${building_url}

Also search online for additional details about "${searchContext}".

Extract everything useful for an interior designer advising a resident:
- Building style and architecture (modern, historic, industrial, etc.)
- Standard finishes and fixtures (flooring, countertops, cabinetry, appliances)
- Apartment features (windows, ceiling height, layout style)
- FLOOR PLAN: Look for floor plans, unit layouts, or virtual tours. If you find one, extract room dimensions, layout, kitchen style, and spatial features. If you DON'T find a floor plan, set floor_plan.found to false and note it in confidence_notes.
- Building amenities that affect lifestyle
- Neighborhood vibe and character
- Any design aesthetic the building promotes
${honesty}

Return JSON:
${jsonSchema}`
    : `Search for "${searchContext}" and find the official apartment building website. Read the website and extract information useful for an interior designer advising a resident.

Extract:
- Building style and architecture
- Standard finishes (flooring, countertops, cabinetry)
- Apartment features (windows, ceiling height, layout)
- FLOOR PLAN: Look for floor plans, unit layouts, or virtual tours. If found, extract dimensions and layout details. If NOT found, set floor_plan.found to false.
- Building amenities
- Neighborhood character
- Design aesthetic
${honesty}

Return JSON:
${jsonSchema}`;

  try {
    const response = await geminiProvider.chat({
      model: selectModel("apartment_research"),
      system: "You are an expert interior designer researching an apartment building to advise a new resident on furniture and decor. Extract every detail that would help with design recommendations.",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 4096,
      temperature: 0.2,
      tools: [{ googleSearch: {} }, { urlContext: {} }],
      responseMimeType: "application/json",
    });

    const research = JSON.parse(response.content);

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
