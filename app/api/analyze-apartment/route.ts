import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { geminiProvider } from "@/lib/ai/gemini";
import { selectModel } from "@/lib/ai/models";
import { getSystemPrompt } from "@/lib/prompts/system";
import { createAgentRun, completeAgentRun } from "@/lib/db/agent-runs";
import type { AIContentBlock } from "@/lib/ai/provider";
import { buildDesignProfile } from "@/lib/design-context/build-profile";
import { extractJsonObject } from "@/lib/ai/extract-json";

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

  // Building research context (reused by every per-room call)
  const buildingContextText = project?.building_research
    ? (() => {
        const br = project.building_research as Record<string, unknown>;
        return `\n--- BUILDING RESEARCH (from the building's website) ---
Building style: ${br.building_style || "unknown"}
Finishes: ${JSON.stringify(br.finishes || {})}
Layout style: ${br.layout_style || "unknown"}
Windows: ${br.windows || "unknown"}
Ceiling height: ${br.ceiling_height || "unknown"}
Design aesthetic: ${br.design_aesthetic || "unknown"}
Summary: ${br.summary || ""}
---`;
      })()
    : "";

  const firstRoom = rooms[0];
  const agentRun = await createAgentRun(supabase, {
    room_id: firstRoom.id,
    agent_type: "apartment_analyzer",
    input_json: { project_id, room_count: rooms.length },
  });

  try {
    const profile = buildDesignProfile(project);
    const model = selectModel("apartment_analysis");
    const system = getSystemPrompt(profile);

    /**
     * Per-room analysis — one focused call per room with just that room's
     * photos. Previously all N rooms shared one 8K call, which only gave
     * ~1-1.5K tokens per room of attention. Running in parallel with
     * Promise.all so total latency ≈ max(per-room) + synthesis.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- rooms is from Supabase untyped
    const analyzeRoom = async (room: any): Promise<{
      room_type: string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- LLM response shape
      analysis: Record<string, any> | null;
      tokensUsed: number;
    }> => {
      const images = room.room_images || [];
      if (images.length === 0) return { room_type: room.room_type, analysis: null, tokensUsed: 0 };

      const userNote = room.user_context
        ? `\nUSER NOTES: "${room.user_context}" — Respect these notes (e.g. if they say to ignore something, don't include it).`
        : "";

      const roomContent: AIContentBlock[] = [
        { type: "text", text: `Here are photos of the ${room.name} (${room.room_type}):${userNote}` },
        ...images.map((img: { image_url: string }) => ({
          type: "image" as const,
          source: { type: "url" as const, url: img.image_url },
        })),
      ];

      if (buildingContextText) {
        roomContent.push({ type: "text", text: buildingContextText });
      }

      roomContent.push({
        type: "text",
        text: `Analyze this ${room.room_type} in detail. ${buildingContextText ? "Use the building research context to understand the apartment's finishes and architectural style." : ""}

PROCESS:
Step 1: Look at EVERY photo. Note floor material+color, wall color, existing furniture (name + material + color), lighting, windows.
Step 2: Identify what's working and what isn't.
Step 3: Score the current state and decide what to keep, replace, and add.

## OUTPUT FORMAT (JSON only — no prose, no markdown fences)
{
  "summary": "1-2 sentence assessment of this room — only reference what you see",
  "score": 1-10 current design score,
  "keep": ["Specific items that should STAY — named with material+color+why it works"],
  "replace": ["Specific items to REMOVE or REPLACE — what, why, what would be better"],
  "add": ["Specific items to ADD following: [Material] [item type] in [color/finish], [size], [purpose]"],
  "priority": 1-10 how urgently this room needs attention
}

CRITICAL RULES:
- ONLY describe items you can SEE in the photos. Never invent.
- If a room area isn't visible, say so — don't guess.
- Credibility depends on accuracy.

FORMAT RULES:
- keep: "Dark gray fabric L-shaped sectional — good scale, anchors the room" ✓ | "The couch is fine" ✗
- replace: "Glass coffee table — drastically undersized for the sectional. Replace with a 48-54 inch solid wood table" ✓
- add: "Large 8x10 textured wool area rug in warm ivory, to ground the seating area" ✓ | "Area rug" ✗

Include at LEAST 6-10 items in "add". A well-designed room needs soft furnishings (pillows, blankets), lighting (multiple sources), and decorative elements (art, plants, vases).`,
      });

      const response = await geminiProvider.chat({
        model,
        system,
        messages: [{ role: "user", content: roomContent }],
        max_tokens: 4000,
        temperature: 0.3,
        responseMimeType: "application/json",
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- LLM response shape
      const parsed = extractJsonObject<Record<string, any>>(response.content);
      return {
        room_type: room.room_type,
        analysis: parsed,
        tokensUsed: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0),
      };
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase rows are untyped
    const roomResults = await Promise.all(rooms.map((r: any) => analyzeRoom(r)));

    console.log(
      `[analyze-apartment] Per-room pass complete: ${roomResults.filter((r) => r.analysis).length}/${rooms.length} rooms analyzed`,
    );

    // Build rooms map (normalized + original keys for downstream lookup)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- LLM response shape
    const analysisRooms: Record<string, any> = {};
    for (const res of roomResults) {
      if (res.analysis) analysisRooms[res.room_type] = res.analysis;
    }

    /**
     * Apartment synthesis — one small call that consumes the per-room
     * summaries (as text, not images) and produces the holistic "overall"
     * narrative identifying the apartment's aesthetic thread and coherence
     * checks across rooms.
     */
    const synthInput = rooms
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase rows are untyped
      .map((r: any) => {
        const a = analysisRooms[r.room_type];
        if (!a) return `## ${r.name} (${r.room_type})\n(no analysis)`;
        return `## ${r.name} (${r.room_type})\nSummary: ${a.summary || ""}\nScore: ${a.score || "?"}/10\nKeep: ${(a.keep || []).join("; ")}\nReplace: ${(a.replace || []).join("; ")}\nAdd: ${(a.add || []).join("; ")}`;
      })
      .join("\n\n");

    const synthPrompt = `You have detailed per-room analyses of an apartment (below). Your only job is to synthesize a short overall narrative capturing:
1. The apartment's current state and overall vibe
2. The aesthetic thread (or lack thereof) across rooms — shared materials, palette, style
3. Any coherence issues (conflicting palettes, material jumps, zones that don't talk to each other)

${buildingContextText}

## PER-ROOM ANALYSES
${synthInput}

## OUTPUT FORMAT (JSON only — no prose, no markdown fences)
{
  "overall": "2-3 sentence personalized summary of the apartment — current state, what's working, aesthetic thread. Only reference things mentioned in the per-room analyses; do NOT invent."
}`;

    const synthResponse = await geminiProvider.chat({
      model,
      system,
      messages: [{ role: "user", content: [{ type: "text", text: synthPrompt }] }],
      max_tokens: 2000,
      temperature: 0.3,
      responseMimeType: "application/json",
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- LLM response shape
    const synthParsed = extractJsonObject<Record<string, any>>(synthResponse.content);
    const synthTokens = (synthResponse.usage?.input_tokens || 0) + (synthResponse.usage?.output_tokens || 0);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- merged LLM response shape
    const analysis: Record<string, any> = {
      overall: synthParsed.overall || "",
      rooms: analysisRooms,
    };

    console.log(
      `[analyze-apartment] Synthesis pass complete. Total tokens: ${roomResults.reduce((s, r) => s + r.tokensUsed, 0) + synthTokens}`,
    );

    // Save diagnosis for each room — normalize keys to handle case/format mismatches
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- LLM response shape
        missing_categories: (roomAnalysis as any).add || (roomAnalysis as any).needs || [],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- LLM response shape
        action_list: (roomAnalysis as any).replace || (roomAnalysis as any).weaknesses || [],
        model_used: model,
      });

      await supabase
        .from("rooms")
        .update({ status: "diagnosed" })
        .eq("id", room.id);
    }

    await supabase
      .from("projects")
      .update({ apartment_analysis: analysis })
      .eq("id", project_id);

    const totalTokens = roomResults.reduce((s, r) => s + r.tokensUsed, 0) + synthTokens;
    await completeAgentRun(supabase, agentRun.id, {
      status: "completed",
      output_json: analysis,
      tokens_used: totalTokens,
    });

    return NextResponse.json({ summary: analysis });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error("[analyze-apartment] Error:", errorMessage, err);
    await completeAgentRun(supabase, agentRun.id, {
      status: "failed",
      error_message: errorMessage,
    });
    return NextResponse.json({ error: `Analysis failed: ${errorMessage}` }, { status: 500 });
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
