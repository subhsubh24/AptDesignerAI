import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { geminiProvider } from "@/lib/ai/gemini";
import { selectModel } from "@/lib/ai/models";
import { getSystemPrompt } from "@/lib/prompts/system";
import { createAgentRun, completeAgentRun } from "@/lib/db/agent-runs";
import { validateAnalysis } from "@/lib/agents/validation-agent";
import type { AIContentBlock } from "@/lib/ai/provider";
import { buildDesignProfile } from "@/lib/design-context/build-profile";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const roomId = request.nextUrl.searchParams.get("room_id");
  if (!roomId) return NextResponse.json({ error: "room_id required" }, { status: 400 });

  const { data: diagnosis } = await supabase
    .from("room_diagnoses")
    .select("*")
    .eq("room_id", roomId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!diagnosis) return NextResponse.json({ analysis: null });

  // Check if we have a detailed area analysis (has what_it_needs field)
  const djson = diagnosis.diagnosis_json as Record<string, unknown>;
  if (djson.what_it_needs) {
    return NextResponse.json({ analysis: djson });
  }

  // Fall back: if we have an apartment-level diagnosis with needs, convert it
  if (djson.needs && Array.isArray(djson.needs)) {
    const converted = {
      summary: (djson.summary as string) || "Analysis available",
      what_it_needs: (djson.needs as string[]).map((need: string) => {
        // Extract short category from strings like "area rug — this is the highest..."
        // or "replace white tv console immediately — walnut..."
        const raw = need.split("—")[0].split("–")[0].split("-")[0].trim();
        // Remove action verbs and clean up
        const cleaned = raw
          .replace(/^(replace|add|get|remove|swap|upgrade|buy|find|consider)\s+(the\s+|a\s+|an\s+|or\s+remove\s+the\s+)?/i, "")
          .trim();
        // Take first 3 words max for category name
        const shortName = cleaned.split(/\s+/).slice(0, 3).join("_").toLowerCase()
          .replace(/[^a-z0-9_]/g, "");
        return {
          category: shortName || "other",
          description: need,
          priority: "medium" as const,
          specs: "",
        };
      }),
      what_works: (djson.strengths as string[]) || [],
      what_should_go: (djson.weaknesses as string[]) || [],
      design_direction: "",
    };
    return NextResponse.json({ analysis: converted });
  }

  return NextResponse.json({ analysis: null });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { room_id, project_id } = await request.json();
  if (!room_id) return NextResponse.json({ error: "room_id required" }, { status: 400 });

  // Load this room with images
  const { data: room } = await supabase
    .from("rooms")
    .select("*, room_images(*)")
    .eq("id", room_id)
    .single();

  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

  // Load project with building research and apartment analysis
  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", project_id || room.project_id)
    .single();

  // Load other rooms for cross-room awareness
  const { data: otherRooms } = await supabase
    .from("rooms")
    .select("*, room_images(*), room_diagnoses(*)")
    .eq("project_id", project_id || room.project_id)
    .neq("id", room_id);

  // Build vision content
  const contentBlocks: AIContentBlock[] = [];

  // Inject building research if available
  if (project?.building_research) {
    const br = project.building_research as Record<string, unknown>;
    const floorPlan = br.floor_plan as Record<string, unknown> | undefined;
    const floorPlanSection = floorPlan
      ? `\nFloor Plan: ${floorPlan.total_sqft || "unknown"} sqft | Living/dining combined: ${floorPlan.living_dining_combined ?? "unknown"} | Kitchen: ${floorPlan.kitchen_style || "unknown"}
Room layout: ${floorPlan.room_layout || "unknown"}
Room dimensions: ${JSON.stringify(floorPlan.room_dimensions || {})}
Spatial features: ${Array.isArray(floorPlan.notable_spatial_features) ? floorPlan.notable_spatial_features.join(", ") : "unknown"}`
      : "";

    contentBlocks.push({
      type: "text",
      text: `--- BUILDING CONTEXT ---
Building style: ${br.building_style || "unknown"}
Finishes: ${JSON.stringify(br.finishes || {})}
Layout: ${br.layout_style || "unknown"} | Windows: ${br.windows || "unknown"} | Ceiling: ${br.ceiling_height || "unknown"}
Aesthetic: ${br.design_aesthetic || "unknown"}${floorPlanSection}
---`,
    });
  }

  // Inject apartment analysis if available
  if (project?.apartment_analysis) {
    const aa = project.apartment_analysis as Record<string, unknown>;
    contentBlocks.push({
      type: "text",
      text: `--- APARTMENT-LEVEL ANALYSIS (already completed) ---
Overall: ${aa.overall || ""}
${JSON.stringify(aa.rooms || {}, null, 2)}
---
Use this apartment-level context to ensure cross-room coherence in your area analysis.`,
    });
  }

  const userContextNote = room.user_context
    ? `\n\nIMPORTANT — USER NOTES ABOUT THESE PHOTOS:\n"${room.user_context}"\nTake these notes into account when analyzing the room. For example, if they say to ignore something, don't include it in your assessment or recommendations.`
    : "";

  contentBlocks.push({
    type: "text",
    text: `Focus area: ${room.name} (${room.room_type})${userContextNote}\n\nHere are the photos of this area:`,
  });

  for (const img of room.room_images || []) {
    contentBlocks.push({
      type: "image",
      source: { type: "url", url: img.image_url },
    });
  }

  // Add cross-room context
  if (otherRooms && otherRooms.length > 0) {
    contentBlocks.push({
      type: "text",
      text: "\n--- OTHER ROOMS IN THIS APARTMENT (for cross-room coherence) ---",
    });

    for (const otherRoom of otherRooms) {
      const otherDiagnosis = otherRoom.room_diagnoses?.[otherRoom.room_diagnoses.length - 1];
      contentBlocks.push({
        type: "text",
        text: `\n${otherRoom.name} (${otherRoom.room_type}): ${
          otherDiagnosis
            ? JSON.stringify((otherDiagnosis.diagnosis_json as Record<string, unknown>).summary || "analyzed")
            : "not yet analyzed"
        }`,
      });

      // Include one photo from each other room for visual context
      const firstImage = otherRoom.room_images?.[0];
      if (firstImage) {
        contentBlocks.push({
          type: "image",
          source: { type: "url", url: firstImage.image_url },
        });
      }
    }
  }

  contentBlocks.push({
    type: "text",
    text: `\nDo a deep, thorough analysis of the ${room.name}. You know the owner's preferences (see system prompt). Also consider the other rooms so everything stays cohesive across the apartment.

IMPORTANT — MULTI-FUNCTION ROOMS: If this room serves multiple functions (e.g. a living room with a dining area, or a combined living/dining space), you MUST include items for ALL zones — dining table, dining chairs, lighting for the dining zone, seating for the living zone, etc. Do NOT limit recommendations to just the primary function. A living/dining combo typically needs 8-15 items across both zones.

Return JSON:
{
  "summary": "3-4 sentence assessment of the current state — mention dominant colors, materials, what's working, what's broken. Be specific.",
  "what_it_needs": [
    {
      "category": "snake_case category slug: area_rug, coffee_table, accent_chair, wall_art, throw_pillows, side_table, floor_lamp, table_lamp, storage_cabinet, credenza, media_console, dining_table, dining_chairs, bookshelf, console_table, curtains, pendant_light, throw_blanket, plant, vase, tray, kitchen_runner",
      "search_title": "A highly specific search query — see SEARCH TITLE FORMAT below",
      "description": "Why this item is needed — what specific problem it solves from the diagnosis. 2-3 sentences.",
      "priority": "high | medium | low",
      "specs": "Exact ideal dimensions (e.g. '48-54 inches wide, 20 inches deep'), preferred materials (e.g. 'solid walnut or oak'), color range (e.g. 'warm ivory, cream, or oatmeal'), approximate price range for the tier"
    }
  ],
  "what_works": ["5-8 specific items that should stay — name each item with material + color"],
  "what_should_go": ["specific items to replace or remove — name each item and explain why"],
  "design_direction": "A detailed paragraph (4-6 sentences) describing the overall design direction — color strategy (name exact colors), material mixing strategy, texture layering plan, the feeling we're going for. Reference the apartment's finishes and overall coherence."
}

## SEARCH TITLE FORMAT — CRITICAL
Each search_title will be used to find real products on furniture websites. Before writing each one, verify it includes:
✓ Material (required for all furniture): "solid walnut", "linen", "wool", "bouclé", "brass"
✓ Color or finish (required): "warm ivory", "natural oak", "matte black"
✓ Size/dimensions (required except small decor): "8x10", "48 inch", "36 inch diameter"
✓ Style descriptor (required): "mid-century", "modern", "organic", "minimalist"
✓ Product type (required): "area rug", "coffee table", "floor lamp"

GOOD search_title examples:
✓ "Large 8x10 hand-knotted wool area rug in warm cream with subtle geometric texture"
✓ "Solid walnut round coffee table 36-40 inch diameter with tapered legs and lower shelf"
✓ "Modern arc floor lamp in brushed brass with linen drum shade 72 inches tall"
✓ "Set of 2 mid-century upholstered dining chairs walnut frame cream fabric"
✓ "Woven rattan media console 60-70 inches wide with closed storage natural finish"

BAD search_title examples (will return category pages, not products):
✗ "Coffee table" — no material, no color, no size
✗ "Area rug in cream" — no size, no material, no texture description
✗ "Modern lamp" — no material, no size, no specific type
✗ "Throw pillows" — no material, no color, no size, no quantity
✗ "Wall art" — no medium, no size, no color palette, no style

## HOW MANY ITEMS TO RECOMMEND
Be thorough. A typical living room needs 8-12 items. A combined living/dining room needs 12-18. Include:
- Large anchor pieces (rug, sofa, dining table) — high priority
- Functional pieces (coffee table, side tables, media console, storage) — high/medium priority
- Lighting (floor lamp, table lamp, pendant) — medium/high priority
- Soft furnishings (throw pillows, throw blanket, curtains) — medium priority
- Decorative elements (art, plants, vases, trays, candles) — low/medium priority

Do NOT stop at 5 items. Include everything the room needs to feel complete and intentional.

Be extremely specific. Name exact colors, materials, dimensions. Think like a world-class designer charging $500/hr.`,
  });

  const agentRun = await createAgentRun(supabase, {
    room_id,
    agent_type: "area_analyzer",
    input_json: { room_type: room.room_type, image_count: (room.room_images || []).length },
  });

  try {
    const profile = buildDesignProfile(project);
    const response = await geminiProvider.chat({
      model: selectModel("area_analysis"),
      system: getSystemPrompt(profile),
      messages: [{ role: "user", content: contentBlocks }],
      max_tokens: 5000,
      temperature: 0.3,
      responseMimeType: "application/json",
    });

    let analysis = JSON.parse(response.content);

    // Post-diagnosis validation — check analysis for consistency
    const validationResult = await validateAnalysis(
      "room_diagnosis",
      analysis,
      {
        buildingResearch: project?.building_research as Record<string, unknown> | undefined,
        apartmentAnalysis: project?.apartment_analysis as Record<string, unknown> | undefined,
        roomImages: (room.room_images || []).map((img: { image_url: string }) => img.image_url),
      }
    );

    let validation = null;
    if (validationResult.success && validationResult.data) {
      validation = {
        isValid: validationResult.data.isValid,
        confidence: validationResult.data.confidence,
        issues: validationResult.data.issues,
        suggestions: validationResult.data.suggestions,
      };

      // If validation confidence is low and we got a revised analysis, use it
      if (validationResult.data.confidence < 7 && validationResult.data.revisedAnalysis) {
        console.log(`[area-analysis] Validation confidence ${validationResult.data.confidence}/10 — using revised analysis`);
        analysis = validationResult.data.revisedAnalysis;
      }
    }

    // Save as detailed diagnosis
    await supabase.from("room_diagnoses").insert({
      room_id,
      diagnosis_json: { ...analysis, validation },
      design_direction_json: { direction: analysis.design_direction },
      missing_categories: analysis.what_it_needs?.map((n: { category: string }) => n.category) || [],
      action_list: analysis.what_it_needs || [],
      model_used: selectModel("area_analysis"),
    });

    await completeAgentRun(supabase, agentRun.id, {
      status: "completed",
      output_json: { analysis, validation },
      tokens_used: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0),
    });

    return NextResponse.json({ analysis, validation });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error("[area-analysis] Error:", errorMessage, err);
    await completeAgentRun(supabase, agentRun.id, {
      status: "failed",
      error_message: errorMessage,
    });
    return NextResponse.json({ error: `Analysis failed: ${errorMessage}` }, { status: 500 });
  }
}
