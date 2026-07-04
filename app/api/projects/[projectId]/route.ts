import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { apiError } from "@/lib/utils/api-error";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("projects")
    .select("*, rooms(*)")
    .eq("id", projectId)
    .eq("user_id", user.id)
    .single();

  if (error) return apiError("projects.byId", error);
  return NextResponse.json(data);
}

async function updateProject(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
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

  // Only allow known columns to prevent DB errors from unknown fields
  const allowedFields: Record<string, unknown> = {};
  const ALLOWED_KEYS = [
    "name", "description", "status", "cover_image_url",
    "bedrooms", "bathrooms", "apartment_sqft", "unit_plan_name",
    "city", "state", "neighborhood",
    "building_name", "building_url", "building_research", "apartment_analysis",
    "location_place_id", "building_place_id", "latitude", "longitude",
  ];
  for (const key of ALLOWED_KEYS) {
    if (key in body) allowedFields[key] = body[key];
  }

  // Size caps before the DB write. `building_research` / `apartment_analysis`
  // are JSONB accumulators fed by LLM research routes; a weaponized client could
  // PUT multi-MB objects to bloat the row and slow every subsequent read. Bound
  // both the serialized JSON size and the free-text string fields to generous,
  // abuse-only limits (no legitimate value approaches these).
  const MAX_JSON_BYTES = 256 * 1024; // 256 KB per JSONB accumulator field
  const MAX_STRING_LEN = 2000;
  for (const jsonKey of ["building_research", "apartment_analysis"] as const) {
    const val = allowedFields[jsonKey];
    if (val != null && JSON.stringify(val).length > MAX_JSON_BYTES) {
      return NextResponse.json(
        { error: `${jsonKey} exceeds the maximum allowed size` },
        { status: 400 },
      );
    }
  }
  for (const strKey of ["name", "description", "unit_plan_name", "city", "state", "neighborhood", "building_name", "building_url"] as const) {
    const val = allowedFields[strKey];
    if (typeof val === "string" && val.length > MAX_STRING_LEN) {
      return NextResponse.json(
        { error: `${strKey} exceeds the maximum allowed length` },
        { status: 400 },
      );
    }
  }

  allowedFields.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("projects")
    .update(allowedFields)
    .eq("id", projectId)
    .eq("user_id", user.id)
    .select()
    .single();

  if (error) {
    // Keep the rich server-side diagnostic (which field set triggered the DB
    // error) while returning a generic message to the client.
    console.error(`[projects/${projectId}] Update failed:`, error.message, "Fields:", Object.keys(allowedFields));
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
  return NextResponse.json(data);
}

export const PUT = updateProject;
export const PATCH = updateProject;

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { error } = await supabase.from("projects").delete().eq("id", projectId).eq("user_id", user.id);
  if (error) return apiError("projects.byId", error);
  return NextResponse.json({ success: true });
}
