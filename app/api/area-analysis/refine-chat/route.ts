/**
 * Chat-style refinement endpoint.
 *
 * GET ?room_id=...  → list of refine_messages (chat history) + latest analysis
 * POST { room_id, content } → adds user message, generates patch + warnings,
 *                              applies patch, persists assistant message + new
 *                              room_diagnoses snapshot, returns updated state.
 */

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { selectModel } from "@/lib/ai/models";
import { getSystemPrompt } from "@/lib/prompts/system";
import { buildDesignProfile } from "@/lib/design-context/build-profile";
import { createAgentRun, completeAgentRun } from "@/lib/db/agent-runs";
import { generateAnalysisPatch } from "@/lib/agents/refine-patcher";
import { generateDesignerWarnings } from "@/lib/agents/designer-warnings";
import { applyAnalysisPatch } from "@/lib/agents/apply-analysis-patch";
import { parseUserContextAsync } from "@/lib/utils/parse-user-context";
import type { AIContentBlock } from "@/lib/ai/provider";
import type { AnalysisPatch, DesignerWarning } from "@/lib/types/database";

const HISTORY_LIMIT = 10;

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

  // Load room + project + latest diagnosis in parallel
  const [{ data: room }, { data: existingMessages }] = await Promise.all([
    supabase.from("rooms").select("*, room_images(*)").eq("id", room_id).single(),
    supabase
      .from("refine_messages")
      .select("role, content")
      .eq("room_id", room_id)
      .order("created_at", { ascending: false })
      .limit(HISTORY_LIMIT),
  ]);

  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

  const [{ data: project }, { data: latestDiagnosis }] = await Promise.all([
    supabase.from("projects").select("*").eq("id", room.project_id).single(),
    supabase
      .from("room_diagnoses")
      .select("*")
      .eq("room_id", room_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (!latestDiagnosis) {
    return NextResponse.json(
      { error: "No analysis to refine. Run the initial assessment first." },
      { status: 400 }
    );
  }

  const priorAnalysis = latestDiagnosis.diagnosis_json as Record<string, unknown>;
  // Reverse to chronological order for the LLM
  const history = (existingMessages || []).slice().reverse();

  // Build room images as content blocks (cached via cacheScope in the patcher)
  const roomImages: AIContentBlock[] = (room.room_images || [])
    .map((img: { image_url: string }) => ({
      type: "image" as const,
      source: { type: "url" as const, url: img.image_url },
    }));

  const profile = buildDesignProfile(project);
  const system = getSystemPrompt(profile);

  // Resolve effective keep items
  const parsedContext = room.user_context
    ? await parseUserContextAsync(room.user_context)
    : null;
  const keepItems = [
    ...((room.keep_items as string[] | null) || []),
    ...(parsedContext?.additionalKeepItems || []),
  ];

  // Persist user message immediately (so the UI can echo it back even on
  // a partial failure)
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
      { status: 500 }
    );
  }

  const agentRun = await createAgentRun(supabase, {
    room_id,
    agent_type: "area_analyzer",
    input_json: { refine_chat: true, message: content },
  });

  try {
    // ── Generate patch ────────────────────────────────────────────────
    const cacheSessionKey = `refine-chat:${room_id}`;
    const patchResult = await generateAnalysisPatch({
      feedback: content,
      priorAnalysis,
      history,
      roomImages,
      cacheSessionKey,
      system,
      keepItems,
    });

    let patchedAnalysis: Record<string, unknown> = priorAnalysis;
    let changedFields: string[] = [];
    let warnings: DesignerWarning[] = [];
    let warningsTokens = 0;

    if (patchResult.changed && patchResult.patch && Object.keys(patchResult.patch).length > 0) {
      const applied = applyAnalysisPatch(priorAnalysis, patchResult.patch);
      patchedAnalysis = applied.analysis;
      changedFields = applied.changedFields;

      // Skip the full area-analysis-validator here. It was designed for
      // initial analysis and re-checks ALL items for keep_item_replaced,
      // exclusion_violation, etc. — which strips items the patcher just
      // added (e.g. "bookshelf decor" flagged as replacing kept bookshelf).
      // The patcher already has keep items + exclusions in its prompt and
      // produces changes that respect them.

      // ── Designer warnings (advisory) ────────────────────────────────
      // Only pass the items ADDED or CHANGED by this patch, not the full
      // analysis. This prevents the LLM from flagging pre-existing items
      // (e.g. "42-inch dining table creates a bottleneck" was already in
      // the assessment before the user asked to "make it cozier").
      const changedItemCategories = changedFields
        .filter((f) => f.startsWith("what_it_needs."))
        .map((f) => f.replace("what_it_needs.", ""));
      const allNeeds = Array.isArray(patchedAnalysis.what_it_needs)
        ? (patchedAnalysis.what_it_needs as Array<Record<string, unknown>>)
        : [];
      const changedItems = changedItemCategories.length > 0
        ? allNeeds.filter((it) =>
            changedItemCategories.some(
              (cat) => String(it.category || "").toLowerCase().replace(/[\s-]+/g, "_") === cat,
            ),
          )
        : [];
      const warningAnalysis = {
        ...patchedAnalysis,
        what_it_needs: changedItems.length > 0 ? changedItems : patchedAnalysis.what_it_needs,
      };
      const warningsResult = await generateDesignerWarnings({
        analysis: warningAnalysis,
        changedFields,
        feedback: content,
        system,
      });
      warnings = warningsResult.warnings;
      warningsTokens = warningsResult.tokens;

      // Persist as new diagnosis row (immutable history)
      await supabase.from("room_diagnoses").insert({
        room_id,
        diagnosis_json: patchedAnalysis,
        design_direction_json: {
          style_notes: (patchedAnalysis.design_direction as string) || "",
          recommended_palette: (patchedAnalysis.recommended_palette as string[]) || [],
          recommended_materials: (patchedAnalysis.recommended_materials as string[]) || [],
          recommended_textures: (patchedAnalysis.recommended_textures as string[]) || [],
          recommended_furniture_types: Array.isArray(patchedAnalysis.what_it_needs)
            ? (patchedAnalysis.what_it_needs as Array<{ category: string }>).map((n) => n.category)
            : [],
        },
        missing_categories: Array.isArray(patchedAnalysis.what_it_needs)
          ? (patchedAnalysis.what_it_needs as Array<{ category: string }>).map((n) => n.category)
          : [],
        action_list: patchedAnalysis.what_it_needs || [],
        model_used: selectModel("area_analysis"),
      });
    }

    // Persist assistant message
    const { data: assistantMsg } = await supabase
      .from("refine_messages")
      .insert({
        room_id,
        user_id: user.id,
        role: "assistant",
        content: patchResult.summary,
        patch_json: (patchResult.patch as AnalysisPatch | null) || null,
        warnings_json: warnings,
        analysis_snapshot: patchResult.changed ? patchedAnalysis : null,
        tokens_used: patchResult.tokens + warningsTokens,
      })
      .select()
      .single();

    await completeAgentRun(supabase, agentRun.id, {
      status: "completed",
      output_json: {
        patch: patchResult.patch,
        summary: patchResult.summary,
        changed_fields: changedFields,
        warnings,
      },
      tokens_used: patchResult.tokens + warningsTokens,
    });

    return NextResponse.json({
      user_message: userMsg,
      assistant_message: assistantMsg,
      analysis: patchedAnalysis,
      changed_fields: changedFields,
      warnings,
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
