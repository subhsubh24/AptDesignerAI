import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { geminiProvider } from "@/lib/ai/gemini";
import { selectModel } from "@/lib/ai/models";
import { z } from "zod";

// (c) Zod schema for structured validation of research output
const FloorPlanVariantSchema = z.object({
  name: z.string().nullable().optional(),
  sqft: z.union([z.string(), z.number()]).nullable().optional(),
  floor_plan_image_url: z.string().nullable().optional(),
  room_layout: z.string().nullable().optional(),
  living_dining_combined: z.boolean().nullable().optional(),
  kitchen_style: z.string().nullable().optional(),
  room_dimensions: z.record(z.string(), z.string().nullable()).nullable().optional(),
  notable_spatial_features: z.array(z.string()).nullable().optional(),
});

const ResearchOutputSchema = z.object({
  building_style: z.string().nullable().optional(),
  finishes: z.object({
    flooring: z.string().nullable().optional(),
    countertops: z.string().nullable().optional(),
    cabinetry: z.string().nullable().optional(),
    appliances: z.string().nullable().optional(),
    fixtures: z.string().nullable().optional(),
  }).nullable().optional(),
  features: z.array(z.string()).nullable().optional(),
  windows: z.string().nullable().optional(),
  ceiling_height: z.string().nullable().optional(),
  layout_style: z.string().nullable().optional(),
  floor_plan: z.object({
    found: z.boolean().nullable().optional(),
    source: z.string().nullable().optional(),
    unit_type_searched: z.string().nullable().optional(),
    total_sqft: z.union([z.string(), z.number()]).nullable().optional(),
    unit_variants: z.array(FloorPlanVariantSchema).nullable().optional(),
    room_layout: z.string().nullable().optional(),
    living_dining_combined: z.boolean().nullable().optional(),
    kitchen_style: z.string().nullable().optional(),
    room_dimensions: z.record(z.string(), z.string().nullable()).nullable().optional(),
    notable_spatial_features: z.array(z.string()).nullable().optional(),
  }).nullable().optional(),
  amenities: z.array(z.string()).nullable().optional(),
  neighborhood_vibe: z.string().nullable().optional(),
  design_aesthetic: z.string().nullable().optional(),
  website_url: z.string().nullable().optional(),
  confidence_notes: z.array(z.string()).nullable().optional(),
  summary: z.string().nullable().optional(),
  // Populated by the googleMaps enrichment pass (post-primary research).
  location_context: z.object({
    primary_orientation: z.string().nullable().optional(),
    likely_light_direction: z.string().nullable().optional(),
    view_character: z.string().nullable().optional(),
    nearby_design_references: z.array(z.string()).nullable().optional(),
    neighborhood_aesthetic_cues: z.array(z.string()).nullable().optional(),
    confidence: z.string().nullable().optional(),
  }).nullable().optional(),
}).passthrough(); // Allow extra fields

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
 * Robustly parse a model response that may be raw JSON, wrapped in markdown
 * code fences (```json ... ```), or truncated. Used for both the primary
 * research pass and the targeted second pass.
 */
