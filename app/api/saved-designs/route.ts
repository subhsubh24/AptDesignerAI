import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { apiError } from "@/lib/utils/api-error";
import { getCurrentUserId } from "@/lib/supabase/server";
import { parsePagination } from "@/lib/utils/pagination";
import { checkRateLimit } from "@/lib/utils/rate-limiter";
import { userOwnsRoom } from "@/lib/auth/ownership";
import { hasProEntitlementWeb, FREE_SAVE_LIMIT_WEB } from "@/lib/entitlements/web";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const userId = await getCurrentUserId();

  const { offset, rangeEnd } = parsePagination(request.nextUrl.searchParams, { defaultLimit: 100, maxLimit: 500 });

  const { data, error } = await supabase
    .from("saved_designs")
    .select("id, title, room_type, stage, thumbnail_url, created_at, updated_at, project_id, room_id")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .range(offset, rangeEnd);

  if (error) return apiError("saved-designs", error);
  return NextResponse.json(data ?? []);
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const userId = await getCurrentUserId();

  // Rate limit — matches the mobile save endpoint (10/min per user). A save is
  // a cheap write, but each one fans out into several DB reads (room, diagnosis,
  // products, bundles) to build the snapshot, so an unbounded loop is real load.
  const limit = checkRateLimit(`saved-designs:${userId ?? "anon"}`, { maxRequests: 10, windowMs: 60_000 });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many save requests. Please wait a moment." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((limit.retryAfterMs ?? 60000) / 1000)) } },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { room_id, project_id, stage } = body as {
    room_id: string;
    project_id?: string;
    stage: "assessment" | "full";
  };

  if (!room_id) {
    return NextResponse.json({ error: "room_id required" }, { status: 400 });
  }

  // Ownership guard: room_id (and the optional project_id below) are
  // client-supplied and the memory-store reads are not user-scoped, so without
  // this check any authenticated caller could snapshot another user's private
  // diagnosis + sourced products + bundles into their OWN saved_designs, then
  // read them back — a cross-tenant data-exposure IDOR.
  if (!(await userOwnsRoom(supabase, room_id, userId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Fetch room details. Fail loud on a read error: the ownership guard above
  // already proved this room exists and is owned, so an error here is a transient
  // DB failure — persisting a snapshot titled "Untitled Room" with a null
  // room_type would be a silently-degraded save the user can't tell apart from a
  // good one. Surface it so the client can retry (F4.1 SIDE-EFFECT INTEGRITY).
  const { data: room, error: roomError } = await supabase
    .from("rooms")
    .select("name, room_type")
    .eq("id", room_id)
    .single();

  if (roomError) return apiError("saved-designs", roomError);

  // Fetch latest diagnosis (area_analysis)
  const { data: diagnosis } = await supabase
    .from("room_diagnoses")
    .select("diagnosis_json, design_direction_json")
    .eq("room_id", room_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!diagnosis?.diagnosis_json) {
    return NextResponse.json({ error: "No analysis found for this room" }, { status: 404 });
  }

  const djson = diagnosis.diagnosis_json as Record<string, unknown>;
  const title = (room?.name as string) || (room?.room_type as string) || "Untitled Room";

  // Build snapshot
  const snapshot: Record<string, unknown> = {
    assessment: {
      what_it_needs: djson.what_it_needs ?? [],
      what_works: djson.what_works ?? [],
      what_should_go: djson.what_should_go ?? [],
      design_direction: djson.design_direction ?? "",
      room_description: djson.summary ?? "",
      mockup_url: djson.mockup_url ?? null,
      floor_plan_dims: djson.floor_plan_dims ?? null,
    },
    metadata: {
      saved_at: new Date().toISOString(),
    },
  };

  // If stage is "full", include product search results
  if (stage === "full") {
    // These two reads are independent (both key only on room_id, neither
    // depends on the other), so run them concurrently — on this retention-
    // critical save path the user waits on ONE round-trip instead of two.
    // Results are destructured by position, so ordering/determinism is
    // unchanged and BOTH .error fields are still checked before anything is
    // persisted.
    const [
      { data: products, error: productsError },
      { data: bundles, error: bundlesError },
    ] = await Promise.all([
      supabase
        .from("candidate_products")
        .select("*, product_evaluations(*)")
        .eq("room_id", room_id)
        .eq("status", "selected"),
      supabase
        .from("product_bundles")
        .select("*, product_bundle_items(*), bundle_evaluations(*)")
        .eq("room_id", room_id),
    ]);

    // Fail loud instead of persisting a silently-empty "full" snapshot: if either
    // read errors, `data` is null and `?? []` would save a design the user
    // believes holds their shortlist but that reloads with zero products/bundles
    // (silent data loss on a retention-critical save). Surface the failure so the
    // client can retry rather than returning a hollow 200. See F4.1 SIDE-EFFECT
    // INTEGRITY — a "saved" success must be downstream of the read actually
    // succeeding.
    if (productsError || bundlesError) {
      return apiError("saved-designs", productsError ?? bundlesError);
    }

    snapshot.products = {
      bundles: bundles ?? [],
      per_tier_products: groupByTier(products ?? []),
      validation: null,
    };
  }

  // Fetch project name for metadata
  if (project_id) {
    const { data: project } = await supabase
      .from("projects")
      .select("name, building_name")
      .eq("id", project_id)
      .single();

    if (project) {
      (snapshot.metadata as Record<string, unknown>).project_name = project.name;
      (snapshot.metadata as Record<string, unknown>).building_name = project.building_name;
    }
  }

  // Upsert: if a saved design for this room already exists, update it.
  // Fail loud on a read error rather than treating an errored existence check as
  // "no existing design": falling through to the INSERT branch below would create
  // a DUPLICATE saved_designs row for a room that already has one (defeating the
  // upsert and corrupting the user's saved list). A transient read error must
  // return 500 so the client retries, never a silent second row.
  const { data: existing, error: existingError } = await supabase
    .from("saved_designs")
    .select("id")
    .eq("user_id", userId)
    .eq("room_id", room_id)
    .maybeSingle();

  if (existingError) return apiError("saved-designs", existingError);

  // Gate new saves for free-tier users. Re-saving an already-saved room (UPDATE path) is always allowed.
  // Soft/best-effort limit: a count+insert race at the boundary could allow one extra save (same
  // semantics as the mobile gate — no DB-level constraint enforces the cap).
  if (!existing) {
    const { count: saveCount } = await supabase
      .from("saved_designs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);

    if ((saveCount ?? 0) >= FREE_SAVE_LIMIT_WEB) {
      const hasPro = await hasProEntitlementWeb(userId);
      if (!hasPro) {
        return NextResponse.json(
          { error: "Free save limit reached. Upgrade to Pro to save unlimited designs.", subscription_required: true },
          { status: 403 },
        );
      }
    }
  }

  let result;
  if (existing) {
    const { data, error } = await supabase
      .from("saved_designs")
      .update({
        stage,
        snapshot,
        title,
        room_type: room?.room_type ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select()
      .single();
    if (error) return apiError("saved-designs", error);
    result = data;
  } else {
    const { data, error } = await supabase
      .from("saved_designs")
      .insert({
        user_id: userId,
        project_id: project_id ?? null,
        room_id,
        title,
        room_type: room?.room_type ?? null,
        stage,
        snapshot,
      })
      .select()
      .single();
    if (error) return apiError("saved-designs", error);
    result = data;
  }

  return NextResponse.json(result, { status: existing ? 200 : 201 });
}

function groupByTier(products: Array<Record<string, unknown>>): Record<string, unknown[]> {
  const grouped: Record<string, unknown[]> = { budget: [], balanced: [], high_end: [] };
  for (const p of products) {
    const tier = ((p.metadata as Record<string, unknown>)?.price_tier as string) || "balanced";
    if (!grouped[tier]) grouped[tier] = [];
    grouped[tier].push(p);
  }
  return grouped;
}
