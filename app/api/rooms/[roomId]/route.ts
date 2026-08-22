import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { apiError, logServerError } from "@/lib/utils/api-error";
import { enforceWriteRateLimit, DELETE_WRITE_LIMIT } from "@/lib/utils/write-rate-limit";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("rooms")
    .select("*, room_images(*), projects!inner(user_id)")
    .eq("id", roomId)
    .eq("projects.user_id", user.id)
    .single();

  if (error) return apiError("rooms.byId", error, error.code === "PGRST116" ? 404 : 500, error.code === "PGRST116" ? "Not found" : "Something went wrong. Please try again.");
  return NextResponse.json(data);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const limited = enforceWriteRateLimit(user.id, "rooms:update");
  if (limited) return limited;

  // Verify ownership
  const { data: room, error: roomError } = await supabase
    .from("rooms")
    .select("id, projects!inner(user_id)")
    .eq("id", roomId)
    .eq("projects.user_id", user.id)
    .single();
  // PGRST116 ("no rows") is the normal shape of "not found or not owned" here
  // — the inner join + eq(user.id) filters it out just like an ownership
  // check would — so it's not logged as a failure; a genuine DB error is.
  if (roomError && roomError.code !== "PGRST116") {
    logServerError("rooms.byId.patch.room", roomError);
  }
  if (!room) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Server-side input validation (client Zod is UX, not security): reject
  // oversized/malformed writes before they reach the DB (Track G2) with a clean
  // 400 instead of letting a bad value surface as a generic 500 at the DB layer.
  // Mirrors the sibling POST /api/rooms bounds AND the DB CHECK/NOT-NULL
  // constraints (migrations 001/002). Bounds are generous — abuse-only.

  // `name` and `room_type` are NOT NULL columns — a present-but-null value would
  // otherwise slip past the guards below (which skip null) and 500 at the DB.
  for (const field of ["name", "room_type"] as const) {
    if (field in body && (typeof body[field] !== "string" || body[field].trim() === "")) {
      return NextResponse.json({ error: `${field} must be a non-empty string` }, { status: 400 });
    }
  }
  const STRING_LIMITS: Record<string, number> = { name: 200, user_context: 5000 };
  for (const [field, max] of Object.entries(STRING_LIMITS)) {
    const v = body[field];
    if (v !== undefined && v !== null && (typeof v !== "string" || v.length > max)) {
      return NextResponse.json({ error: `${field} must be a string of at most ${max} characters` }, { status: 400 });
    }
  }
  // Enum columns: validate membership so an invalid-but-short value returns a
  // clean 400 rather than tripping the DB CHECK constraint as a 500. Lists match
  // migrations 001 (status/budget_mode/sourcing_mode) and 002 (room_type).
  const ENUMS: Record<string, readonly string[]> = {
    room_type: [
      "living_room", "dining_area", "kitchen", "bedroom", "bedroom_2",
      "bedroom_3", "bathroom", "bathroom_2", "bathroom_3", "main_room",
    ],
    status: ["setup", "diagnosed", "sourcing", "bundled", "completed"],
    budget_mode: ["budget", "balanced", "best_possible"],
    sourcing_mode: ["manual", "agentic", "hybrid"],
  };
  for (const [field, allowed] of Object.entries(ENUMS)) {
    const v = body[field];
    if (v !== undefined && v !== null && (typeof v !== "string" || !allowed.includes(v))) {
      return NextResponse.json({ error: `${field} must be one of: ${allowed.join(", ")}` }, { status: 400 });
    }
  }
  // budget_dollars is an INTEGER column — reject fractional/negative values that
  // would otherwise coerce-fail at the DB (500) rather than validating here.
  if (
    body.budget_dollars !== undefined && body.budget_dollars !== null &&
    (typeof body.budget_dollars !== "number" || !Number.isInteger(body.budget_dollars) || body.budget_dollars < 0)
  ) {
    return NextResponse.json({ error: "budget_dollars must be a non-negative integer" }, { status: 400 });
  }
  for (const field of ["priorities", "keep_items", "replace_items"] as const) {
    const v = body[field];
    if (
      v !== undefined && v !== null &&
      (!Array.isArray(v) || v.length > 100 || v.some((x: unknown) => typeof x !== "string" || x.length > 500))
    ) {
      return NextResponse.json(
        { error: `${field} must be an array of at most 100 strings (each at most 500 characters)` },
        { status: 400 },
      );
    }
  }

  const allowedFields: Record<string, unknown> = {};
  const ALLOWED_KEYS = [
    "name", "room_type", "status", "budget_mode", "sourcing_mode",
    "priorities", "keep_items", "replace_items", "user_context", "budget_dollars",
  ];
  for (const key of ALLOWED_KEYS) {
    if (key in body) allowedFields[key] = body[key];
  }
  allowedFields.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("rooms")
    .update(allowedFields)
    .eq("id", roomId)
    .select()
    .single();

  if (error) return apiError("rooms.byId", error);
  return NextResponse.json(data);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const limited = enforceWriteRateLimit(user.id, "rooms:delete", DELETE_WRITE_LIMIT);
  if (limited) return limited;

  // Verify ownership
  const { data: room, error: roomError } = await supabase
    .from("rooms")
    .select("id, projects!inner(user_id)")
    .eq("id", roomId)
    .eq("projects.user_id", user.id)
    .single();
  // PGRST116 ("no rows") is the normal shape of "not found or not owned" here
  // — the inner join + eq(user.id) filters it out just like an ownership
  // check would — so it's not logged as a failure; a genuine DB error is.
  if (roomError && roomError.code !== "PGRST116") {
    logServerError("rooms.byId.delete.room", roomError);
  }
  if (!room) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { error } = await supabase.from("rooms").delete().eq("id", roomId);
  if (error) return apiError("rooms.byId", error);
  return NextResponse.json({ success: true });
}
