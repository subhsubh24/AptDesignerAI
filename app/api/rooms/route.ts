import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { apiError } from "@/lib/utils/api-error";
import { parsePagination } from "@/lib/utils/pagination";
import { enforceWriteRateLimit } from "@/lib/utils/write-rate-limit";
import { requireProjectOwnership } from "@/lib/auth/ownership";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const projectId = request.nextUrl.searchParams.get("project_id");
  if (!projectId) return NextResponse.json({ error: "project_id required" }, { status: 400 });

  // Ownership guard: project_id is client-supplied and the memory-store query is
  // not user-scoped (RLS is inert at runtime), so without this check any
  // authenticated caller could enumerate another user's rooms by guessing a
  // project_id (IDOR / cross-tenant read). The POST sibling applies the same
  // guard before inserting.
  const getOwnership = await requireProjectOwnership(supabase, projectId, user.id);
  if (getOwnership) return getOwnership;

  const { offset, rangeEnd } = parsePagination(request.nextUrl.searchParams, { defaultLimit: 100, maxLimit: 300 });

  // Embed room_images so a caller listing rooms doesn't then have to fire one
  // GET /api/rooms/[roomId]/images per room — the dashboard's project load was
  // doing exactly that (1 rooms request + N image requests, each re-running
  // auth.getUser() and its own ownership check). Same shape the apartment
  // analysis route already reads (app/api/analyze-apartment/route.ts), and
  // additive for any other consumer: every existing room column is unchanged.
  const { data, error } = await supabase
    .from("rooms")
    .select("*, room_images(*)")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true })
    .range(offset, rangeEnd);

  if (error) return apiError("rooms", error);
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const limited = enforceWriteRateLimit(user.id, "rooms");
  if (limited) return limited;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { project_id, name, room_type, budget_mode, sourcing_mode, priorities, keep_items, replace_items } = body;

  if (!project_id || !name?.trim() || !room_type) {
    return NextResponse.json({ error: "project_id, name, and room_type are required" }, { status: 400 });
  }

  // Server-side input validation (client Zod is UX, not security): reject
  // oversized/malformed writes before they reach the DB (Track G2). Bounds are
  // generous — they only stop abuse (unbounded strings/arrays), not real use.
  if (typeof name !== "string" || name.trim().length > 200) {
    return NextResponse.json({ error: "name must be a string of at most 200 characters" }, { status: 400 });
  }
  if (typeof room_type !== "string" || room_type.length > 60) {
    return NextResponse.json({ error: "room_type must be a string of at most 60 characters" }, { status: 400 });
  }
  for (const [field, value] of [
    ["priorities", priorities],
    ["keep_items", keep_items],
    ["replace_items", replace_items],
  ] as const) {
    if (
      value !== undefined &&
      value !== null &&
      (!Array.isArray(value) || value.length > 100 || value.some((x) => typeof x !== "string" || x.length > 500))
    ) {
      return NextResponse.json(
        { error: `${field} must be an array of at most 100 strings (each at most 500 characters)` },
        { status: 400 },
      );
    }
  }

  // Ownership guard (write side): reject a room insert into a project the caller
  // does not own. Without it, an authenticated user could pollute another user's
  // project by POSTing a room with their project_id (IDOR / cross-tenant write).
  const postOwnership = await requireProjectOwnership(supabase, project_id, user.id);
  if (postOwnership) return postOwnership;

  const { data, error } = await supabase
    .from("rooms")
    .insert({
      project_id,
      name: name.trim(),
      room_type,
      budget_mode: budget_mode || "balanced",
      sourcing_mode: sourcing_mode || "manual",
      priorities: priorities || [],
      keep_items: keep_items || [],
      replace_items: replace_items || [],
    })
    .select()
    .single();

  if (error) return apiError("rooms", error);
  return NextResponse.json(data, { status: 201 });
}
