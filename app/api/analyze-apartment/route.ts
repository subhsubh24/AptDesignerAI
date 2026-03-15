import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { anthropicProvider } from "@/lib/ai/anthropic";
import { selectModel } from "@/lib/ai/models";
import { getSystemPrompt } from "@/lib/prompts/system";
import { createAgentRun, completeAgentRun } from "@/lib/db/agent-runs";
import type { AIContentBlock } from "@/lib/ai/provider";

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

  contentBlocks.push({
    type: "text",
    text: `\nAnalyze this entire apartment holistically. You know everything about the owner (see your system prompt).

Provide a JSON response with this structure:
{
  "overall": "A 2-3 sentence personalized summary of the apartment's current state, what's working, and the overall vibe. Reference the owner's style preferences.",
  "rooms": {
    "<room_type>": {
      "summary": "1-2 sentence assessment of this specific area",
      "score": <1-10 current design score>,
      "strengths": ["what works well"],
      "weaknesses": ["what needs improvement"],
      "needs": ["specific items/changes needed, e.g. 'area rug', 'accent lighting', 'wall art'"],
      "priority": <1-10 how urgently this room needs attention>
    }
  }
}

Be specific and opinionated. Reference actual items you see. Don't be generic.`,
  });

  // Create agent run for tracking
  const firstRoom = rooms[0];
  const agentRun = await createAgentRun(supabase, {
    room_id: firstRoom.id,
    agent_type: "apartment_analyzer",
    input_json: { project_id, room_count: rooms.length },
  });

  try {
    const response = await anthropicProvider.chat({
      model: selectModel("apartment_analysis"),
      system: getSystemPrompt(),
      messages: [{ role: "user", content: contentBlocks }],
      max_tokens: 4096,
      temperature: 0.3,
    });

    // Parse JSON from response
    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found in response");

    const analysis = JSON.parse(jsonMatch[0]);

    // Save diagnosis for each room
    for (const room of rooms) {
      const roomAnalysis = analysis.rooms?.[room.room_type];
      if (!roomAnalysis) continue;

      await supabase.from("room_diagnoses").insert({
        room_id: room.id,
        diagnosis_json: roomAnalysis,
        design_direction_json: { overall: analysis.overall },
        missing_categories: roomAnalysis.needs || [],
        action_list: roomAnalysis.weaknesses || [],
        model_used: selectModel("apartment_analysis"),
      });

      await supabase
        .from("rooms")
        .update({ status: "diagnosed" })
        .eq("id", room.id);
    }

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
