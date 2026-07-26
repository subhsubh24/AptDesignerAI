import { createClient } from "@/lib/supabase/server";
import { userOwnsRoom } from "@/lib/auth/ownership";
import { runRoomDiagnosis } from "@/lib/agents/room-diagnostician";
import { assembleRoomSceneGraph } from "@/lib/agents/scene-assembler";
import { validateDiagnosisAsync } from "@/lib/agents/diagnosis-validator";
import { selfReviewDiagnosis } from "@/lib/agents/self-correction";
import { createAgentRun, completeAgentRun } from "@/lib/db/agent-runs";
import { buildDesignProfile } from "@/lib/design-context/build-profile";
import { checkRateLimit, RATE_LIMITS } from "@/lib/utils/rate-limiter";
import { generationLimitFor } from "@/lib/entitlements/generation-limits";
import { hasProSubscriptionWeb } from "@/lib/entitlements/web";
import { checkDailySpend, dailySpendExceededResponse } from "@/lib/utils/spend-limiter";
import { logServerError } from "@/lib/utils/api-error";
import { sanitizeUserContext } from "@/lib/utils/sanitize-prompt";
import { runIdentifiedProductsPipeline } from "@/lib/agents/identified-products-pipeline";
import { getRoomFromFloorPlan } from "@/lib/agents/format-floor-plan";
import { inferUserPreferences } from "@/lib/design-context/infer-preferences";
import { runFullDiagnosisExpansion } from "@/lib/agents/diagnosis-expansion-pipeline";
import { createLogger } from "@/lib/logging/logger";
import type { AgentContext } from "@/lib/agents/types";
import type { DiagnosisData } from "@/lib/types/database";

const log = createLogger("diagnosis-stream-route");

/**
 * SSE streaming diagnosis endpoint.
 * Sends real-time progress events as the diagnosis pipeline executes.
 *
 * Events:
 *   step     — { step, status }        Phase progress updates
 *   done     — { diagnosis }           Final result
 *   error    — { error }               Error message
 */
