import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { geminiProvider } from "@/lib/ai/gemini";
import { selectModel } from "@/lib/ai/models";

/**
 * Research an apartment building using Gemini Google Search + URL Context.
 * Finds the building website, reads it, and extracts relevant information.
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

  const prompt = building_url
    ? `Read and analyze this apartment building's website: ${building_url}

Extract everything useful for an interior designer advising a resident:
- Building style and architecture (modern, historic, industrial, etc.)
- Standard finishes and fixtures (flooring, countertops, cabinetry, appliances)
- Apartment features (windows, ceiling height, layout style)
- Building amenities that affect lifestyle
- Neighborhood vibe and character
- Any design aesthetic the building promotes
- Floor plan characteristics

Return JSON:
{
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
  "ceiling_height": "estimated height",
  "layout_style": "open concept, traditional, etc.",
  "amenities": ["relevant amenities"],
  "neighborhood_vibe": "description of neighborhood character",
  "design_aesthetic": "the overall aesthetic the building conveys",
  "summary": "2-3 sentence summary useful for a designer"
}`
    : `Search for "${searchContext}" and find the official apartment building website. Read the website and extract information useful for an interior designer advising a resident.

Extract:
- Building style and architecture
- Standard finishes (flooring, countertops, cabinetry)
- Apartment features (windows, ceiling height, layout)
- Building amenities
- Neighborhood character
- Design aesthetic

Return JSON:
{
  "building_style": "description",
  "finishes": {
    "flooring": "type and color",
    "countertops": "material and color",
    "cabinetry": "style and color",
    "appliances": "brand/tier",
    "fixtures": "style"
  },
  "features": ["list"],
  "windows": "description",
  "ceiling_height": "estimated",
  "layout_style": "type",
  "amenities": ["list"],
  "neighborhood_vibe": "description",
  "design_aesthetic": "description",
  "website_url": "URL found",
  "summary": "2-3 sentence summary"
}`;

  try {
    const tools = building_url
      ? [{ urlContext: {} }]
      : [{ googleSearch: {} }, { urlContext: {} }];

    const response = await geminiProvider.chat({
      model: selectModel("apartment_research"),
      system: "You are an expert interior designer researching an apartment building to advise a new resident on furniture and decor. Extract every detail that would help with design recommendations.",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 4096,
      temperature: 0.2,
      tools,
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
    console.error("[apartment-research]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
