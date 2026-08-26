import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { apiError } from "@/lib/utils/api-error";
import { parsePagination } from "@/lib/utils/pagination";
import { requireRoomOwnership } from "@/lib/auth/ownership";
import { enforceWriteRateLimit } from "@/lib/utils/write-rate-limit";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const roomId = searchParams.get("room_id");
  if (!roomId) return NextResponse.json({ error: "room_id required" }, { status: 400 });

  // Ownership guard: room_id is client-supplied and the memory-store query is not
  // user-scoped, so without this check any authenticated caller could enumerate
  // another user's candidate products + evaluations (IDOR). The POST handler
  // already guards this way; the GET read was missing it.
  const getOwnership = await requireRoomOwnership(supabase, roomId, user.id);
  if (getOwnership) return getOwnership;

  const { offset, rangeEnd } = parsePagination(searchParams, { defaultLimit: 200, maxLimit: 500 });

  // Nested product_evaluations(*) narrowed to only the columns the client
  // actually reads (products/page.tsx, compare/page.tsx, focus/page.tsx) —
  // id/product_id/room_id/model_used/created_at are never used client-side.
  // See APT-48.
  const { data, error } = await supabase
    .from("candidate_products")
    .select(
      "*, product_evaluations(final_item_score, verdict, confidence_score, style_fit_score, " +
        "palette_fit_score, material_fit_score, scale_fit_score, function_fit_score, " +
        "cohesion_fit_score, value_fit_score, reasoning)",
    )
    .eq("room_id", roomId)
    .order("created_at", { ascending: false })
    .range(offset, rangeEnd);

  if (error) return apiError("products", error);
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const limited = enforceWriteRateLimit(user.id, "products");
  if (limited) return limited;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.room_id) return NextResponse.json({ error: "room_id required" }, { status: 400 });
  const postOwnership = await requireRoomOwnership(supabase, body.room_id, user.id);
  if (postOwnership) return postOwnership;

  // Server-side input validation (client Zod is UX, not security): reject
  // oversized/wrong-typed writes before they reach the DB (Track G2). Types
  // mirror CandidateProduct: strings, string[] (materials/colors), and JSON
  // objects (dimensions/metadata). Bounds are generous — abuse-only.
  const STRING_FIELDS = [
    "title", "category", "retailer", "product_url", "image_url",
    "description", "source_type", "search_session_id",
  ] as const;
  for (const f of STRING_FIELDS) {
    const v = body[f];
    if (v !== undefined && v !== null && (typeof v !== "string" || v.length > 2000)) {
      return NextResponse.json({ error: `${f} must be a string of at most 2000 characters` }, { status: 400 });
    }
  }
  if (body.price !== undefined && body.price !== null && (typeof body.price !== "number" || !Number.isFinite(body.price))) {
    return NextResponse.json({ error: "price must be a finite number" }, { status: 400 });
  }
  for (const f of ["materials", "colors"] as const) {
    const v = body[f];
    if (v !== undefined && v !== null && (!Array.isArray(v) || v.length > 100 || v.some((x) => typeof x !== "string" || x.length > 500))) {
      return NextResponse.json({ error: `${f} must be an array of at most 100 strings (each at most 500 characters)` }, { status: 400 });
    }
  }
  for (const f of ["dimensions", "metadata"] as const) {
    const v = body[f];
    if (v !== undefined && v !== null && (typeof v !== "object" || Array.isArray(v) || JSON.stringify(v).length > 50_000)) {
      return NextResponse.json({ error: `${f} must be an object of at most 50KB` }, { status: 400 });
    }
  }

  // search_session_id is client-supplied and was only length-validated, never
  // bound to anything the caller owns — so a product could be filed under
  // ANOTHER tenant's search session. No read path joins the two today, so this
  // is not a cross-tenant read; it is a foreign key pointing outside the
  // caller's data, which silently corrupts any future "products from this
  // search" query. Bind it to the SAME room the ownership check above already
  // cleared (search_sessions.room_id, indexed since 001), and reject rather
  // than nulling: a caller sending a session from a different room has a bug,
  // and quietly dropping the field would hide it.
  if (body.search_session_id) {
    const { data: session, error: sessionError } = await supabase
      .from("search_sessions")
      .select("id")
      .eq("id", body.search_session_id)
      .eq("room_id", body.room_id)
      .maybeSingle();
    if (sessionError) return apiError("products.search_session_ownership", sessionError);
    if (!session) {
      return NextResponse.json(
        { error: "search_session_id does not belong to this room" },
        { status: 400 },
      );
    }
  }

  const row = {
    room_id: body.room_id,
    title: body.title,
    category: body.category,
    retailer: body.retailer,
    product_url: body.product_url,
    image_url: body.image_url,
    price: body.price,
    dimensions: body.dimensions,
    materials: body.materials,
    colors: body.colors,
    description: body.description,
    source_type: body.source_type,
    metadata: body.metadata,
    search_session_id: body.search_session_id,
  };

  const { data, error } = await supabase
    .from("candidate_products")
    .insert(row)
    .select()
    .single();

  if (error) return apiError("products", error);
  return NextResponse.json(data, { status: 201 });
}
