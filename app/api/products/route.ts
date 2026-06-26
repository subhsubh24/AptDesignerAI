import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
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

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
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

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
