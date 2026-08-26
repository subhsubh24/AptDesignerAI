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

  // Narrowed to what the dashboard's "load existing project" flow actually
  // reads (app/dashboard/page.tsx). Drops apartment_analysis (an unused jsonb
  // blob) plus name/description/status/cover_image_url/location_place_id/
  // building_place_id/latitude/longitude/unit_plan_name/created_at/user_id,
  // none of which this list consumer touches. building_research stays — it IS
  // read (project.building_research) to restore onboarding state. See APT-65.
  const { data, error } = await supabase
    .from("projects")
    .select("id, bedrooms, bathrooms, apartment_sqft, city, state, neighborhood, building_name, building_url, building_research")
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