// Long-running LLM pipeline route. Without an explicit maxDuration, Vercel
// applies a short platform default and can kill the function mid-run — a
// "builds green, request gets killed" failure on a core product path. 300s is
// the Vercel Pro ceiling and covers the documented worst-case pipeline latency.
export const maxDuration = 300;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  let body: { room_id?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
  }
  const { room_id } = body;

  if (!room_id || typeof room_id !== "string") {
    return new Response(JSON.stringify({ error: "room_id required" }), { status: 400 });
  }

  // Rate limit
  // Pro subscribers get the wider generation allowance the pricing page sells
  // ("Higher AI generation limits"). Gated on the PRO SUBSCRIPTION specifically,
  // not on "has paid" — the one-time Apartment tier does not list this benefit.
  // One indexed row read in front of a multi-second LLM call; free users keep
  // exactly the limit they had.
  const isPro = await hasProSubscriptionWeb(user.id);
  const limit = checkRateLimit(`diagnosis:${user.id}`, generationLimitFor(RATE_LIMITS.diagnosis, isPro));
  if (!limit.allowed) {
    return new Response(
      JSON.stringify({ error: "Too many diagnosis requests. Please wait a moment." }),
      { status: 429, headers: { "Retry-After": String(Math.ceil((limit.retryAfterMs || 60000) / 1000)) } }
    );
  }

  const spend = checkDailySpend(user.id);
  if (!spend.allowed) return dailySpendExceededResponse(spend);

  // Ownership guard BEFORE the (paid) diagnosis pipeline: room_id is
  // client-supplied and the memory-store read is not user-scoped, so without
  // this check any authenticated caller could run diagnosis on — and write a
  // diagnosis row into — another user's room (IDOR + LLM-cost abuse).
  if (!(await userOwnsRoom(supabase, room_id, user.id))) {
    return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
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
      let streamClosed = false;
      function sendEvent(type: string, data: Record<string, unknown>) {
        if (streamClosed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // Client disconnected mid-stream — the controller is already closed.
          // Stop emitting so a later sendEvent (e.g. in the catch/finally) can't
          // throw a second, uncaught "Controller is already closed" error.
          streamClosed = true;
        }
      }
      function closeStream() {
        if (streamClosed) return;
        streamClosed = true;
        try {
          controller.close();
        } catch {
          // Already closed by a client disconnect — nothing to do.
        }
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

        // Infer user preferences (parity with non-stream route).
        const inferredPreferences = await inferUserPreferences(
          supabase,
          room.project_id,
          room_id,
        ).catch(() => null);
        if (profile && inferredPreferences) {
          profile.inferredPreferences = inferredPreferences;
        }

        // Extract floor plan data so the diagnosis prompt and expansion both
        // ground on the same spatial truth.
        const br = project?.building_research as Record<string, unknown> | undefined;
        const floorPlanImageUrl = br?.floor_plan_image_url as string | undefined;
        const extractedFloorPlan = br?.extracted_floor_plan as
          | import("@/lib/types/database").ExtractedFloorPlan
          | undefined;

        // Sanitize user context
        const rawUserContext = room.user_context || undefined;
        const sanitized = rawUserContext ? sanitizeUserContext(rawUserContext) : null;

        // Build cross-room coherence context
        let otherRoomsContext: string | undefined;
        if (project) {
          const { data: otherRooms } = await supabase
            .from("rooms")
            .select("id, name, room_type")
            .eq("project_id", room.project_id)
            .neq("id", room_id);
          if (otherRooms && otherRooms.length > 0) {
            // 90-day freshness window — stale sibling palettes from months ago
            // pull the current direction toward preferences the user has since
            // evolved past.
            const staleCutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
            const { data: otherDiagnoses } = await supabase
              .from("room_diagnoses")
              .select("room_id, design_direction_json, created_at")
              .in("room_id", (otherRooms as Array<{ id: string }>).map((r) => r.id))
              .gte("created_at", staleCutoff);
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
          floorPlanImageUrl,
          extractedFloorPlan,
        };

        // Multi-view scene assembly — runs concurrently with diagnosis (both
        // read the same photos). Best-effort; awaited just before the insert.
        const sceneGraphPromise = assembleRoomSceneGraph(ctx).catch((err) => {
          log.warn("scene assembly threw — continuing without scene graph", { room_id, error: String(err) });
          return { success: false as const, error: String(err) };
        });

        // Step 3: Running AI diagnosis
        sendEvent("step", { step: "Running AI diagnosis", status: "running", detail: "Analyzing layout, materials, lighting, and proportions" });

        const result = await runRoomDiagnosis(ctx, profile);

        if (!result.success || !result.data) {
          await completeAgentRun(supabase, agentRun.id, {
            status: "failed",
            error_message: result.error,
          });
          sendEvent("error", { error: result.error || "Diagnosis failed" });
          closeStream();
          return;
        }

        sendEvent("step", { step: "Running AI diagnosis", status: "done" });

        // Step 3b: Self-review — LLM checks its own output
        sendEvent("step", { step: "Self-reviewing diagnosis", status: "running", detail: "Checking for logical consistency" });
        {
          const selfReview = await selfReviewDiagnosis(
            result.data.diagnosis as unknown as Record<string, unknown>,
            result.data.design_direction as unknown as Record<string, unknown>,
            ctx.roomType,
          );
          if (selfReview.wasCorrepted) {
            result.data.diagnosis = selfReview.output.diagnosis as unknown as typeof result.data.diagnosis;
            result.data.design_direction = selfReview.output.designDirection as unknown as typeof result.data.design_direction;
            sendEvent("step", { step: "Self-reviewing diagnosis", status: "done", detail: `Self-corrected ${selfReview.correctionRounds} issue(s)` });
          } else {
            sendEvent("step", { step: "Self-reviewing diagnosis", status: "done" });
          }
        }

        // Step 4: Validating against constraints
        sendEvent("step", { step: "Validating recommendations", status: "running", detail: "Checking against your preferences and constraints" });

        const validation = await validateDiagnosisAsync(result.data, ctx.keepItems, ctx.userContext);
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

        // Step 5a: Identified products (opt-in, best-effort)
        let identifiedProductsTokens = 0;
        let diagnosisJsonToSave: DiagnosisData = diagnosisData.diagnosis;
        if (process.env.IDENTIFY_PRODUCTS === "1") {
          sendEvent("step", { step: "Identifying products in photos", status: "running" });
          try {
            const dd = diagnosisData.design_direction as {
              recommended_palette?: string[];
              recommended_materials?: string[];
              style_notes?: string;
            } | undefined;
            const hintParts: string[] = [];
            if (dd?.style_notes) hintParts.push(dd.style_notes);
            if (dd?.recommended_palette?.length) hintParts.push(`palette: ${dd.recommended_palette.slice(0, 6).join(", ")}`);
            if (dd?.recommended_materials?.length) hintParts.push(`materials: ${dd.recommended_materials.slice(0, 6).join(", ")}`);
            const aestheticHint = hintParts.length ? hintParts.join(" | ") : undefined;
            const identRoom = getRoomFromFloorPlan(ctx.extractedFloorPlan, ctx.roomType);
            const identResult = await runIdentifiedProductsPipeline({
              supabase,
              imageUrls,
              roomType: ctx.roomType,
              aestheticHint,
              budgetMode: ctx.budgetMode,
              roomDimensions: identRoom?.dimensions_text
                ?? (identRoom?.sqft ? `~${identRoom.sqft} sqft` : undefined),
            });
            if (identResult.success && identResult.data) {
              diagnosisJsonToSave = {
                ...diagnosisData.diagnosis,
                identified_products: identResult.data.identified_products,
              };
              identifiedProductsTokens = identResult.tokensUsed ?? 0;
            }
          } catch (err) {
            log.warn("identified-products pipeline threw — continuing", { room_id, error: err instanceof Error ? err.message : String(err) });
          }
          sendEvent("step", { step: "Identifying products in photos", status: "done" });
        }

        // Step 5b: Greedy expansion (parity with non-stream route)
        sendEvent("step", { step: "Expanding action list", status: "running" });
        const expansion = await runFullDiagnosisExpansion({
          supabase,
          roomId: room_id,
          projectId: room.project_id,
          roomType: ctx.roomType,
          budgetMode: ctx.budgetMode as import("@/lib/types/database").BudgetMode,
          priorities: ctx.priorities,
          baselineActionList: diagnosisData.action_list ?? [],
          designDirection: diagnosisData.design_direction ?? null,
          roomPhotos: imageUrls,
          floorPlanImageUrl: ctx.floorPlanImageUrl ?? null,
          extractedFloorPlan: ctx.extractedFloorPlan,
          preferences: inferredPreferences,
        });
        sendEvent("step", { step: "Expanding action list", status: "done", detail: `Added ${expansion.expandedActionList.length - (diagnosisData.action_list?.length ?? 0)} item(s)` });

        // Resolve concurrent scene assembly (best-effort — null on failure).
        const sceneResult = await sceneGraphPromise;
        const sceneGraph = sceneResult.success && "data" in sceneResult ? sceneResult.data ?? null : null;
        const sceneGraphTokens = sceneResult.success && "tokensUsed" in sceneResult ? sceneResult.tokensUsed ?? 0 : 0;
        if (sceneGraph) {
          sendEvent("step", {
            step: "Understanding the whole space",
            status: "done",
            detail: `Pieced together ${sceneGraph.source_image_urls.length} photos → ${sceneGraph.objects.length} objects${sceneGraph.coverage.gaps.length ? `, ${sceneGraph.coverage.gaps.length} unseen area(s)` : ""}`,
          });
        }

        // Step 6: Saving results
        sendEvent("step", { step: "Saving diagnosis", status: "running" });

        const { data: diagnosis, error: saveError } = await supabase
          .from("room_diagnoses")
          .insert({
            room_id,
            diagnosis_json: diagnosisJsonToSave,
            design_direction_json: diagnosisData.design_direction,
            missing_categories: [...new Set(expansion.expandedActionList.map((i) => i.category))],
            action_list: expansion.expandedActionList,
            model_used: result.model,
            expansion_log: expansion.expansionLog,
            scene_graph_json: sceneGraph,
            room_type: room.room_type ?? null,
            action_list_count: expansion.expandedActionList.length,
          })
          .select()
          .single();

        if (saveError) {
          logServerError("diagnosis/stream save", saveError);
          sendEvent("error", { error: "Unable to save the diagnosis. Please try again." });
          closeStream();
          return;
        }

        const { error: statusError } = await supabase
          .from("rooms")
          .update({ status: "diagnosed", updated_at: new Date().toISOString() })
          .eq("id", room_id);

        // The diagnosis itself is already persisted (saveError handled above), so a
        // failed status flip is non-fatal — but swallowing it silently leaves the row
        // out of sync with reads that filter on status = "diagnosed". Surface it loudly.
        if (statusError) {
          logServerError("diagnosis/stream room status update", statusError);
        }

        await completeAgentRun(supabase, agentRun.id, {
          status: "completed",
          output_json: {
            ...diagnosisData as unknown as Record<string, unknown>,
            _validation: { issues: validation.issues, wasModified: validation.wasModified },
          },
          tokens_used: (result.tokensUsed ?? 0) + identifiedProductsTokens + sceneGraphTokens,
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
        logServerError("diagnosis/stream", err);
        sendEvent("error", { error: "Diagnosis failed unexpectedly. Please try again." });
      } finally {
        closeStream();
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
