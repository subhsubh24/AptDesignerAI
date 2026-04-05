import { createClient } from "@/lib/supabase/server";
import { runRoomDiagnosis } from "@/lib/agents/room-diagnostician";
import { validateDiagnosis } from "@/lib/agents/diagnosis-validator";
import { createAgentRun, completeAgentRun } from "@/lib/db/agent-runs";
import { buildDesignProfile } from "@/lib/design-context/build-profile";
import { checkRateLimit, RATE_LIMITS } from "@/lib/utils/rate-limiter";
import { sanitizeUserContext } from "@/lib/utils/sanitize-prompt";
import type { AgentContext } from "@/lib/agents/types";

/**
 * SSE streaming diagnosis endpoint.
 * Sends real-time progress events as the diagnosis pipeline executes.
 *
 * Events:
 *   step     — { step, status }        Phase progress updates
 *   done     — { diagnosis }           Final result
 *   error    — { error }               Error message
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const body = await request.json();
  const { room_id } = body;

  if (!room_id || typeof room_id !== "string") {
    return new Response(JSON.stringify({ error: "room_id required" }), { status: 400 });
  }

  // Rate limit
  const limit = checkRateLimit(`diagnosis:${user.id}`, RATE_LIMITS.diagnosis);
  if (!limit.allowed) {
    return new Response(
      JSON.stringify({ error: "Too many diagnosis requests. Please wait a moment." }),
      { status: 429, headers: { "Retry-After": String(Math.ceil((limit.retryAfterMs || 60000) / 1000)) } }
    );
  }

  // Fetch room + images
  const { data: room } = await supabase
    .from("rooms")
    .select("*, room_images(*)")
    .eq("id", room_id)
    .single();

  if (!room) {
    return new Response(JSON.stringify({ error: "Room not found" }), { status: 404 });
  }

  const imageUrls = (room.room_images || []).map((img: { image_url: string }) => img.image_url);
  if (imageUrls.length === 0) {
    return new Response(JSON.stringify({ error: "Upload room photos first" }), { status: 400 });
  }

  // Stream the diagnosis process
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function sendEvent(type: string, data: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`));
      }

      try {
        // Step 1: Loading context
        sendEvent("step", { step: "Loading room context", status: "running" });

        const agentRun = await createAgentRun(supabase, {
          room_id,
          agent_type: "diagnostician",
          input_json: { room_type: room.room_type, image_count: imageUrls.length },
        });

        const { data: project } = await supabase
          .from("projects")
          .select("*")
          .eq("id", room.project_id)
          .single();

        const profile = buildDesignProfile(project);

        // Sanitize user context
        const rawUserContext = room.user_context || undefined;
        const sanitized = rawUserContext ? sanitizeUserContext(rawUserContext) : null;

        // Build cross-room coherence context
        let otherRoomsContext: string | undefined;
        if (project) {
          const { data: otherRooms } = await supabase
            .from("rooms")
            .select("name, room_type")
            .eq("project_id", room.project_id)
            .neq("id", room_id);
          if (otherRooms && otherRooms.length > 0) {
            const { data: otherDiagnoses } = await supabase
              .from("room_diagnoses")
              .select("room_id, design_direction_json");
            const otherRoomSummaries: string[] = [];
            for (const otherRoom of otherRooms) {
              const otherDiag = otherDiagnoses?.find(
                (d: { room_id: string }) => d.room_id === otherRoom.id
              );
              const dd = otherDiag?.design_direction_json as { style_notes?: string; recommended_palette?: string[]; recommended_materials?: string[] } | undefined;
              let summary = `${otherRoom.name} (${otherRoom.room_type})`;
              if (dd?.style_notes) summary += `: ${dd.style_notes}`;
              if (dd?.recommended_palette?.length) summary += ` | Palette: ${dd.recommended_palette.join(", ")}`;
              if (dd?.recommended_materials?.length) summary += ` | Materials: ${dd.recommended_materials.join(", ")}`;
              otherRoomSummaries.push(summary);
            }
            if (otherRoomSummaries.length > 0) {
              otherRoomsContext = `Other rooms in apartment:\n${otherRoomSummaries.join("\n")}`;
            }
          }
        }

        sendEvent("step", { step: "Loading room context", status: "done" });

        // Step 2: Analyzing photos
        sendEvent("step", { step: "Analyzing room photos", status: "running", detail: `Processing ${imageUrls.length} photo(s)` });

        const ctx: AgentContext = {
          roomId: room_id,
          roomType: room.room_type,
          keepItems: room.keep_items || [],
          replaceItems: room.replace_items || [],
          priorities: room.priorities || [],
          budgetMode: room.budget_mode,
          sourcingMode: room.sourcing_mode,
          imageUrls,
          userContext: sanitized?.sanitized || rawUserContext,
          otherRoomsContext,
        };

        // Step 3: Running AI diagnosis
        sendEvent("step", { step: "Running AI diagnosis", status: "running", detail: "Analyzing layout, materials, lighting, and proportions" });

        const result = await runRoomDiagnosis(ctx, profile);

        if (!result.success || !result.data) {
          await completeAgentRun(supabase, agentRun.id, {
            status: "failed",
            error_message: result.error,
          });
          sendEvent("error", { error: result.error || "Diagnosis failed" });
          controller.close();
          return;
        }

        sendEvent("step", { step: "Running AI diagnosis", status: "done" });

        // Step 4: Validating against constraints
        sendEvent("step", { step: "Validating recommendations", status: "running", detail: "Checking against your preferences and constraints" });

        const validation = validateDiagnosis(result.data, ctx.keepItems, ctx.userContext);
        const diagnosisData = validation.patched;

        if (validation.wasModified) {
          sendEvent("step", {
            step: "Validating recommendations",
            status: "done",
            detail: `Auto-corrected ${validation.issues.filter((i) => i.action === "removed").length} constraint violation(s)`,
          });
        } else {
          sendEvent("step", { step: "Validating recommendations", status: "done" });
        }

        // Step 5: Saving results
        sendEvent("step", { step: "Saving diagnosis", status: "running" });

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
          sendEvent("error", { error: saveError.message });
          controller.close();
          return;
        }

        await supabase
          .from("rooms")
          .update({ status: "diagnosed", updated_at: new Date().toISOString() })
          .eq("id", room_id);

        await completeAgentRun(supabase, agentRun.id, {
          status: "completed",
          output_json: {
            ...diagnosisData as unknown as Record<string, unknown>,
            _validation: { issues: validation.issues, wasModified: validation.wasModified },
          },
          tokens_used: result.tokensUsed,
        });

        sendEvent("step", { step: "Saving diagnosis", status: "done" });

        // Final: Send complete result
        sendEvent("done", {
          diagnosis: {
            ...diagnosis,
            _validation: validation.issues.length > 0
              ? { issueCount: validation.issues.length, issues: validation.issues }
              : undefined,
          },
        });
      } catch (err) {
        sendEvent("error", { error: err instanceof Error ? err.message : "Diagnosis failed unexpectedly" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