function parseModelJSON(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw);
  } catch {
    // Fallback: extract JSON from markdown code blocks first
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      const inner = jsonMatch[1].trim();
      try {
        return JSON.parse(inner);
      } catch {
        return repairAndParseJSON(inner);
      }
    }
    // Or locate the outermost { ... } span
    const braceStart = raw.indexOf("{");
    const braceEnd = raw.lastIndexOf("}");
    if (braceStart !== -1 && braceEnd > braceStart) {
      try {
        return JSON.parse(raw.slice(braceStart, braceEnd + 1));
      } catch {
        return repairAndParseJSON(raw.slice(braceStart));
      }
    }
    if (braceStart !== -1) {
      // Truncated — only opening brace found, try to repair
      return repairAndParseJSON(raw.slice(braceStart));
    }
    // Last resort: attempt to repair the raw text after stripping a leading
    // fence marker if present (handles unterminated ```json blocks).
    const stripped = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    if (stripped.startsWith("{")) {
      return repairAndParseJSON(stripped);
    }
    throw new Error("Could not parse model JSON response");
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
      // Note: googleMaps cannot be combined with googleSearch in the same request
      tools: [{ googleSearch: {} }, { urlContext: {} }],
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
      research = parseModelJSON(raw);
    } catch (e) {
      console.error("[apartment-research] Unparseable response:", raw.slice(0, 500));
      throw new Error((e as Error).message || "Could not parse building research response");
    }

    // (c) Validate research output with Zod — coerce bad types to null
    const validated = ResearchOutputSchema.safeParse(research);
    if (validated.success) {
      research = validated.data as Record<string, unknown>;
    } else {
      console.warn("[apartment-research] Schema validation warnings:", validated.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
      // Non-fatal: coerce known bad types (e.g., total_sqft: "varies" → null)
      const fp = research.floor_plan as Record<string, unknown> | undefined;
      if (fp?.total_sqft && typeof fp.total_sqft !== "number" && typeof fp.total_sqft !== "string") {
        fp.total_sqft = null;
      }
    }

    // (b) Retry/fallback for sparse data — if floor plan is empty, do a targeted second pass
    const fp = research.floor_plan as Record<string, unknown> | undefined;
    const hasFloorPlan = fp?.found === true && (fp?.unit_variants as unknown[] | undefined)?.length;
    const hasFinishes = research.finishes && Object.values(research.finishes as Record<string, unknown>).some(v => v && v !== "not specified");

    if (!hasFloorPlan || !hasFinishes) {
      console.log(`[apartment-research] Sparse data detected — floor_plan: ${hasFloorPlan ? "found" : "missing"}, finishes: ${hasFinishes ? "found" : "missing"}. Running targeted second pass.`);
      const gaps: string[] = [];
      if (!hasFloorPlan) gaps.push(`floor plans for a ${unitLabel} unit`);
      if (!hasFinishes) gaps.push("standard finishes (flooring, countertops, cabinetry)");

      try {
        const fallbackResponse = await geminiProvider.chat({
          model: selectModel("apartment_research"),
          system: "You are a real estate researcher. Search specifically for the missing information about this apartment building. Return ONLY the fields you find — do NOT guess.",
          messages: [{ role: "user", content: `Search for "${searchContext}" specifically to find: ${gaps.join(" and ")}.\n\nTry these sources:\n- apartments.com/${building_name?.toLowerCase().replace(/\s+/g, "-")}\n- zillow.com search for "${searchContext}"\n- The building's official website${building_url ? ` (${building_url})` : ""}\n\nReturn JSON with ONLY the fields you find:\n{\n  ${!hasFloorPlan ? '"floor_plan": { "found": true/false, "total_sqft": number_or_null, "unit_variants": [...], "room_dimensions": {...} },' : ''}\n  ${!hasFinishes ? '"finishes": { "flooring": "...", "countertops": "...", "cabinetry": "..." }' : ''}\n}` }],
          max_tokens: 4000,
          temperature: 0.2,
          tools: [{ googleSearch: {} }, { urlContext: {} }],
        });

        const fallbackRaw = fallbackResponse.content.trim();
        if (fallbackRaw) {
          try {
            // Use the shared parser so markdown-fenced or truncated responses
            // (e.g. "```json\n{...") are handled the same way as the primary pass.
            const fallbackData = parseModelJSON(fallbackRaw);
            // Merge fallback data into research (only fill gaps)
            if (!hasFloorPlan && fallbackData.floor_plan) {
              research.floor_plan = fallbackData.floor_plan;
              console.log("[apartment-research] Fallback filled floor_plan data");
            }
            if (!hasFinishes && fallbackData.finishes) {
              research.finishes = { ...(research.finishes as Record<string, unknown> || {}), ...(fallbackData.finishes as Record<string, unknown>) };
              console.log("[apartment-research] Fallback filled finishes data");
            }
          } catch (e) {
            console.warn("[apartment-research] Fallback response unparseable:", (e as Error).message);
          }
        }
      } catch (e) {
        console.warn("[apartment-research] Fallback search failed:", (e as Error).message);
      }
    }

    // (a) Analyze floor plan images via Gemini vision if URLs were found
    const floorPlanData = research.floor_plan as Record<string, unknown> | undefined;
    const variants = floorPlanData?.unit_variants as Array<Record<string, unknown>> | undefined;
    if (variants?.length) {
      const imageUrls = variants
        .map(v => v.floor_plan_image_url as string | null)
        .filter((url): url is string => !!url);

      if (imageUrls.length > 0) {
        console.log(`[apartment-research] Analyzing ${imageUrls.length} floor plan image(s) via Gemini vision`);
        try {
          const visionBlocks: Array<{ type: "image"; source: { type: "url"; url: string } } | { type: "text"; text: string }> = [];
          for (const url of imageUrls.slice(0, 3)) {
            visionBlocks.push({ type: "image", source: { type: "url", url } });
          }
          visionBlocks.push({
            type: "text",
            text: `Analyze these floor plan images for a ${unitLabel} apartment. Extract:\n1. Actual room dimensions if labeled or measurable from scale\n2. Door and window positions on each wall\n3. Room spatial relationships (which rooms connect, open/closed)\n4. Any hallways, closets, or architectural features\n\nReturn JSON:\n{\n  "extracted_dimensions": { "living_room": "WxD ft or null", "bedroom": "WxD ft or null", "kitchen": "WxD ft or null" },\n  "door_positions": ["description of each door location"],\n  "window_positions": ["description of each window location"],\n  "spatial_relationships": "how rooms connect"\n}`,
          });

          const visionResponse = await geminiProvider.chat({
            model: selectModel("apartment_research"),
            system: "You are analyzing floor plan images. Extract spatial information that would help an interior designer plan furniture placement.",
            messages: [{ role: "user", content: visionBlocks }],
            max_tokens: 3000,
            temperature: 0.1,
          });

          const visionRaw = visionResponse.content.trim();
          if (visionRaw) {
            try {
              const visionData = parseModelJSON(visionRaw);
              // Merge vision-extracted data into floor plan
              if (visionData.extracted_dimensions) {
                const existingDims = (floorPlanData?.room_dimensions as Record<string, string | null>) || {};
                const extractedDims = visionData.extracted_dimensions as Record<string, string | null>;
                // Only fill null dimensions
                for (const [room, dim] of Object.entries(extractedDims)) {
                  if (dim && (!existingDims[room] || existingDims[room] === "null")) {
                    existingDims[room] = dim;
                  }
                }
                (research.floor_plan as Record<string, unknown>).room_dimensions = existingDims;
                console.log("[apartment-research] Vision extracted room dimensions:", JSON.stringify(existingDims));
              }
              // Store vision analysis as additional context
              (research.floor_plan as Record<string, unknown>).vision_analysis = {
                door_positions: visionData.door_positions || [],
                window_positions: visionData.window_positions || [],
                spatial_relationships: visionData.spatial_relationships || null,
              };
            } catch (e) {
              console.warn("[apartment-research] Vision analysis unparseable:", (e as Error).message);
            }
          }
        } catch (e) {
          console.warn("[apartment-research] Floor plan vision analysis failed:", (e as Error).message);
        }
      }
    }

    // ─── Google Maps enrichment pass ─────────────────────────────
    // googleMaps can't be combined with googleSearch OR urlContext in the
    // same call (Gemini rejects with INVALID_ARGUMENT). It must run solo.
    // We use it as a separate lookup for *location-aware* context the web
    // search alone misses: building orientation (→ natural light planning),
    // view character (→ palette cues), and neighborhood design vibe.
    // Results are merged into research.location_context — purely additive.
    if (building_name || building_place_id) {
      try {
        const locationQuery = building_place_id
          ? `Google Maps place_id: ${building_place_id}`
          : [building_name, neighborhood, city, state].filter(Boolean).join(", ");

        const mapsResponse = await geminiProvider.chat({
          model: selectModel("apartment_research"),
          system: "You are an interior-design research assistant using Google Maps. Extract location-aware context that affects design decisions — orientation, typical view, neighborhood aesthetic character. Never invent — return null for anything Maps doesn't reveal.",
          messages: [{
            role: "user",
            content: `Using Google Maps, look up: ${locationQuery}.

Extract ONLY what Maps actually reveals (buildings, streetview, reviews, nearby places). Return JSON:
{
  "primary_orientation": "N | S | E | W | NE | NW | SE | SW | null — which way does the building's main facade face?",
  "likely_light_direction": "morning | afternoon | evening | mixed | null — based on orientation, when is natural light strongest in typical units?",
  "view_character": "skyline | water | park | street | mixed-urban | industrial | residential | null",
  "nearby_design_references": ["up to 3 notable design-relevant nearby places — art museum, design district, architectural landmark"],
  "neighborhood_aesthetic_cues": ["2-4 short phrases describing the visual/material character of the block — e.g. 'prewar brick', 'modern glass towers', 'tree-lined brownstones'"],
  "confidence": "high | medium | low"
}

If Maps doesn't reveal the answer, use null — DO NOT GUESS.`,
          }],
          max_tokens: 1500,
          temperature: 0.2,
          // googleMaps must run alone — combining with urlContext or googleSearch
          // produces INVALID_ARGUMENT from the Gemini API.
          tools: [{ googleMaps: {} }],
        });

        const mapsRaw = mapsResponse.content.trim();
        if (mapsRaw) {
          try {
            const locationContext = parseModelJSON(mapsRaw);
            research.location_context = locationContext;
            console.log("[apartment-research] Maps enrichment merged location_context", {
              orientation: locationContext.primary_orientation,
              light: locationContext.likely_light_direction,
              confidence: locationContext.confidence,
            });
          } catch (e) {
            console.warn("[apartment-research] Maps response unparseable:", (e as Error).message);
          }
        }
      } catch (e) {
        // Non-fatal — primary research is already complete
        console.warn("[apartment-research] Maps enrichment failed:", (e as Error).message);
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
