import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { apiError } from "@/lib/utils/api-error";
import { parsePagination } from "@/lib/utils/pagination";
import { enforceWriteRateLimit } from "@/lib/utils/write-rate-limit";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const { offset, rangeEnd } = parsePagination(searchParams, { defaultLimit: 100, maxLimit: 500 });

  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .range(offset, rangeEnd);

  if (error) return apiError("projects", error);
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const limited = enforceWriteRateLimit(user.id, "projects");
  if (limited) return limited;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { name, description } = body;

  if (!name?.trim()) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  // Server-side input validation (client Zod is UX, not security): cap the
  // free-text fields so a malformed/oversized write can't bloat the DB (G2).
  if (typeof name !== "string" || name.trim().length > 200) {
    return NextResponse.json({ error: "name must be a string of at most 200 characters" }, { status: 400 });
  }
  if (description !== undefined && description !== null && (typeof description !== "string" || description.length > 5000)) {
    return NextResponse.json({ error: "description must be a string of at most 5000 characters" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("projects")
    .insert({ name: name.trim(), description: description?.trim(), user_id: user.id })
    .select()
    .single();

  if (error) return apiError("projects", error);
  return NextResponse.json(data, { status: 201 });
}
