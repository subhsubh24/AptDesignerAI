import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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

  // Fetch rooms owned by this user
  let roomsQuery = supabase
    .from("rooms")
    .select("id, name, room_type, project_id, projects!inner(user_id)")
    .eq("projects.user_id", user.id);

  if (projectId) {
    roomsQuery = roomsQuery.eq("project_id", projectId);
  }

  const { data: rooms, error: roomsError } = await roomsQuery;
  if (roomsError) return NextResponse.json({ error: roomsError.message }, { status: 500 });
  if (!rooms?.length) return NextResponse.json([]);

  const roomIds = rooms.map((r: { id: string }) => r.id);
  const roomMap = Object.fromEntries(
    rooms.map((r: { id: string; name: string; room_type: string | null }) => [
      r.id,
      { name: r.name, room_type: r.room_type },
    ])
  );

  const { data: products, error: prodError } = await supabase
    .from("candidate_products")
    .select("*, product_evaluations(*)")
    .in("room_id", roomIds)
    .in("status", ["shortlisted", "accepted"])
    .order("created_at", { ascending: false });

  if (prodError) return NextResponse.json({ error: prodError.message }, { status: 500 });

  const enriched = (products ?? []).map((p: { room_id: string; [key: string]: unknown }) => ({
    ...p,
    room_name: (roomMap[p.room_id] as { name: string; room_type: string | null } | undefined)?.name ?? "Unknown Room",
    room_type: (roomMap[p.room_id] as { name: string; room_type: string | null } | undefined)?.room_type ?? null,
  }));

  return NextResponse.json(enriched);
}
