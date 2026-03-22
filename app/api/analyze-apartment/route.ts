import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { geminiProvider } from "@/lib/ai/gemini";
import { selectModel } from "@/lib/ai/models";
import { getSystemPrompt } from "@/lib/prompts/system";
import { createAgentRun, completeAgentRun } from "@/lib/db/agent-runs";
import type { AIContentBlock } from "@/lib/ai/provider";
import { buildDesignProfile } from "@/lib/design-context/build-profile";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const projectId = request.nextUrl.searchParams.get("project_id");
  if (!projectId) return NextResponse.json({ error: "project_id required" }, { status: 400 });

  // Load existing diagnoses and build summary
  const { data: rooms } = await supabase
    .from("rooms")
    .select("*, room_diagnoses(*), room_images(*)")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });

  if (!rooms) return NextResponse.json({ error: "No rooms found" }, { status: 404 });

  const summary = buildSummaryFromDiagnoses(rooms);
  return NextResponse.json({ summary });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { project_id } = await request.json();
  if (!project_id) return NextResponse.json({ error: "project_id required" }, { status: 400 });

  // Load project with building research
  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", project_id)
    .single();

  // Load all rooms with their images
  const { data: rooms } = await supabase
    .from("rooms")
    .select("*, room_images(*)")
    .eq("project_id", project_id)
    .order("created_at", { ascending: true });

  if (!rooms || rooms.length === 0) {
    return NextResponse.json({ error: "No rooms found" }, { status: 400 });
  }

  // Build vision content: all room photos organized by section
  const contentBlocks: AIContentBlock[] = [
    { type: "text", text: "Here are all the photos of the apartment, organized by room:" },
  ];

  for (const room of rooms) {
    const images = room.room_images || [];
    if (images.length === 0) continue;

    contentBlocks.push({
      type: "text",
      text: `\n--- ${room.name} (${room.room_type}) ---`,
    });

    for (const img of images) {
      contentBlocks.push({
        type: "image",
        source: { type: "url", url: img.image_url },
      });
    }
  }

  // Inject building research context if available
  if (project?.building_research) {
    const br = project.building_research as Record<string, unknown>;
    contentBlocks.push({
      type: "text",
      text: `\n--- BUILDING RESEARCH (from the building's website) ---
Building style: ${br.building_style || "unknown"}
Finishes: ${JSON.stringify(br.finishes || {})}
Layout style: ${br.layout_style || "unknown"}
Windows: ${br.windows || "unknown"}
Ceiling height: ${br.ceiling_height || "unknown"}
Design aesthetic: ${br.design_aesthetic || "unknown"}
Summary: ${br.summary || ""}
---`,
    });
  }

  contentBlocks.push({
    type: "text",
    text: `\nAnalyze this entire apartment holistically. You know everything about the owner (see your system prompt). ${project?.building_research ? "Use the building research context above to understand the apartment finishes and architectural style." : ""}

Provide a JSON response with this structure:
{
  "overall": "A 2-3 sentence personalized summary of the apartment's current state, what's working, and the overall vibe. ONLY describe things you can actually see in the photos. Do NOT invent or assume items that aren't visible.",
  "rooms": {
    "<room_type>": {
      "summary": "1-2 sentence assessment of this specific area — only reference what you see",
      "score": <1-10 current design score>,
      "keep": ["Specific items/features that should STAY — reference actual things you see in the photos, e.g. 'Dark gray sectional sofa — good scale and anchors the room'"],
      "replace": ["Specific items that should be REMOVED or REPLACED — say what and why, e.g. 'Glass coffee table — drastically undersized for the sectional, cheapens the space'"],
      "add": ["Specific items/changes to ADD — be very descriptive so these can be used as search queries, e.g. 'Large 8x10 textured wool area rug in warm ivory or oatmeal to ground the seating area'"],
      "priority": <1-10 how urgently this room needs attention>
    }
  }
}

CRITICAL RULES:
- ONLY describe items, furniture, and features you can actually SEE in the photos. Never make up items.
- If a room photo is unclear or you can't see certain areas, say so. Don't fill in gaps with assumptions.
- Be specific and opinionated about what you DO see. Reference actual items visible in the photos.
- For the "add" array, write each item as a detailed, searchable product description — include size, material, color, and purpose. These will be used directly to search for products.
- Your credibility depends on accuracy. One wrong detail ("I see a blue chair" when there isn't one) destroys trust.`,
  });

  // Create agent run for tracking
  const firstRoom = rooms[0];
  const agentRun = await createAgentRun(supabase, {
    room_id: firstRoom.id,
    agent_type: "apartment_analyzer",
    input_json: { project_id, room_count: rooms.length },
  });

  try {
    const profile = buildDesignProfile(project);
    const response = await geminiProvider.chat({
      model: selectModel("apartment_analysis"),
      system: getSystemPrompt(profile),
      messages: [{ role: "user", content: contentBlocks }],
      max_tokens: 4096,
      temperature: 0.3,
      responseMimeType: "application/json",
    });

    const analysis = JSON.parse(response.content);

    // Save diagnosis for each room — normalize keys to handle case/format mismatches
    const analysisRooms = analysis.rooms || {};
    const normalizedRooms: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(analysisRooms)) {
      normalizedRooms[key.toLowerCase().replace(/[\s-]+/g, "_")] = value;
    }

    for (const room of rooms) {
      const normalizedType = room.room_type.toLowerCase().replace(/[\s-]+/g, "_");
      const roomAnalysis = normalizedRooms[normalizedType]
        || normalizedRooms[room.room_type]
        || analysisRooms[room.room_type];
      if (!roomAnalysis) continue;

      await supabase.from("room_diagnoses").insert({
        room_id: room.id,
        diagnosis_json: roomAnalysis,
        design_direction_json: { overall: analysis.overall },
        missing_categories: roomAnalysis.add || roomAnalysis.needs || [],
        action_list: roomAnalysis.replace || roomAnalysis.weaknesses || [],
        model_used: selectModel("apartment_analysis"),
      });

      await supabase
        .from("rooms")
        .update({ status: "diagnosed" })
        .eq("id", room.id);
    }

    // Save apartment analysis to project for downstream use by area analysis
    await supabase
      .from("projects")
      .update({ apartment_analysis: analysis })
      .eq("id", project_id);

    await completeAgentRun(supabase, agentRun.id, {
      status: "completed",
      output_json: analysis,
      tokens_used: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0),
    });

    return NextResponse.json({ summary: analysis });
  } catch (err) {
    await completeAgentRun(supabase, agentRun.id, {
      status: "failed",
      error_message: err instanceof Error ? err.message : "Unknown error",
    });
    return NextResponse.json({ error: "Analysis failed" }, { status: 500 });
  }
}

function buildSummaryFromDiagnoses(rooms: Array<{
  room_type: string;
  room_diagnoses: Array<{ diagnosis_json: Record<string, unknown>; design_direction_json: Record<string, unknown> | null }>;
}>) {
  const result: {
    overall: string;
    rooms: Record<string, unknown>;
  } = {
    overall: "",
    rooms: {},
  };

  for (const room of rooms) {
    const latestDiagnosis = room.room_diagnoses?.[room.room_diagnoses.length - 1];
    if (!latestDiagnosis) continue;

    if (!result.overall && latestDiagnosis.design_direction_json) {
      result.overall = (latestDiagnosis.design_direction_json as { overall?: string }).overall || "";
    }

    result.rooms[room.room_type] = latestDiagnosis.diagnosis_json;
  }

  return result;
}
