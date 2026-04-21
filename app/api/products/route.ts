import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parsePagination } from "@/lib/utils/pagination";

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

  const body = await request.json();
  const { data, error } = await supabase
    .from("candidate_products")
    .insert(body)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
