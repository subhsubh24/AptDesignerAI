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
      what_it_needs: (djson.needs as string[]).map((need: string) => ({
        category: need.replace(/\s+/g, "_").toLowerCase(),
        description: need,
        priority: "medium" as const,
        specs: "",
      })),
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

  // Load other rooms for cross-room awareness
  const { data: otherRooms } = await supabase
    .from("rooms")
    .select("*, room_images(*), room_diagnoses(*)")
    .eq("project_id", project_id || room.project_id)
    .neq("id", room_id);

  // Build vision content
  const contentBlocks: AIContentBlock[] = [
    { type: "text", text: `Focus area: ${room.name} (${room.room_type})\n\nHere are the photos of this area:` },
  ];

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
    text: `\nDo a deep analysis of the ${room.name}. You know the owner's preferences (see system prompt). Also consider the other rooms so everything stays cohesive across the apartment.

Return JSON:
{
  "summary": "2-3 sentence assessment of the current state of this area",
  "what_it_needs": [
    {
      "category": "e.g. area_rug, coffee_table, accent_chair, wall_art, throw_pillows, side_table, lamp",
      "description": "What exactly and why - be specific about style, color, material",
      "priority": "high | medium | low",
      "specs": "Ideal dimensions, material, color range, price range"
    }
  ],
  "what_works": ["Specific things that should stay - reference actual items you see"],
  "what_should_go": ["Specific things that should be replaced or removed"],
  "design_direction": "A paragraph describing the overall design direction - color strategy, material mixing, the feeling we're going for. Reference the apartment's overall coherence."
}

Be extremely specific. Name exact colors, materials, dimensions. Think like a world-class designer charging $500/hr.`,
  });

  const agentRun = await createAgentRun(supabase, {
    room_id,
    agent_type: "area_analyzer",
    input_json: { room_type: room.room_type, image_count: (room.room_images || []).length },
  });

  try {
    const response = await anthropicProvider.chat({
      model: selectModel("area_analysis"),
      system: getSystemPrompt(),
      messages: [{ role: "user", content: contentBlocks }],
      max_tokens: 8192,
      temperature: 0.3,
    });

    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("[area-analysis] No JSON in response:", response.content.slice(0, 500));
      throw new Error("No JSON in response");
    }

    const analysis = JSON.parse(jsonMatch[0]);

    // Save as detailed diagnosis
    await supabase.from("room_diagnoses").insert({
      room_id,
      diagnosis_json: analysis,
      design_direction_json: { direction: analysis.design_direction },
      missing_categories: analysis.what_it_needs?.map((n: { category: string }) => n.category) || [],
      action_list: analysis.what_it_needs || [],
      model_used: selectModel("area_analysis"),
    });

    await completeAgentRun(supabase, agentRun.id, {
      status: "completed",
      output_json: analysis,
      tokens_used: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0),
    });

    return NextResponse.json({ analysis });
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
