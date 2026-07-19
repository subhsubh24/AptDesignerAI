import { NextResponse } from "next/server";
import { apiError } from "@/lib/utils/api-error";
import { createClient } from "@/lib/supabase/server";
import { userOwnsRoom } from "@/lib/auth/ownership";
import { evaluateBundle } from "@/lib/agents/bundle-optimizer";
import type { CandidateProduct } from "@/lib/types/database";
import { createAgentRun, completeAgentRun } from "@/lib/db/agent-runs";
import { buildDesignProfile } from "@/lib/design-context/build-profile";
import { checkRateLimit, RATE_LIMITS } from "@/lib/utils/rate-limiter";
import { checkDailySpend, dailySpendExceededResponse } from "@/lib/utils/spend-limiter";

// Bundle evaluation runs an LLM call per request. Without an explicit
// maxDuration, Vercel applies a short platform default and can kill the function
// mid-run — a "builds green, request gets killed" failure on a paid path. 300s
// is the Vercel Pro ceiling and covers the documented worst-case latency.
export const maxDuration = 300;

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
  // Bundle evaluation is a paid LLM call — gate it behind the daily spend
  // breaker too so a single authed user can't drive unbounded model spend
  // (matching the other paid LLM endpoints).
  const spend = checkDailySpend(user.id);
  if (!spend.allowed) return dailySpendExceededResponse(spend);

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

  // Ownership guard BEFORE the (paid) bundle evaluation: bundle_id is
  // client-supplied and the memory-store read is not user-scoped. Verify the
  // caller owns the bundle's room (bundle → room → project → user) so no
  // authenticated caller can evaluate — or read the products of — another user's
  // bundle (IDOR + LLM-cost abuse).
  if (!(await userOwnsRoom(supabase, bundle.room_id, user.id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // candidate_products comes from a nested Supabase join; a bundle_item whose
  // product row was deleted (or a broken FK) yields a null here. An unfiltered
  // null flows into evaluateBundle → p.id/p.category deref → an uncaught 500 that
  // leaves the bundle stuck at "pending" and orphans the just-created agent run.
  // Drop nulls so only resolvable products are evaluated.
  const products = ((bundle.product_bundle_items || []) as Array<{ candidate_products: unknown }>)
    .map((item) => item.candidate_products)
    .filter((p): p is CandidateProduct => p != null);

  // A bundle with no resolvable products can't be meaningfully evaluated — reject
  // it before the paid LLM call rather than sending an empty product list (which
  // would burn a model call to score nothing and return a nonsense verdict).
  if (products.length === 0) {
    return NextResponse.json({ error: "Bundle has no valid products to evaluate" }, { status: 400 });
  }

  // Room (with images) and the latest diagnosis both key only on bundle.room_id
  // and are independent of each other — fetch them together. Fixed-position
  // destructure keeps the result mapping deterministic.
  const [{ data: room }, { data: diagnosis }] = await Promise.all([
    supabase
      .from("rooms")
      .select("*, room_images(*)")
      .eq("id", bundle.room_id)
      .single(),
    supabase
      .from("room_diagnoses")
      .select("*")
      .eq("room_id", bundle.room_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single(),
  ]);

  const roomImageUrls = (room?.room_images || []).map((img: { image_url: string }) => img.image_url);

  // Fetch project for full building/apartment context (depends on room.project_id).
  const { data: project } = room?.project_id
    ? await supabase.from("projects").select("*").eq("id", room.project_id).single()
    : { data: null };

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

  // The evaluation is already persisted above; this only flips the bundle's
  // status. supabase-js returns the error in-band, so log a failure rather than
  // dropping it silently (which would leave the bundle stuck at "pending").
  const { error: statusError } = await supabase
    .from("product_bundles")
    .update({ status: "evaluated", updated_at: new Date().toISOString() })
    .eq("id", bundle_id);
  if (statusError) console.error("[bundles.evaluate] Failed to update bundle status:", statusError.message);

  await completeAgentRun(supabase, agentRun.id, {
    status: "completed",
    output_json: result.data as unknown as Record<string, unknown>,
    tokens_used: result.tokensUsed,
  });

  return NextResponse.json(evaluation, { status: 201 });
}
