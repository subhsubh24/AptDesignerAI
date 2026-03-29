import { createClient } from "@/lib/supabase/server";
import { runAgenticSearch } from "@/lib/agents/orchestrator";
import { createAgentRun, completeAgentRun } from "@/lib/db/agent-runs";
import { buildDesignProfile } from "@/lib/design-context/build-profile";
import { loadUserFeedbackContext } from "@/lib/agents/user-feedback";
import type { AgentContext } from "@/lib/agents/types";

/**
 * SSE streaming search endpoint.
 * Sends real-time progress events as the 6-phase search funnel executes.
 *
 * Events:
 *   step   — { step, status, data? }  Phase progress updates
 *   stats  — { ...stats }             Running stats (counts)
 *   done   — { products_found, stats, validation }  Final result
 *   error  — { error }                Error message
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const body = await request.json();
  const { room_id, categories } = body;

  if (!room_id) {
    return new Response(JSON.stringify({ error: "room_id required" }), { status: 400 });
  }

  // Fetch room
  const { data: room } = await supabase
    .from("rooms")
    .select("*, room_images(*)")
    .eq("id", room_id)
    .single();

  if (!room) {
    return new Response(JSON.stringify({ error: "Room not found" }), { status: 404 });
  }

  // Fetch project for full building/apartment context
  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", room.project_id)
    .single();

  // Fetch room diagnosis for design direction
  const { data: diagnosis } = await supabase
    .from("room_diagnoses")
    .select("*")
    .eq("room_id", room_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  const designProfile = buildDesignProfile(project);

  // Create search session
  const { data: session } = await supabase
    .from("search_sessions")
    .insert({
      room_id,
      mode: "agentic",
      categories_to_search: categories,
    })
    .select()
    .single();

  // Create agent run
  const agentRun = await createAgentRun(supabase, {
    room_id,
    search_session_id: session?.id,
    agent_type: "researcher",
    input_json: { categories },
  });

  const imageUrls = (room.room_images || []).map((img: { image_url: string }) => img.image_url);

  // Load cross-session user feedback (accepted/rejected products)
  const userFeedbackContext = await loadUserFeedbackContext(supabase, room_id, room.project_id);

  // Extract spatial context from diagnosis and building research
  const diagnosisJson = diagnosis?.diagnosis_json as Record<string, unknown> | undefined;
  const spatialLayout = diagnosisJson?.spatial_layout as string | undefined;

  // Build placement map from what_it_needs items
  const placementMap: Record<string, string> = {};
  const whatItNeedsRaw = diagnosisJson?.what_it_needs as Array<{
    category?: string;
    search_title?: string;
    description?: string;
    priority?: "high" | "medium" | "low";
    specs?: string;
    placement?: string;
  }> | undefined;
  if (whatItNeedsRaw) {
    for (const item of whatItNeedsRaw) {
      if (item.category && item.placement) {
        placementMap[item.category] = item.placement;
      }
    }
  }

  // Extract structured area-analysis outputs
  const roomSummary = diagnosisJson?.summary as string | undefined;
  const whatItNeeds = whatItNeedsRaw?.map((item) => ({
    category: item.category || "unknown",
    search_title: item.search_title,
    description: item.description,
    priority: item.priority,
    specs: item.specs,
    placement: item.placement,
  }));
  const whatWorks = diagnosisJson?.what_works as string[] | undefined;
  const whatShouldGo = diagnosisJson?.what_should_go as string[] | undefined;

  // Extract floor plan from building research
  const floorPlan = (project?.building_research as Record<string, unknown> | undefined)?.floor_plan as Record<string, unknown> | undefined;

  // Extract environmental context from diagnosis
  const lightingConditions = diagnosisJson?.lighting_conditions as string | undefined;
  const windowDoorPositions = diagnosisJson?.window_door_positions as string | undefined;
  const outletPositions = diagnosisJson?.outlet_positions as string | undefined;

  // Build other-rooms context for cross-room coherence
  let otherRoomsContext: string | undefined;
  if (project) {
    const { data: otherRooms } = await supabase
      .from("rooms")
      .select("name, room_type")
      .eq("project_id", room.project_id)
      .neq("id", room_id);
    if (otherRooms && otherRooms.length > 0) {
      // Get diagnoses for other rooms that have been analyzed
      const { data: otherDiagnoses } = await supabase
        .from("room_diagnoses")
        .select("room_id, design_direction_json");
      const otherRoomSummaries: string[] = [];
      for (const otherRoom of otherRooms) {
        const otherDiag = otherDiagnoses?.find(
          (d: { room_id: string }) => d.room_id === otherRoom.id
        );
        const dd = otherDiag?.design_direction_json as { style_notes?: string } | undefined;
        otherRoomSummaries.push(
          `${otherRoom.name} (${otherRoom.room_type})${dd?.style_notes ? `: ${dd.style_notes}` : ""}`
        );
      }
      if (otherRoomSummaries.length > 0) {
        otherRoomsContext = `Other rooms in apartment:\n${otherRoomSummaries.join("\n")}`;
      }
    }
  }

  const ctx: AgentContext = {
    roomId: room_id,
    roomType: room.room_type,
    roomName: room.name || undefined,
    keepItems: room.keep_items || [],
    replaceItems: room.replace_items || [],
    priorities: room.priorities || [],
    budgetMode: room.budget_mode,
    sourcingMode: room.sourcing_mode,
    imageUrls,
    designProfile,
    diagnosis: diagnosis?.diagnosis_json || undefined,
    designDirection: diagnosis?.design_direction_json || undefined,
    roomSummary: roomSummary || undefined,
    whatItNeeds: whatItNeeds && whatItNeeds.length > 0 ? whatItNeeds : undefined,
    whatWorks: whatWorks && whatWorks.length > 0 ? whatWorks : undefined,
    whatShouldGo: whatShouldGo && whatShouldGo.length > 0 ? whatShouldGo : undefined,
    userFeedbackContext: userFeedbackContext || undefined,
    userContext: (room.user_context as string) || undefined,
    otherRoomsContext: otherRoomsContext || undefined,
    spatialLayout: spatialLayout || undefined,
    placementMap: Object.keys(placementMap).length > 0 ? placementMap : undefined,
    floorPlan: floorPlan || undefined,
    lightingConditions: lightingConditions || undefined,
    windowDoorPositions: windowDoorPositions || undefined,
    outletPositions: outletPositions || undefined,
  };

  // Categories can be strings or rich objects { category, search_title, specs }
  const rawCategories = categories && categories.length > 0
    ? categories
    : ["rug", "coffee_table", "accent_chair"];

  const missingCategories: string[] = rawCategories.map(
    (c: string | { category: string }) => typeof c === "string" ? c : c.category
  );

  // Build search hints from rich category objects
  const categoryHints: Record<string, string> = {};
  if (Array.isArray(categories)) {
    for (const c of categories) {
      if (typeof c === "object" && c.category) {
        const parts: string[] = [];
        if (c.search_title) parts.push(c.search_title);
        if (c.specs) parts.push(typeof c.specs === "string" ? c.specs : JSON.stringify(c.specs));
        if (parts.length > 0) categoryHints[c.category] = parts.join(" — ");
      }
    }
  }

  // Inject floor plan context
  if (project?.building_research) {
    const br = project.building_research as Record<string, unknown>;
    const fp = br.floor_plan as Record<string, unknown> | undefined;
    if (fp) {
      const dims = fp.room_dimensions as Record<string, string> | undefined;
      const roomDim = dims?.[room.room_type] || dims?.living_room;
      const spatialNotes = Array.isArray(fp.notable_spatial_features)
        ? fp.notable_spatial_features.join(", ")
        : "";
      const floorPlanHint = [
        roomDim ? `Room dimensions: ~${roomDim}` : "",
        fp.total_sqft ? `Apartment: ~${fp.total_sqft} sqft` : "",
        fp.living_dining_combined ? "Combined living/dining space" : "",
        spatialNotes ? `Layout notes: ${spatialNotes}` : "",
      ].filter(Boolean).join(". ");

      if (floorPlanHint) {
        categoryHints["_floor_plan"] = floorPlanHint;
      }
    }
  }

  // Set up SSE stream
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(event: string, data: unknown) {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // Stream closed
        }
      }

      try {
        const result = await runAgenticSearch(
          ctx,
          missingCategories,
          (step) => {
            // Send step progress events in real-time
            send("step", step);
          },
          categoryHints
        );

        if (!result.success || !result.data) {
          send("error", { error: result.error || "Search failed" });
          await completeAgentRun(supabase, agentRun.id, {
            status: "failed",
            error_message: result.error,
          });
          controller.close();
          return;
        }

        // Save products to DB — batch inserts instead of N+1
        send("step", { step: "Saving results", status: "running" });

        const allProducts = Object.values(result.data.candidatesByCategory).flat();
        const productRows = allProducts.map((product) => ({
          room_id,
          search_session_id: session?.id,
          title: product.title,
          category: product.category,
          retailer: product.retailer,
          product_url: product.product_url,
          image_url: product.image_url,
          price: product.price,
          dimensions: product.dimensions,
          materials: product.materials,
          colors: product.colors,
          description: product.description,
          source_type: "agentic_search" as const,
          metadata: product.metadata,
        }));

        const { data: savedProducts, error: insertError } = await (supabase
          .from("candidate_products")
          .insert(productRows)
          .select() as unknown as Promise<{ data: { id: string }[] | null; error: { message: string } | null }>);

        if (insertError) {
          console.error("[search/stream] Failed to insert products:", insertError.message);
        }

        // Batch insert evaluations
        if (savedProducts && savedProducts.length > 0) {
          const evalRows: Record<string, unknown>[] = [];
          const evaluatedIds: string[] = [];

          for (let i = 0; i < savedProducts.length; i++) {
            const saved = savedProducts[i];
            const original = allProducts[i];
            const evaluation = result.data.evaluations.get(original.id);
            if (evaluation) {
              evalRows.push({
                product_id: saved.id,
                room_id,
                ...evaluation.scores,
                final_item_score: evaluation.final_item_score,
                verdict: evaluation.verdict,
                reasoning: evaluation.reasoning,
              });
              evaluatedIds.push(saved.id);
            }
          }

          if (evalRows.length > 0) {
            await supabase.from("product_evaluations").insert(evalRows);
            await supabase
              .from("candidate_products")
              .update({ status: "evaluated" })
              .in("id", evaluatedIds);
          }
        }

        // Update search session — persist trace summary for post-run debugging
        await supabase
          .from("search_sessions")
          .update({
            status: "completed",
            updated_at: new Date().toISOString(),
            metadata: {
              trace_summary: result.data.trace?.summary || null,
              tokens_used: result.data.stats.tokensUsed,
            },
          })
          .eq("id", session?.id);

        // Update room status
        await supabase
          .from("rooms")
          .update({ status: "sourcing", updated_at: new Date().toISOString() })
          .eq("id", room_id);

        const productCount = savedProducts?.length || 0;

        await completeAgentRun(supabase, agentRun.id, {
          status: "completed",
          output_json: {
            products_found: productCount,
            categories_searched: Object.keys(result.data.candidatesByCategory),
            steps_count: result.data.steps.length,
            trace_summary: result.data.trace?.summary || null,
          },
          tokens_used: result.data.stats.tokensUsed,
        });

        // Send final result
        send("done", {
          session_id: session?.id,
          products_found: productCount,
          stats: result.data.stats,
          validation: result.data.validation,
        });
      } catch (err) {
        send("error", { error: err instanceof Error ? err.message : "Search failed" });
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
