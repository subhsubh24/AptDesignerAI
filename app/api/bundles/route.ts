import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { apiError, logServerError } from "@/lib/utils/api-error";
import { userOwnsRoom } from "@/lib/auth/ownership";
import { parsePagination } from "@/lib/utils/pagination";
import { enforceWriteRateLimit } from "@/lib/utils/write-rate-limit";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const roomId = searchParams.get("room_id");
  if (!roomId) return NextResponse.json({ error: "room_id required" }, { status: 400 });
  if (!(await userOwnsRoom(supabase, roomId, user.id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { offset, rangeEnd } = parsePagination(searchParams, { defaultLimit: 100, maxLimit: 300 });

  const { data, error } = await supabase
    .from("product_bundles")
    .select("*, product_bundle_items(*, candidate_products(*)), bundle_evaluations(*)")
    .eq("room_id", roomId)
    .order("created_at", { ascending: false })
    .range(offset, rangeEnd);

  if (error) return apiError("bundles", error);
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const limited = enforceWriteRateLimit(user.id, "bundles");
  if (limited) return limited;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { room_id, name, product_ids } = body;

  if (!room_id) return NextResponse.json({ error: "room_id required" }, { status: 400 });

  // Server-side input validation (client Zod is UX, not security): bound the
  // write before it reaches the DB (Track G2). Bounds are generous — they only
  // stop abuse (unbounded name / unbounded product_ids fan-out), not real use.
  if (name !== undefined && name !== null && (typeof name !== "string" || name.length > 200)) {
    return NextResponse.json({ error: "name must be a string of at most 200 characters" }, { status: 400 });
  }
  if (product_ids !== undefined && product_ids !== null) {
    if (
      !Array.isArray(product_ids) ||
      product_ids.length > 200 ||
      product_ids.some((id: unknown) => typeof id !== "string" || id.length > 200)
    ) {
      return NextResponse.json(
        { error: "product_ids must be an array of at most 200 id strings (each at most 200 characters)" },
        { status: 400 },
      );
    }
  }

  if (!(await userOwnsRoom(supabase, room_id, user.id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Create bundle
  const { data: bundle, error: bundleError } = await supabase
    .from("product_bundles")
    .insert({ room_id, name })
    .select()
    .single();

  if (bundleError) return apiError("bundles", bundleError);

  // Add items if provided. If this insert fails, the bundle would otherwise be
  // returned as a 201 success with zero items — a silent partial failure that
  // makes a later evaluate request score an empty bundle. Surface the error and
  // remove the now-orphaned bundle row so the caller can safely retry.
  if (product_ids && product_ids.length > 0) {
    const items = product_ids.map((pid: string, i: number) => ({
      bundle_id: bundle.id,
      product_id: pid,
      sort_order: i,
    }));
    const { error: itemsError } = await supabase.from("product_bundle_items").insert(items);
    if (itemsError) {
      // A multi-row insert is atomic, so on error zero items were written —
      // remove the now-orphaned bundle. If the cleanup itself fails, log it so
      // the orphan is observable (the caller still gets the error response).
      const { error: cleanupError } = await supabase.from("product_bundles").delete().eq("id", bundle.id);
      if (cleanupError) logServerError("bundles.cleanup", cleanupError);
      return apiError("bundles", itemsError);
    }
  }

  return NextResponse.json(bundle, { status: 201 });
}
