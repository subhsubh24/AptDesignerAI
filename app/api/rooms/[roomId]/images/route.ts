import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { apiError } from "@/lib/utils/api-error";
import { userOwnsRoom } from "@/lib/auth/ownership";
import { checkRateLimit } from "@/lib/utils/rate-limiter";

// Room-image writes are cheap DB rows, but an authenticated client can still
// spam create/delete to bloat storage-adjacent tables or thrash the row. A
// generous per-user cap (60/min) stops abuse without rejecting any real
// upload/delete burst (mirrors the mobile-save inline-config pattern).
const ROOM_IMAGE_WRITE_LIMIT = { maxRequests: 60, windowMs: 60_000 } as const;

function rateLimited(userId: string): NextResponse | null {
  const limit = checkRateLimit(`room-images:${userId}`, ROOM_IMAGE_WRITE_LIMIT);
  if (limit.allowed) return null;
  return NextResponse.json(
    { error: "Too many image requests. Please wait a moment." },
    { status: 429, headers: { "Retry-After": String(Math.ceil((limit.retryAfterMs ?? 60000) / 1000)) } },
  );
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await userOwnsRoom(supabase, roomId, user.id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("room_images")
    .select("*")
    .eq("room_id", roomId)
    .order("created_at", { ascending: true });

  if (error) return apiError("rooms.images", error);
  return NextResponse.json(data);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const limited = rateLimited(user.id);
  if (limited) return limited;
  if (!(await userOwnsRoom(supabase, roomId, user.id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { image_url, image_type, storage_path, caption } = body;

  if (!image_url) {
    return NextResponse.json({ error: "image_url is required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("room_images")
    .insert({
      room_id: roomId,
      image_url,
      image_type: image_type || "room",
      storage_path,
      caption,
    })
    .select()
    .single();

  if (error) return apiError("rooms.images", error);
  return NextResponse.json(data, { status: 201 });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const limited = rateLimited(user.id);
  if (limited) return limited;
  if (!(await userOwnsRoom(supabase, roomId, user.id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { image_id } = body;

  if (!image_id) {
    return NextResponse.json({ error: "image_id is required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("room_images")
    .delete()
    .eq("id", image_id)
    .eq("room_id", roomId);

  if (error) return apiError("rooms.images", error);
  return NextResponse.json({ success: true });
}
