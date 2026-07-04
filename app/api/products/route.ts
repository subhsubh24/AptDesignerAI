import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { apiError } from "@/lib/utils/api-error";
import { parsePagination } from "@/lib/utils/pagination";
import { userOwnsRoom } from "@/lib/auth/ownership";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const roomId = searchParams.get("room_id");
  if (!roomId) return NextResponse.json({ error: "room_id required" }, { status: 400 });

  const { offset, rangeEnd } = parsePagination(searchParams, { defaultLimit: 200, maxLimit: 500 });

  const { data, error } = await supabase
    .from("candidate_products")
    .select("*, product_evaluations(*)")
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.room_id) return NextResponse.json({ error: "room_id required" }, { status: 400 });
  if (!(await userOwnsRoom(supabase, body.room_id, user.id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

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
