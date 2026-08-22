import { NextResponse } from "next/server";
import { apiError } from "@/lib/utils/api-error";
import { createClient } from "@/lib/supabase/server";
import { parsePagination } from "@/lib/utils/pagination";

/**
 * GET /api/picks
 * Returns shortlisted/accepted products across all rooms the user owns.
 * Optional ?project_id= to scope to one project.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("project_id");
  const { offset, rangeEnd } = parsePagination(searchParams, { defaultLimit: 200, maxLimit: 1000 });

  // Fetch rooms owned by this user
  let roomsQuery = supabase
    .from("rooms")
    .select("id, name, room_type, project_id, projects!inner(user_id)")
    .eq("projects.user_id", user.id);

  if (projectId) {
    roomsQuery = roomsQuery.eq("project_id", projectId);
  }

  // Bound the owned-rooms fetch — unbounded today at realistic project sizes,
  // but this scans every project the user owns with no ceiling (APT-41).
  // Explicit .order() is required alongside .limit(): Postgres/PostgREST give
  // no ordering guarantee without one, so an unordered .limit() would silently
  // (and non-deterministically) drop an arbitrary subset of rooms once a user
  // exceeds the cap. Newest-first so a recently added room is never the one
  // dropped in favor of an older one.
  roomsQuery = roomsQuery.order("created_at", { ascending: false }).limit(100);

  const { data: rooms, error: roomsError } = await roomsQuery;
  if (roomsError) return apiError("picks", roomsError);
  if (!rooms?.length) return NextResponse.json([]);

  const roomIds = rooms.map((r: { id: string }) => r.id);
  const roomMap = Object.fromEntries(
    rooms.map((r: { id: string; name: string; room_type: string | null }) => [
      r.id,
      { name: r.name, room_type: r.room_type },
    ])
  );

  // Narrowed to only the columns app/picks/page.tsx's PickProduct interface
  // reads — description/dimensions/materials/colors/metadata/etc. are never
  // rendered on this cross-room list page. See APT-54 (follow-up to APT-48).
  const { data: products, error: prodError } = await supabase
    .from("candidate_products")
    .select("id, title, category, price, image_url, product_url, status, room_id, product_evaluations(final_item_score)")
    .in("room_id", roomIds)
    .in("status", ["shortlisted", "accepted"])
    .order("created_at", { ascending: false })
    .range(offset, rangeEnd);

  if (prodError) return apiError("picks", prodError);

  const enriched = (products ?? []).map((p: { room_id: string; [key: string]: unknown }) => ({
    ...p,
    room_name: (roomMap[p.room_id] as { name: string; room_type: string | null } | undefined)?.name ?? "Unknown Room",
    room_type: (roomMap[p.room_id] as { name: string; room_type: string | null } | undefined)?.room_type ?? null,
  }));

  return NextResponse.json(enriched);
}
