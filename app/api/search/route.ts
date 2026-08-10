import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { runAgenticSearch } from "@/lib/agents/orchestrator";
import { createAgentRun, completeAgentRun } from "@/lib/db/agent-runs";
import { buildDesignProfile } from "@/lib/design-context/build-profile";
import { loadUserFeedbackContext } from "@/lib/agents/user-feedback";
import type { AgentContext } from "@/lib/agents/types";
import { buildIdentifiedPiecesBlock } from "@/lib/prompts/product-identification";
import { formatSceneGraphForPrompt } from "@/lib/agents/scene-reconciliation";
import type { IdentifiedProduct } from "@/lib/types/database";
import { verifyTopSearchCandidates } from "@/lib/agents/computer-use/verify-search-candidates";
import { checkRateLimit, RATE_LIMITS } from "@/lib/utils/rate-limiter";
import { checkDailySpend, dailySpendExceededResponse } from "@/lib/utils/spend-limiter";
import { apiError, logServerError } from "@/lib/utils/api-error";
import { userOwnsRoom } from "@/lib/auth/ownership";
import { lookupRoomDimension } from "@/lib/floor-plan/room-dimensions";
import { getMeter } from "@/lib/observability/margin-meter";
import { runWithMarginSession } from "@/lib/observability/margin-context";
import { normalizeMissingCategories } from "@/lib/utils/category-normalization";

