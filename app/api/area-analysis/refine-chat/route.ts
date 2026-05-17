/**
 * Chat-style refinement endpoint.
 *
 * GET ?room_id=...  → list of refine_messages (chat history)
 * POST { room_id, content } → adds user message, then RE-RUNS the full area
 *                              analysis with every chat refinement folded in
 *                              as client direction. Persists the assistant
 *                              message with a summary of what changed and
 *                              returns the freshly analyzed room.
 *
 * The chat is the source of truth for refinement direction: each POST gathers
 * all prior user messages and feeds them to the analysis, so the result is
 * exactly what a fresh analysis would produce given those notes.
 */

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSystemPrompt } from "@/lib/prompts/system";
import { buildDesignProfile } from "@/lib/design-context/build-profile";
import { createAgentRun, completeAgentRun } from "@/lib/db/agent-runs";
import { runAnalysis } from "@/app/api/area-analysis/route";
import { summarizeRefineChanges } from "@/lib/agents/refine-summarizer";

const HISTORY_LIMIT = 10;

/** Top-level analysis fields the focus page renders. */
const TRACKED_FIELDS = [
  "design_direction",
  "style_name",
  "recommended_palette",
  "recommended_materials",
  "recommended_textures",
  "spatial_layout",
  "lighting_conditions",
  "what_works",
  "what_should_go",
  "what_it_needs",
];

function diffAnalysis(
  oldA: Record<string, unknown>,
  newA: Record<string, unknown>,
): string[] {
  const changed: string[] = [];
  for (const f of TRACKED_FIELDS) {
    if (JSON.stringify(oldA?.[f]) !== JSON.stringify(newA?.[f])) changed.push(f);
  }
  return changed;
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const roomId = request.nextUrl.searchParams.get("room_id");
  if (!roomId) return NextResponse.json({ error: "room_id required" }, { status: 400 });

  const { data: messages } = await supabase
    .from("refine_messages")
    .select("*")
    .eq("room_id", roomId)
    .order("created_at", { ascending: true });

  return NextResponse.json({ messages: messages || [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { room_id, content } = body as { room_id?: string; content?: string };
  if (!room_id || !content || typeof content !== "string" || content.trim().length === 0) {
    return NextResponse.json({ error: "room_id and content required" }, { status: 400 });
  }

  const { data: room } = await supabase
    .from("rooms")
    .select("*")
    .eq("id", room_id)
    .single();
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

  const { data: latestDiagnosis } = await supabase
    .from("room_diagnoses")
    .select("diagnosis_json")
    .eq("room_id", room_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!latestDiagnosis) {
    return NextResponse.json(
      { error: "No analysis to refine. Run the initial assessment first." },
      { status: 400 },
    );
  }
  const priorAnalysis = latestDiagnosis.diagnosis_json as Record<string, unknown>;

  // Persist user message immediately so the UI can echo it even on failure.
  const { data: userMsg, error: userInsertErr } = await supabase
    .from("refine_messages")
    .insert({
      room_id,
      user_id: user.id,
      role: "user",
      content: content.trim(),
    })
    .select()
    .single();
  if (userInsertErr) {
    return NextResponse.json(
      { error: `Failed to record message: ${userInsertErr.message}` },
      { status: 500 },
    );
  }

  const agentRun = await createAgentRun(supabase, {
    room_id,
    agent_type: "area_analyzer",
    input_json: { refine_chat: true, message: content },
  });

  try {
    // Gather every refinement request (the just-inserted message included) so
    // the re-analysis reflects the full conversation, not just the last line.
    const { data: allUserMsgs } = await supabase
      .from("refine_messages")
      .select("content")
      .eq("room_id", room_id)
      .eq("role", "user")
      .order("created_at", { ascending: true });

    const directions: string[] = (allUserMsgs || [])
      .map((m: { content: string }) => (m.content || "").trim())
      .filter(Boolean);

    const extraDirection = directions.length > 0
      ? `ADDITIONAL DESIGN DIRECTION FROM CLIENT (refinements requested after the initial assessment — apply all of them; the LAST item is the most recent and highest priority):\n${directions.map((d) => `- ${d}`).join("\n")}`
      : "";

    // Re-run the full area analysis with the refinements folded in. This
    // persists a new room_diagnoses row internally.
    const analysisResponse = await runAnalysis(supabase, room_id, room.project_id, {
      forceRefresh: true,
      extraDirection,
    });
    const analysisData = await analysisResponse.json();
    if (!analysisResponse.ok || analysisData.error || !analysisData.analysis) {
      throw new Error(analysisData.error || "Re-analysis failed");
    }
    const newAnalysis = analysisData.analysis as Record<string, unknown>;

    const changedFields = diffAnalysis(priorAnalysis, newAnalysis);

    // Short client-facing summary of what changed.
    const profile = buildDesignProfile(
      (await supabase.from("projects").select("*").eq("id", room.project_id).single()).data,
    );
    const { summary, tokens: summaryTokens } = await summarizeRefineChanges({
      feedback: content,
      priorAnalysis,
      newAnalysis,
      system: getSystemPrompt(profile),
    });

    const { data: assistantMsg } = await supabase
      .from("refine_messages")
      .insert({
        room_id,
        user_id: user.id,
        role: "assistant",
        content: summary,
        patch_json: null,
        warnings_json: [],
        analysis_snapshot: newAnalysis,
        tokens_used: summaryTokens,
      })
      .select()
      .single();

    await completeAgentRun(supabase, agentRun.id, {
      status: "completed",
      output_json: { summary, changed_fields: changedFields },
      tokens_used: summaryTokens,
    });

    return NextResponse.json({
      user_message: userMsg,
      assistant_message: assistantMsg,
      analysis: newAnalysis,
      changed_fields: changedFields,
      warnings: [],
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error("[refine-chat] Error:", errorMessage, err);
    await completeAgentRun(supabase, agentRun.id, {
      status: "failed",
      error_message: errorMessage,
    });
    return NextResponse.json({ error: `Refinement failed: ${errorMessage}` }, { status: 500 });
  }
}
