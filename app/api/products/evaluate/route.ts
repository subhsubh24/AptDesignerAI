import { NextResponse } from "next/server";
import { apiError } from "@/lib/utils/api-error";
import { createClient } from "@/lib/supabase/server";
import { scoreProduct } from "@/lib/agents/fit-scorer";
import { createAgentRun, completeAgentRun } from "@/lib/db/agent-runs";
import { buildDesignProfile } from "@/lib/design-context/build-profile";
import { buildIdentifiedPiecesBlock } from "@/lib/prompts/product-identification";
import { checkRateLimit, RATE_LIMITS } from "@/lib/utils/rate-limiter";
import { checkDailySpend, dailySpendExceededResponse } from "@/lib/utils/spend-limiter";
import type { IdentifiedProduct } from "@/lib/types/database";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Scoring fans out an LLM call per product — gate it behind the same per-user
  // rate limit + daily spend breaker as the other paid LLM endpoints so a single
  // authed caller can't drive unbounded model spend.
  const limit = checkRateLimit(`product-evaluate:${user.id}`, RATE_LIMITS.productEvaluate);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many evaluation requests. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((limit.retryAfterMs || 60000) / 1000)) } }
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
  const { product_id, room_id } = body;

  if (!product_id || !room_id) {
    return NextResponse.json({ error: "product_id and room_id required" }, { status: 400 });
  }

  // Fetch product, room, project, and diagnosis in parallel
  const [productRes, roomRes] = await Promise.all([
    supabase.from("candidate_products").select("*").eq("id", product_id).single(),
    supabase.from("rooms").select("*, room_images(*)").eq("id", room_id).single(),
  ]);

  if (productRes.error || !productRes.data) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }
  if (roomRes.error || !roomRes.data) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  const product = productRes.data;
  const room = roomRes.data;
  const roomImageUrls = (room.room_images || []).map((img: { image_url: string }) => img.image_url);

  // Fetch project (building/apartment context), this room's latest diagnosis
  // (design direction), and sibling rooms (cross-room coherence) in parallel —
  // all three depend only on the already-resolved room, not on each other, so
  // serializing them just stacked three round-trips on this per-product hot path.
  const [projectRes, diagnosisRes, otherRoomsRes] = await Promise.all([
    supabase.from("projects").select("*").eq("id", room.project_id).single(),
    supabase
      .from("room_diagnoses")
      .select("*")
      .eq("room_id", room_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single(),
    supabase
      .from("rooms")
      .select("name, room_type, room_diagnoses(diagnosis_json, created_at)")
      .eq("project_id", room.project_id)
      .neq("id", room_id),
  ]);
  const project = projectRes.data;
  const diagnosis = diagnosisRes.data;
  const otherRooms = otherRoomsRes.data;

  const designProfile = buildDesignProfile(project);

  // Build cross-room context
  let otherRoomsContext: string | undefined;

  if (otherRooms && otherRooms.length > 0) {
    // 90-day freshness window — filter out stale sibling diagnoses before
    // piping them into cross-room coherence. Older palettes reflect prior
    // preferences that likely no longer hold.
    const staleCutoffMs = Date.now() - 90 * 24 * 60 * 60 * 1000;
    otherRoomsContext = otherRooms
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase join result
      .map((r: any) => {
        const recent = (r.room_diagnoses ?? []).filter((d: { created_at?: string }) => {
          if (!d.created_at) return false;
          const t = Date.parse(d.created_at);
          return Number.isFinite(t) && t >= staleCutoffMs;
        });
        const diag = recent[recent.length - 1];
        const summary = diag
          ? (diag.diagnosis_json as Record<string, string>).summary || "analyzed"
          : "not analyzed";
        return `- ${r.name} (${r.room_type}): ${summary}`;
      })
      .join("\n");
  }

  // Extract spatial/environmental context from diagnosis
  const diagnosisJson = diagnosis?.diagnosis_json as Record<string, unknown> | undefined;
  const spatialLayout = diagnosisJson?.spatial_layout as string | undefined;
  const lightingConditions = diagnosisJson?.lighting_conditions as string | undefined;
  const windowDoorPositions = diagnosisJson?.window_door_positions as string | undefined;
  const outletPositions = diagnosisJson?.outlet_positions as string | undefined;

  // Extract floor plan from building research
  const floorPlan = (project?.building_research as Record<string, unknown> | undefined)?.floor_plan as Record<string, unknown> | undefined;

  // Extract placement for this product's category from what_it_needs
  let placement: string | undefined;
  const whatItNeeds = diagnosisJson?.what_it_needs as Array<{ category?: string; placement?: string }> | undefined;
  if (whatItNeeds && product.category) {
    const match = whatItNeeds.find((item) => item.category === product.category);
    if (match?.placement) placement = match.placement;
  }

  // Identified-pieces block (furniture identification feature). Empty string
  // when the feature is off or no usable identifications — scoring stays
  // byte-for-byte equivalent for pre-feature rows.
  const identifiedProductsList = (diagnosisJson?.identified_products as IdentifiedProduct[] | undefined) ?? [];
  const identifiedContext = buildIdentifiedPiecesBlock(identifiedProductsList);

  // Create agent run
  const agentRun = await createAgentRun(supabase, {
    room_id,
    agent_type: "scorer",
    input_json: { product_id, product_title: product.title },
  });

  const result = await scoreProduct(product, {
    roomType: room.room_type,
    budgetMode: room.budget_mode,
    existingItems: room.keep_items || [],
    roomImageUrls,
    priorities: room.priorities || [],
    otherRoomsContext,
    designProfile,
    diagnosis: diagnosis?.diagnosis_json || undefined,
    designDirection: diagnosis?.design_direction_json || undefined,
    placement,
    spatialLayout,
    floorPlan,
    lightingConditions,
    windowDoorPositions,
    outletPositions,
    userContext: room.user_context || undefined,
    replaceItems: room.replace_items || [],
    identifiedContext: identifiedContext || undefined,
  });

  if (!result.success || !result.data) {
    await completeAgentRun(supabase, agentRun.id, {
      status: "failed",
      error_message: result.error,
    });
    return NextResponse.json({ error: result.error || "Scoring failed" }, { status: 500 });
  }

  // Save evaluation (include area/apartment fit notes in reasoning)
  const reasoning = {
    ...result.data.reasoning,
    area_fit_note: result.data.area_fit_note,
    apartment_fit_note: result.data.apartment_fit_note,
  };

  const { data: evaluation, error: saveError } = await supabase
    .from("product_evaluations")
    .insert({
      product_id,
      room_id,
      ...result.data.scores,
      final_item_score: result.data.final_item_score,
      verdict: result.data.verdict,
      reasoning,
      model_used: result.model,
    })
    .select()
    .single();

  if (saveError) {
    return apiError("products.evaluate", saveError);
  }

  // Update product status
  await supabase
    .from("candidate_products")
    .update({ status: "evaluated", updated_at: new Date().toISOString() })
    .eq("id", product_id);

  await completeAgentRun(supabase, agentRun.id, {
    status: "completed",
    output_json: result.data as unknown as Record<string, unknown>,
    tokens_used: result.tokensUsed,
  });

  return NextResponse.json(evaluation, { status: 201 });
}
