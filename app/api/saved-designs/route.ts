import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { apiError } from "@/lib/utils/api-error";
import { getCurrentUserId } from "@/lib/supabase/server";
import { parsePagination } from "@/lib/utils/pagination";
import { checkRateLimit } from "@/lib/utils/rate-limiter";
import { requireRoomOwnership } from "@/lib/auth/ownership";
import { hasProEntitlementWeb, FREE_SAVE_LIMIT_WEB } from "@/lib/entitlements/web";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const userId = await getCurrentUserId();
  // null means we could not establish WHO is asking. Querying on it would hand
  // back whatever rows a null/fallback identity owns, so refuse instead.
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
  // A save written under an unresolved identity would be unreachable by its
  // real owner (and readable by the next unauthenticated visitor). Refuse.
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Rate limit — matches the mobile save endpoint (10/min per user). A save is
  // a cheap write, but each one fans out into several DB reads (room, diagnosis,
  // products, bundles) to build the snapshot, so an unbounded loop is real load.
  const limit = checkRateLimit(`saved-designs:${userId}`, { maxRequests: 10, windowMs: 60_000 });
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

  // Ownership guard: room_id is client-supplied and the memory-store reads are
  // not user-scoped, so without this check any authenticated caller could
  // snapshot another user's private diagnosis + sourced products + bundles into
  // their OWN saved_designs, then read them back — a cross-tenant data-exposure
  // IDOR. The optional project_id is bound to the user separately at its own
  // fetch below (it feeds only the metadata name/building_name).
  const postOwnership = await requireRoomOwnership(supabase, room_id, userId);
  if (postOwnership) return postOwnership;

  // Fetch room details and the latest diagnosis. These two reads are
  // independent (both key only on room_id, neither depends on the other), so
  // run them concurrently — same pattern as the products/bundles fetch below.
  //
  // Fail loud on a room read error: the ownership guard above already proved
  // this room exists and is owned, so an error here is a transient DB
  // failure — persisting a snapshot titled "Untitled Room" with a null
  // room_type would be a silently-degraded save the user can't tell apart from a
  // good one. Surface it so the client can retry (F4.1 SIDE-EFFECT INTEGRITY).
  const [
    { data: room, error: roomError },
    { data: diagnosis },
  ] = await Promise.all([
    supabase
      .from("rooms")
      .select("name, room_type")
      .eq("id", room_id)
      .single(),
    supabase
      .from("room_diagnoses")
      .select("diagnosis_json, design_direction_json")
      .eq("room_id", room_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (roomError) return apiError("saved-designs", roomError);

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

  // Fetch project name for metadata. Bind project_id to the authenticated user
  // (.eq("user_id", userId)) — it is client-supplied and the memory-store reads
  // are not user-scoped, so an unbound select would copy ANY tenant's project
  // name + building_name into the caller's saved_designs.metadata, readable back
  // via GET /api/saved-designs/[id] (cross-tenant read IDOR). Mirrors the
  // requireProjectOwnership convention; a non-owned/absent project simply yields no
  // metadata (maybeSingle → null) rather than leaking or erroring.
  //
  // The SAME bound fetch decides what gets PERSISTED. Previously the row stored
  // `project_id ?? null` unconditionally, so a project id the caller does not
  // own was written onto their own saved_designs row even though the fetch just
  // returned nothing for it. That is not a cross-tenant read — /api/projects/
  // [projectId] 404s on the id, and the row itself is owner-scoped — but it
  // stores a foreign key the owner cannot resolve, which breaks the app's
  // invariant that a saved design's project_id is always one of the caller's
  // own projects. Bind every client-supplied id, then persist what the binding
  // returned; never persist the raw input alongside a check that rejected it.
  // The project-binding fetch and the existing-design lookup below are
  // independent (the project fetch keys on project_id/user_id, the existing
  // lookup keys on room_id/user_id — neither depends on the other's result),
  // so run them concurrently — same pattern as the products/bundles fetch
  // above. When project_id is absent, skip the query and resolve to the same
  // shape a Supabase maybeSingle() miss would ({ data: null, error: null }).
  const [{ data: project }, { data: existing, error: existingError }] = await Promise.all([
    project_id
      ? supabase
          .from("projects")
          .select("name, building_name")
          .eq("id", project_id)
          .eq("user_id", userId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    // Upsert: if a saved design for this room already exists, update it.
    // Fail loud on a read error rather than treating an errored existence check
    // as "no existing design": falling through to the INSERT branch below would
    // create a DUPLICATE saved_designs row for a room that already has one
    // (defeating the upsert and corrupting the user's saved list). A transient
    // read error must return 500 so the client retries, never a silent second row.
    supabase
      .from("saved_designs")
      .select("id")
      .eq("user_id", userId)
      .eq("room_id", room_id)
      .maybeSingle(),
  ]);

  let boundProjectId: string | null = null;
  if (project) {
    boundProjectId = project_id as string;
    (snapshot.metadata as Record<string, unknown>).project_name = project.name;
    (snapshot.metadata as Record<string, unknown>).building_name = project.building_name;
  }

  if (existingError) return apiError("saved-designs", existingError);

  // Gate new saves for free-tier users. Re-saving an already-saved room (UPDATE path) is always allowed.
  // Soft/best-effort limit: a count+insert race at the boundary could allow one extra save (same
  // semantics as the mobile gate — no DB-level constraint enforces the cap).
  if (!existing) {
    const { count: saveCount, error: saveCountError } = await supabase
      .from("saved_designs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);

    // Fail loud on a count-query error rather than treating it as "0 saves so
    // far" — `?? 0` on an errored (null) count would silently bypass the free
    // tier's save limit on every transient DB error, the same class of bug
    // the read-error check above this block already guards against.
    if (saveCountError) return apiError("saved-designs", saveCountError);

    if ((saveCount ?? 0) >= FREE_SAVE_LIMIT_WEB) {
      const hasPro = await hasProEntitlementWeb(userId);
      if (!hasPro) {
        return NextResponse.json(
          {
            error: "Free save limit reached. Upgrade to Pro to save unlimited designs.",
            subscription_required: true,
            limit: FREE_SAVE_LIMIT_WEB,
          },
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
        project_id: boundProjectId,
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
