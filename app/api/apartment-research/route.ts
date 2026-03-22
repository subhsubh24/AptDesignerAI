import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { geminiProvider } from "@/lib/ai/gemini";
import { selectModel } from "@/lib/ai/models";

/**
 * Research an apartment building using Gemini Google Search grounding.
 * If a URL is provided, we fetch the page content ourselves and pass it
 * as text context (urlContext tool is unreliable across models).
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

  // If a URL is provided, fetch the page content ourselves
  let urlContent = "";
  if (building_url) {
    try {
      const res = await fetch(building_url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; AptDesigner/1.0)" },
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) {
        const html = await res.text();
        // Strip HTML tags to get readable text, limit to ~8000 chars
        urlContent = html
          .replace(/<script[\s\S]*?<\/script>/gi, "")
          .replace(/<style[\s\S]*?<\/style>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 8000);
      }
    } catch (err) {
      console.warn("[apartment-research] Failed to fetch URL:", building_url, err instanceof Error ? err.message : err);
    }
  }

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
  "ceiling_height": "estimated height",
  "layout_style": "open concept, traditional, etc.",
  "amenities": ["relevant amenities"],
  "neighborhood_vibe": "description of neighborhood character",
  "design_aesthetic": "the overall aesthetic the building conveys",
  "website_url": "URL of the building website",
  "summary": "2-3 sentence summary useful for a designer"
}`;

  let prompt: string;
  if (urlContent) {
    prompt = `Here is the content from the building website (${building_url}):

---
${urlContent}
---

Also search online for additional information about "${searchContext}".

Based on the website content and search results, extract everything useful for an interior designer advising a resident. Return JSON:
${jsonSchema}`;
  } else {
    prompt = `Search for "${searchContext}" and find information about this apartment building.

Extract everything useful for an interior designer advising a resident:
- Building style and architecture (modern, historic, industrial, etc.)
- Standard finishes and fixtures (flooring, countertops, cabinetry, appliances)
- Apartment features (windows, ceiling height, layout style)
- Building amenities that affect lifestyle
- Neighborhood vibe and character
- Any design aesthetic the building promotes

Return JSON:
${jsonSchema}`;
  }

  try {
    // Use only googleSearch for grounding — urlContext is unreliable
    const response = await geminiProvider.chat({
      model: selectModel("apartment_research"),
      system: "You are an expert interior designer researching an apartment building to advise a new resident on furniture and decor. Extract every detail that would help with design recommendations. Always respond with valid JSON only — no markdown fences, no extra text.",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 4096,
      temperature: 0.2,
      tools: [{ googleSearch: {} }],
    });

    // Extract JSON from response (may have markdown fences or preamble)
    let jsonStr = response.content.trim();
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      jsonStr = fenceMatch[1].trim();
    }
    const research = JSON.parse(jsonStr);

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
