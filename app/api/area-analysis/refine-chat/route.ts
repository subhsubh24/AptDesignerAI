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
import { requireRoomOwnership } from "@/lib/auth/ownership";
import { checkRateLimit, RATE_LIMITS } from "@/lib/utils/rate-limiter";
import { checkDailySpend, dailySpendExceededResponse } from "@/lib/utils/spend-limiter";
import { getSystemPrompt } from "@/lib/prompts/system";
import { buildDesignProfile } from "@/lib/design-context/build-profile";
import { createAgentRun, completeAgentRun } from "@/lib/db/agent-runs";
import { runAnalysis } from "@/app/api/area-analysis/route";
import { summarizeRefineChanges } from "@/lib/agents/refine-summarizer";
import { runWithMarginSession } from "@/lib/observability/margin-context";

// The POST handler re-runs the full area-analysis pipeline (`runAnalysis`) —
// the same 3–5 min multi-pass LLM job as the area-analysis route. Without an
// explicit maxDuration, Vercel applies a short platform default and can kill
// the function mid-run — a "builds green, request gets killed" failure on a
// core product path. 300s is the Vercel Pro ceiling and matches the
// area-analysis route this handler delegates to.
export const maxDuration = 300;

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

/**
 * Value-equality check for a single tracked field. Most TRACKED_FIELDS are
 * primitives (design_direction, style_name, spatial_layout, ...) or arrays of
 * primitives — for those, reference/strict equality already answers "did it
 * change", and a distinct primitive is never equal, so JSON.stringify is
 * skipped entirely. Only when at least one side is a non-null object/array
 * (e.g. what_it_needs) do we need JSON.stringify to tell "different
 * reference, same content" from "actually changed".
 */
function analysisValueEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  const aIsObj = typeof a === "object" && a !== null;
  const bIsObj = typeof b === "object" && b !== null;
  if (!aIsObj && !bIsObj) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function diffAnalysis(
  oldA: Record<string, unknown>,
  newA: Record<string, unknown>,
): string[] {
  const changed: string[] = [];
  for (const f of TRACKED_FIELDS) {
    if (!analysisValueEqual(oldA?.[f], newA?.[f])) changed.push(f);
  }
  return changed;
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const roomId = request.nextUrl.searchParams.get("room_id");
  if (!roomId) return NextResponse.json({ error: "room_id required" }, { status: 400 });

  // Ownership guard: room_id is client-supplied and the memory-store query is not
  // user-scoped, so without this check any authenticated caller could read
  // another user's refinement chat history (IDOR).
  const getOwnership = await requireRoomOwnership(supabase, roomId, user.id);
  if (getOwnership) return getOwnership;

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

  const limit = checkRateLimit(`area-refine-chat:${user.id}`, RATE_LIMITS.areaAnalysisRefineChat);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many chat requests. Please wait before retrying." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((limit.retryAfterMs || 60000) / 1000)) } },
    );
  }

  const spend = checkDailySpend(user.id);
  if (!spend.allowed) return dailySpendExceededResponse(spend);

  let body: { room_id?: string; content?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { room_id, content } = body;
  if (!room_id || !content || typeof content !== "string" || content.trim().length === 0) {
    return NextResponse.json({ error: "room_id and content required" }, { status: 400 });
  }

  // Ownership guard BEFORE re-running the full (paid) analysis: without it any
  // authenticated caller could append chat + drive the LLM refinement pipeline
  // on another user's room (IDOR + LLM-cost abuse + cross-tenant write).
  const postOwnership = await requireRoomOwnership(supabase, room_id, user.id);
  if (postOwnership) return postOwnership;

  // Independent reads (both keyed only on room_id, no dependency between
  // them) — parallelized to save one DB round-trip per refine turn.
  const [{ data: room }, { data: latestDiagnosis }] = await Promise.all([
    supabase.from("rooms").select("*").eq("id", room_id).single(),
    supabase
      .from("room_diagnoses")
      .select("diagnosis_json")
      .eq("room_id", room_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

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
      { error: "Failed to record message. Please try again." },
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
    //
    // Margin: this is ONE turn of the refine LOOP. Tag the whole re-analysis
    // under the SHARED journey session (room-scoped) with operation
    // "refine-turn" so every turn's calls land on the same supply-chain node —
    // its call count grows per turn, making the multi-turn loop visible. The
    // analysis pipeline's internal phase labels defer to "refine-turn" here (see
    // analysisPhaseOp) instead of decomposing into the initial-diagnosis nodes.
    const analysisResponse = await runWithMarginSession(room_id, "refine-turn", () =>
      runAnalysis(supabase, room_id, room.project_id, {
        forceRefresh: true,
        extraDirection,
      }),
    );
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
    // Margin: the change-summary LLM call is its own node under this turn.
    const { summary, tokens: summaryTokens } = await runWithMarginSession(
      room_id,
      "refine-summary",
      () =>
        summarizeRefineChanges({
          feedback: content,
          priorAnalysis,
          newAnalysis,
          system: getSystemPrompt(profile),
        }),
    );

    const { data: assistantMsg, error: assistantMsgError } = await supabase
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
    // The re-analysis above already persisted a new room_diagnoses row, so the
    // refinement itself SUCCEEDED. If only the summary message failed to persist,
    // be honest without lying either way: don't return the reply as saved (it
    // would vanish on reload — a fake success), and don't throw a 500 (that would
    // hide the already-applied analysis AND trigger an expensive retry that
    // re-runs the full pipeline and duplicates the user message). Return the
    // applied analysis with a null assistant message + a warning instead.
    const warnings: string[] = [];
    if (assistantMsgError || !assistantMsg) {
      console.error(
        "[refine-chat] Failed to persist assistant summary message:",
        assistantMsgError?.message ?? "no row returned",
      );
      warnings.push(
        "Your changes were applied, but the summary reply could not be saved.",
      );
    }

    await completeAgentRun(supabase, agentRun.id, {
      status: "completed",
      output_json: { summary, changed_fields: changedFields },
      tokens_used: summaryTokens,
    });

    return NextResponse.json({
      user_message: userMsg,
      assistant_message: assistantMsg ?? null,
      analysis: newAnalysis,
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
    return NextResponse.json({ error: "Refinement failed. Please try again." }, { status: 500 });
  }
}
