import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parsePagination } from "@/lib/utils/pagination";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const projectId = request.nextUrl.searchParams.get("project_id");
  if (!projectId) return NextResponse.json({ error: "project_id required" }, { status: 400 });

  const { offset, rangeEnd } = parsePagination(request.nextUrl.searchParams, { defaultLimit: 100, maxLimit: 300 });

  const { data, error } = await supabase
    .from("rooms")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true })
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
  const { project_id, name, room_type, budget_mode, sourcing_mode, priorities, keep_items, replace_items } = body;

  if (!project_id || !name?.trim() || !room_type) {
    return NextResponse.json({ error: "project_id, name, and room_type are required" }, { status: 400 });
  }

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

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
