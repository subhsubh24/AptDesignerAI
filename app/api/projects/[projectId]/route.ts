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
  allowedFields.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("projects")
    .update(allowedFields)
    .eq("id", projectId)
    .eq("user_id", user.id)
    .select()
    .single();

  if (error) {
    return apiError("projects.byId", error);
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
