import { NextResponse } from "next/server";
import { apiError } from "@/lib/utils/api-error";
import { createClient } from "@/lib/supabase/server";
import { evaluateBundle } from "@/lib/agents/bundle-optimizer";
import { createAgentRun, completeAgentRun } from "@/lib/db/agent-runs";
import { buildDesignProfile } from "@/lib/design-context/build-profile";
import { checkRateLimit, RATE_LIMITS } from "@/lib/utils/rate-limiter";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limit = checkRateLimit(`bundle-evaluate:${user.id}`, RATE_LIMITS.bundleEvaluate);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(Math.ceil((limit.retryAfterMs || 60000) / 1000)) } },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { bundle_id } = body;
  if (!bundle_id) return NextResponse.json({ error: "bundle_id required" }, { status: 400 });

  // Fetch bundle with items
  const { data: bundle } = await supabase
    .from("product_bundles")
    .select("*, product_bundle_items(*, candidate_products(*))")
    .eq("id", bundle_id)
    .single();

  if (!bundle) return NextResponse.json({ error: "Bundle not found" }, { status: 404 });

  const products = (bundle.product_bundle_items || []).map(
    (item: { candidate_products: unknown }) => item.candidate_products
  );

  // Fetch room with images
  const { data: room } = await supabase
    .from("rooms")
    .select("*, room_images(*)")
    .eq("id", bundle.room_id)
    .single();

  const roomImageUrls = (room?.room_images || []).map((img: { image_url: string }) => img.image_url);

  // Fetch project for full building/apartment context
  const { data: project } = room?.project_id
    ? await supabase.from("projects").select("*").eq("id", room.project_id).single()
    : { data: null };

  // Fetch room diagnosis for design direction
  const { data: diagnosis } = await supabase
    .from("room_diagnoses")
    .select("*")
    .eq("room_id", bundle.room_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  const designProfile = buildDesignProfile(project);

  // Create agent run
  const agentRun = await createAgentRun(supabase, {
    room_id: bundle.room_id,
    agent_type: "bundler",
    input_json: { bundle_id, product_count: products.length },
  });

  // Extract spatial and environmental context from diagnosis
  const diagJson = diagnosis?.diagnosis_json as Record<string, unknown> | undefined;
  const spatialLayout = diagJson?.spatial_layout as string | undefined;
  const lightingConditions = diagJson?.lighting_conditions as string | undefined;
  const windowDoorPositions = diagJson?.window_door_positions as string | undefined;
  const outletPositions = diagJson?.outlet_positions as string | undefined;

  // Build placement map from what_it_needs items
  const placementMap: Record<string, string> = {};
  const whatItNeeds = diagJson?.what_it_needs as Array<{ category?: string; placement?: string }> | undefined;
  if (whatItNeeds) {
    for (const item of whatItNeeds) {
      if (item.category && item.placement) {
        placementMap[item.category] = item.placement;
      }
    }
  }

  // Extract floor plan from building research
  const floorPlan = (project?.building_research as Record<string, unknown> | undefined)?.floor_plan as Record<string, unknown> | undefined;

  const result = await evaluateBundle(products, {
    roomType: room?.room_type || "living_room",
    roomImageUrls,
    priorities: room?.priorities || [],
    existingItems: room?.keep_items || [],
    replaceItems: room?.replace_items || [],
    whatShouldGo: diagJson?.what_should_go as string[] | undefined,
    designProfile,
    diagnosis: diagnosis?.diagnosis_json || undefined,
    designDirection: diagnosis?.design_direction_json || undefined,
    spatialLayout: spatialLayout || undefined,
    placementMap: Object.keys(placementMap).length > 0 ? placementMap : undefined,
    floorPlan: floorPlan || undefined,
    lightingConditions: lightingConditions || undefined,
    windowDoorPositions: windowDoorPositions || undefined,
    outletPositions: outletPositions || undefined,
    userContext: (room?.user_context as string) || undefined,
  });

  if (!result.success || !result.data) {
    await completeAgentRun(supabase, agentRun.id, {
      status: "failed",
      error_message: result.error,
    });
    return NextResponse.json({ error: result.error || "Bundle evaluation failed" }, { status: 500 });
  }

  // Save evaluation
  const { data: evaluation, error: saveError } = await supabase
    .from("bundle_evaluations")
    .insert({
      bundle_id,
      ...result.data.scores,
      final_bundle_score: result.data.final_bundle_score,
      verdict: result.data.verdict,
      analysis: result.data.analysis,
      room_vibe: result.data.room_vibe || null,
      model_used: result.model,
    })
    .select()
    .single();

  if (saveError) return apiError("bundles.evaluate", saveError);

  await supabase
    .from("product_bundles")
    .update({ status: "evaluated", updated_at: new Date().toISOString() })
    .eq("id", bundle_id);

  await completeAgentRun(supabase, agentRun.id, {
    status: "completed",
    output_json: result.data as unknown as Record<string, unknown>,
    tokens_used: result.tokensUsed,
  });

  return NextResponse.json(evaluation, { status: 201 });
}
