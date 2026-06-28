import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { apiError } from "@/lib/utils/api-error";

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

  // Verify ownership
  const { data: room } = await supabase
    .from("rooms")
    .select("id, projects!inner(user_id)")
    .eq("id", roomId)
    .eq("projects.user_id", user.id)
    .single();
  if (!room) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
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

  // Verify ownership
  const { data: room } = await supabase
    .from("rooms")
    .select("id, projects!inner(user_id)")
    .eq("id", roomId)
    .eq("projects.user_id", user.id)
    .single();
  if (!room) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { error } = await supabase.from("rooms").delete().eq("id", roomId);
  if (error) return apiError("rooms.byId", error);
  return NextResponse.json({ success: true });
}
