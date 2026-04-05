import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { runRoomDiagnosis } from "@/lib/agents/room-diagnostician";
import { validateDiagnosis } from "@/lib/agents/diagnosis-validator";
import { createAgentRun, completeAgentRun } from "@/lib/db/agent-runs";
import { buildDesignProfile } from "@/lib/design-context/build-profile";
import type { AgentContext } from "@/lib/agents/types";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { room_id } = body;
  if (!room_id) return NextResponse.json({ error: "room_id required" }, { status: 400 });

  // Fetch room + images
  const { data: room } = await supabase
    .from("rooms")
    .select("*, room_images(*)")
    .eq("id", room_id)
    .single();

  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

  const imageUrls = (room.room_images || []).map((img: { image_url: string }) => img.image_url);
  if (imageUrls.length === 0) {
    return NextResponse.json({ error: "Upload room photos first" }, { status: 400 });
  }

  // Create agent run for logging
  const agentRun = await createAgentRun(supabase, {
    room_id,
    agent_type: "diagnostician",
    input_json: { room_type: room.room_type, image_count: imageUrls.length },
  });

  // Load project for design profile context
  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", room.project_id)
    .single();

  const profile = buildDesignProfile(project);

  // Build context and run diagnosis
  const ctx: AgentContext = {
    roomId: room_id,
    roomType: room.room_type,
    keepItems: room.keep_items || [],
    replaceItems: room.replace_items || [],
    priorities: room.priorities || [],
    budgetMode: room.budget_mode,
    sourcingMode: room.sourcing_mode,
    imageUrls,
    userContext: room.user_context || undefined,
  };

  const result = await runRoomDiagnosis(ctx, profile);

  if (!result.success || !result.data) {
    await completeAgentRun(supabase, agentRun.id, {
      status: "failed",
      error_message: result.error,
    });
    return NextResponse.json({ error: result.error || "Diagnosis failed" }, { status: 500 });
  }

  // Validate diagnosis against user constraints (exclusions, keep items, explicit requests)
  const validation = validateDiagnosis(
    result.data,
    ctx.keepItems,
    ctx.userContext
  );

  // Use the patched version (violations auto-corrected)
  const diagnosisData = validation.patched;

  // Save diagnosis
  const { data: diagnosis, error: saveError } = await supabase
    .from("room_diagnoses")
    .insert({
      room_id,
      diagnosis_json: diagnosisData.diagnosis,
      design_direction_json: diagnosisData.design_direction,
      missing_categories: diagnosisData.missing_categories,
      action_list: diagnosisData.action_list,
      model_used: result.model,
    })
    .select()
    .single();

  if (saveError) {
    return NextResponse.json({ error: saveError.message }, { status: 500 });
  }

  // Update room status
  await supabase
    .from("rooms")
    .update({ status: "diagnosed", updated_at: new Date().toISOString() })
    .eq("id", room_id);

  // Complete agent run
  await completeAgentRun(supabase, agentRun.id, {
    status: "completed",
    output_json: {
      ...diagnosisData as unknown as Record<string, unknown>,
      _validation: {
        issues: validation.issues,
        wasModified: validation.wasModified,
      },
    },
    tokens_used: result.tokensUsed,
  });

  return NextResponse.json({
    ...diagnosis,
    _validation: validation.issues.length > 0
      ? { issueCount: validation.issues.length, issues: validation.issues }
      : undefined,
  }, { status: 201 });
}