// Long-running LLM pipeline route. Without an explicit maxDuration, Vercel
// applies a short platform default and can kill the function mid-run — a
// "builds green, request gets killed" failure on a core product path. 300s is
// the Vercel Pro ceiling and covers the documented worst-case pipeline latency.
export const maxDuration = 300;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limit = checkRateLimit(`search:${user.id}`, RATE_LIMITS.search);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many search requests. Please wait a moment." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((limit.retryAfterMs || 60000) / 1000)) } },
    );
  }

  const spend = checkDailySpend(user.id);
  if (!spend.allowed) return dailySpendExceededResponse(spend);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { room_id, categories, fillAllTiers } = body;

  if (!room_id) return NextResponse.json({ error: "room_id required" }, { status: 400 });
  if (!(await userOwnsRoom(supabase, room_id, user.id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Fetch room with images
  const { data: room, error: roomError } = await supabase
    .from("rooms")
    .select("*, room_images(*)")
    .eq("id", room_id)
    .single();

  if (!room) {
    // userOwnsRoom already confirmed the room exists moments ago, so a miss
    // here on a non-"zero rows" error is a real DB failure, not a genuine
    // not-found — surface it as one so it isn't silently misreported.
    if (roomError && roomError.code !== "PGRST116") {
      return apiError("search.room", roomError);
    }
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  // Project (keyed on room.project_id) and the latest room diagnosis (keyed on
  // room_id) are independent of each other — fetch them in parallel to save a
  // round trip on this hot search entry point. Results are destructured by
  // position, not completion order, so ordering stays deterministic. Both are
  // consumed with optional chaining below (a room may legitimately have no
  // diagnosis yet), so a fetch error here doesn't fail the request — but a
  // real DB error (not "zero rows") is still logged, not silently swallowed.
  const [{ data: project, error: projectError }, { data: diagnosis, error: diagnosisError }] = await Promise.all([
    // Fetch project for full building/apartment context
    supabase.from("projects").select("*").eq("id", room.project_id).single(),
    // Fetch room diagnosis for design direction + what's working/not working
    supabase
      .from("room_diagnoses")
      .select("*")
      .eq("room_id", room_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single(),
  ]);
  if (projectError && projectError.code !== "PGRST116") {
    logServerError("search.project", projectError);
  }
  if (diagnosisError && diagnosisError.code !== "PGRST116") {
    logServerError("search.diagnosis", diagnosisError);
  }

  // Create search session
  const { data: session, error: sessionError } = await supabase
    .from("search_sessions")
    .insert({
      room_id,
      mode: "agentic",
      categories_to_search: categories,
    })
    .select()
    .single();
  // Surface (don't swallow) a failed session insert: a null `session` makes every
  // downstream `session?.id` undefined, so the end-of-run `.eq("id", undefined)`
  // update matches nothing and the session is never marked completed — an orphaned,
  // silently-inconsistent audit trail. Log loudly so it's diagnosable; the search
  // still degrades gracefully via the optional chaining below.
  if (sessionError) {
    console.error("[search] Failed to create search session:", sessionError.message);
  }

  // Create agent run
  const agentRun = await createAgentRun(supabase, {
    room_id,
    search_session_id: session?.id,
    agent_type: "researcher",
    input_json: { categories },
  });

  const imageUrls = (room.room_images || []).map((img: { image_url: string }) => img.image_url);

  // Build full design profile from project data
  const designProfile = buildDesignProfile(project);

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

  // Extract floor plan data from building research
  const _br = project?.building_research as Record<string, unknown> | undefined;
  const floorPlan = _br?.floor_plan as Record<string, unknown> | undefined;
  const floorPlanImageUrl = _br?.floor_plan_image_url as string | undefined;
  const extractedFloorPlan = _br?.extracted_floor_plan as import("@/lib/types/database").ExtractedFloorPlan | undefined;

  // Extract environmental context from diagnosis
  const lightingConditions = diagnosisJson?.lighting_conditions as string | undefined;
  const windowDoorPositions = diagnosisJson?.window_door_positions as string | undefined;
  const outletPositions = diagnosisJson?.outlet_positions as string | undefined;

  // Furniture identification — pre-formatted anti-query + scale block for the
  // search + evaluate agents. Empty string when no usable identifications, so
  // the downstream prompts stay byte-for-byte equivalent for pre-feature rows.
  const identifiedProducts = (diagnosisJson?.identified_products as IdentifiedProduct[] | undefined) ?? [];
  // Multi-view scene graph: a deduped inventory of what's already in the room
  // (one entry per real object, reconciled across all angles). Folded into the
  // same context channel so search agents see the full existing-furniture
  // picture and don't re-suggest what's there. Empty when no graph → byte-equivalent.
  const sceneGraph = (diagnosis?.scene_graph_json as import("@/lib/types/database").RoomSceneGraph | null | undefined) ?? null;
  const sceneInventory = formatSceneGraphForPrompt(sceneGraph);
  const identifiedContext = [buildIdentifiedPiecesBlock(identifiedProducts), sceneInventory]
    .filter(Boolean)
    .join("\n\n");
  // Category blocklist — don't re-suggest something the user already owns.
  const identifiedCategories = new Set(
    identifiedProducts
      .filter((p) => p.verified && p.user_confirmed !== false)
      .map((p) => p.category.toLowerCase()),
  );

  // Build other-rooms context for cross-room coherence
  let otherRoomsContext: string | undefined;
  if (project) {
    const { data: otherRooms } = await supabase
      .from("rooms")
      .select("id, name, room_type")
      .eq("project_id", room.project_id)
      .neq("id", room_id);
    if (otherRooms && otherRooms.length > 0) {
      // 90-day freshness window — stale sibling palettes from months ago pull
      // the current search brief toward preferences the user no longer holds.
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

  // Load recommendation mockups for visual validation during scoring
  let recommendationMockups: Record<string, { imageUrl: string; prompt: string }> | undefined;
  {
    const { data: recRuns } = await supabase
      .from("agent_runs")
      .select("output_json")
      .eq("room_id", room_id)
      .eq("agent_type", "mockup_recommendation")
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(20);
    if (recRuns && recRuns.length > 0) {
      const map: Record<string, { imageUrl: string; prompt: string }> = {};
      for (const run of recRuns) {
        const out = run.output_json as { category?: string; image_url?: string; prompt?: string } | null;
        if (out?.category && out.image_url && out.prompt && !map[out.category]) {
          map[out.category] = { imageUrl: out.image_url, prompt: out.prompt };
        }
      }
      if (Object.keys(map).length > 0) recommendationMockups = map;
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
    floorPlanImageUrl: floorPlanImageUrl || undefined,
    extractedFloorPlan: extractedFloorPlan || undefined,
    lightingConditions: lightingConditions || undefined,
    windowDoorPositions: windowDoorPositions || undefined,
    outletPositions: outletPositions || undefined,
    identifiedContext: identifiedContext || undefined,
    fillAllTiers: fillAllTiers !== false,
    recommendationMockups,
  };

  // Categories can be strings or rich objects { category, search_title, specs }
  const rawCategories = categories && categories.length > 0
    ? categories
    : ["rug", "coffee_table", "accent_chair"];

  // Drop categories already covered by verified, user-confirmed identifications —
  // the identifiedContext tells the model WHY, this just avoids wasted queries.
  // Also drops malformed entries (e.g. a rich object with no `category` string)
  // instead of crashing on them.
  const missingCategories: string[] = normalizeMissingCategories(rawCategories, identifiedCategories);

  if (identifiedCategories.size > 0) {
    console.log(
      `[search] Skipping ${identifiedCategories.size} categor${identifiedCategories.size === 1 ? "y" : "ies"} covered by identified pieces: ${Array.from(identifiedCategories).join(", ")}`,
    );
  }

  // Build search hints from rich category objects (search_title, specs)
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

  // Inject floor plan context into category hints so search queries include correct sizing
  if (project?.building_research) {
    const br = project.building_research as Record<string, unknown>;
    const fp = br.floor_plan as Record<string, unknown> | undefined;
    if (fp) {
      const dims = fp.room_dimensions as Record<string, string> | undefined;
      // Exact room only — see lib/floor-plan/room-dimensions. Falling back to
      // the living room here shipped its size as this room's sizing constraint.
      const roomDim = lookupRoomDimension(dims, room.room_type);
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

  console.log(`[search] Starting agentic search for categories: ${missingCategories.join(", ")}`);

  // Margin: open this journey run's SHARED session (room-scoped) and tag the
  // whole agentic search under the "search" step. Sub-agents (fit-scoring,
  // rerank, product-research, product-verify) override the operation via
  // withMarginOperation while inheriting this session, so the search workflow
  // decomposes into its supply-chain nodes.
  const result = await runWithMarginSession(room_id, "search", () =>
    runAgenticSearch(ctx, missingCategories, undefined, categoryHints),
  );

  // Record the search OUTCOME (the unit of productivity) to Margin so it can
  // compute cost-per-outcome. AWAITED (not floated) so it completes before this
  // serverless function freezes on response; fail-safe: getMeter() is null in
  // CI/tests and without a key, and the emit's error is swallowed (telemetry must
  // never break search). qualityScore normalizes confidence (0-10) to 0-1.
  await getMeter()?.recordOutcome({
    workflowId: "aptdesigner-search",
    passed: result.data?.validation?.isValid ?? false,
    qualityScore: (result.data?.validation?.confidence ?? 0) / 10,
    qualityMethod: "llm_judge",
  })?.catch(() => {});

  if (!result.success || !result.data) {
    console.error("[search] Failed:", result.error);
    await completeAgentRun(supabase, agentRun.id, {
      status: "failed",
      error_message: result.error,
    });
    return NextResponse.json({ error: result.error || "Search failed" }, { status: 500 });
  }

  console.log(`[search] Complete. Found ${Object.values(result.data.candidatesByCategory).flat().length} products`);

  // Ground-truth the top candidate per category via Computer Use before
  // we persist. No-op when Browserbase isn't configured, otherwise merges
  // live price / stock / dimensions into the winning rows so the bundle
  // reflects what's actually on the retailer page right now.
  const verification = await runWithMarginSession(room_id, "product-verify-live", () =>
    verifyTopSearchCandidates(
      result.data!.candidatesByCategory,
      result.data!.evaluations,
      session?.id,
    ),
  );
  if (verification.attempted > 0) {
    console.log(
      `[search] Product verification: ${verification.succeeded}/${verification.attempted} succeeded (${verification.cacheHits} from cache)`,
    );
  }

  // Save all discovered products to DB — batch inserts instead of N+1
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

  // This is the PRIMARY persistence of the search result. supabase-js returns
  // DB errors in-band (no throw), so an unchecked failure here drops every
  // product on the floor while the response below still reports HTTP 200 with
  // products_found: 0 — indistinguishable to the client from a genuine
  // "found nothing" after the full (expensive) search already ran. Surface it
  // as a real failure so the user can retry knowingly instead of seeing an
  // empty result. (Secondary writes below — evaluations, status flips — stay
  // log-only: the products they annotate are already committed.)
  if (insertError) {
    await completeAgentRun(supabase, agentRun.id, {
      status: "failed",
      error_message: insertError.message,
    });
    // apiError() logs the full error server-side (via logServerError) and returns
    // a generic client message — no separate console.error needed.
    return apiError("search", insertError);
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
      // Independent writes to different tables — run them concurrently.
      const [evalInsert, candUpdate] = await Promise.all([
        supabase.from("product_evaluations").insert(evalRows),
        supabase
          .from("candidate_products")
          .update({ status: "evaluated" })
          .in("id", evaluatedIds),
      ]);
      // supabase-js returns DB errors in-band (no throw), so an unchecked write
      // silently drops the persistence while the response still reports the
      // products as evaluated. Surface failures instead of swallowing them.
      if (evalInsert.error) console.error("[search] Failed to insert evaluations:", evalInsert.error.message);
      if (candUpdate.error) console.error("[search] Failed to mark products evaluated:", candUpdate.error.message);
    }
  }

  // Persist the search-session summary and room status concurrently —
  // independent writes to different tables on the completion hot path.
  const [sessionUpdate, roomUpdate] = await Promise.all([
    supabase
      .from("search_sessions")
      .update({
        status: "completed",
        updated_at: new Date().toISOString(),
        metadata: {
          trace_summary: result.data.trace?.summary || null,
          tokens_used: result.data.stats.tokensUsed,
        },
      })
      .eq("id", session?.id),
    supabase
      .from("rooms")
      .update({ status: "sourcing", updated_at: new Date().toISOString() })
      .eq("id", room_id),
  ]);
  if (sessionUpdate.error) console.error("[search] Failed to update search session:", sessionUpdate.error.message);
  if (roomUpdate.error) console.error("[search] Failed to update room status:", roomUpdate.error.message);

  await completeAgentRun(supabase, agentRun.id, {
    status: "completed",
    output_json: {
      products_found: savedProducts?.length || 0,
      categories_searched: Object.keys(result.data.candidatesByCategory),
      steps_count: result.data.steps.length,
      trace_summary: result.data.trace?.summary || null,
    },
    tokens_used: result.data.stats.tokensUsed,
  });

  // (s) Include also-considered alternatives in the response
  const alsoConsideredProducts = result.data.alsoConsidered
    ? Object.values(result.data.alsoConsidered).flat().map(p => ({
        title: p.title,
        category: p.category,
        retailer: p.retailer,
        product_url: p.product_url,
        image_url: p.image_url,
        price: p.price,
        materials: p.materials,
        colors: p.colors,
        metadata: p.metadata,
      }))
    : [];

  return NextResponse.json({
    session_id: session?.id,
    products_found: savedProducts?.length || 0,
    products: savedProducts,
    also_considered: alsoConsideredProducts,
    steps: result.data.steps,
    stats: result.data.stats,
    validation: result.data.validation,
  });
}
