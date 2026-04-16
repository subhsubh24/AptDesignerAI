import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { runFloorPlanExtraction } from "@/lib/agents/floor-plan-extractor";
import { createLogger } from "@/lib/logging/logger";
import type { ExtractedFloorPlan } from "@/lib/types/database";

const log = createLogger("floor-plan-route");

// ─── GET — Return current floor plan for a project ───────────────────────────

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: project, error } = await supabase
    .from("projects")
    .select("id, building_research")
    .eq("id", projectId)
    .eq("user_id", user.id)
    .single();

  if (error || !project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const br = project.building_research as Record<string, unknown> | null;
  return NextResponse.json({
    floor_plan_image_url: (br?.floor_plan_image_url as string) || null,
    extracted_floor_plan: (br?.extracted_floor_plan as ExtractedFloorPlan) || null,
  });
}

// ─── POST — Upload floor plan image URL and extract spatial data ──────────────
//
// The image must already be uploaded to storage via POST /api/upload before
// calling this endpoint. This endpoint receives the resulting image_url,
// runs extraction, and persists the results.

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { image_url, image_description } = body as {
    image_url?: string;
    image_description?: string;
  };

  if (!image_url || typeof image_url !== "string") {
    return NextResponse.json({ error: "image_url required" }, { status: 400 });
  }

  // Verify project ownership
  const { data: project, error: fetchErr } = await supabase
    .from("projects")
    .select("id, building_research")
    .eq("id", projectId)
    .eq("user_id", user.id)
    .single();

  if (fetchErr || !project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  // Run extraction
  log.info("Extracting floor plan", { projectId, image_url });
  const result = await runFloorPlanExtraction(image_url, image_description);

  if (!result.success || !result.data) {
    log.warn("Floor plan extraction failed", { projectId, error: result.error });
    return NextResponse.json(
      { error: result.error || "Floor plan extraction failed" },
      { status: 422 },
    );
  }

  const extractedFloorPlan = result.data;

  // Merge into building_research, keeping all existing fields
  const existingBr = (project.building_research as Record<string, unknown>) || {};

  // Also backfill the legacy floor_plan.* keys so agents that read
  // building_research.floor_plan (apartment-research path) still work
  const legacyRoomDimensions: Record<string, string> = {};
  for (const room of extractedFloorPlan.rooms) {
    if (room.dimensions_text) {
      legacyRoomDimensions[room.room_type] = room.dimensions_text;
    }
  }

  const updatedBr = {
    ...existingBr,
    floor_plan_image_url: image_url,
    extracted_floor_plan: extractedFloorPlan,
    // Backfill legacy path
    floor_plan: {
      ...(existingBr.floor_plan as Record<string, unknown> || {}),
      total_sqft: extractedFloorPlan.total_sqft ?? (existingBr.floor_plan as Record<string, unknown> | undefined)?.total_sqft,
      room_dimensions: {
        ...(((existingBr.floor_plan as Record<string, unknown> | undefined)?.room_dimensions) as Record<string, unknown> || {}),
        ...legacyRoomDimensions,
      },
    },
  };

  const { error: updateErr } = await supabase
    .from("projects")
    .update({ building_research: updatedBr })
    .eq("id", projectId);

  if (updateErr) {
    log.warn("Failed to save floor plan", { projectId, error: updateErr.message });
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  log.info("Floor plan saved", {
    projectId,
    rooms: extractedFloorPlan.rooms.length,
    confidence: extractedFloorPlan.confidence,
    total_sqft: extractedFloorPlan.total_sqft,
  });

  return NextResponse.json({
    floor_plan_image_url: image_url,
    extracted_floor_plan: extractedFloorPlan,
    tokens_used: result.tokensUsed,
  }, { status: 201 });
}

// ─── DELETE — Remove floor plan from project ──────────────────────────────────

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: project, error: fetchErr } = await supabase
    .from("projects")
    .select("id, building_research")
    .eq("id", projectId)
    .eq("user_id", user.id)
    .single();

  if (fetchErr || !project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const existingBr = (project.building_research as Record<string, unknown>) || {};
  const { floor_plan_image_url: _url, extracted_floor_plan: _efp, ...restBr } = existingBr;

  const { error: updateErr } = await supabase
    .from("projects")
    .update({ building_research: restBr })
    .eq("id", projectId);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
