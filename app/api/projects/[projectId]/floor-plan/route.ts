import { NextResponse } from "next/server";
import { apiError } from "@/lib/utils/api-error";
import { createClient } from "@/lib/supabase/server";
import { runFloorPlanExtraction } from "@/lib/agents/floor-plan-extractor";
import { createLogger } from "@/lib/logging/logger";
import { checkRateLimit, RATE_LIMITS } from "@/lib/utils/rate-limiter";
import { enforceWriteRateLimit, DELETE_WRITE_LIMIT } from "@/lib/utils/write-rate-limit";
import { checkDailySpend, dailySpendExceededResponse } from "@/lib/utils/spend-limiter";
import type { ExtractedFloorPlan } from "@/lib/types/database";

const log = createLogger("floor-plan-route");

// Extraction is a heavy vision/LLM call. Without an explicit maxDuration, Vercel
// applies a short platform default and can kill the function mid-run — a "builds
// green, request gets killed" failure on a paid path. 300s is the Vercel Pro
// ceiling and covers the documented worst-case latency.
export const maxDuration = 300;

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

  // Extraction is a paid vision/LLM call — gate it behind the per-user rate
  // limit + daily spend breaker so a single authed user can't drive unbounded
  // model spend (matching the other paid LLM endpoints).
  const limit = checkRateLimit(`floor-plan:${user.id}`, RATE_LIMITS.floorPlanExtract);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many floor-plan requests. Please wait a moment." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((limit.retryAfterMs || 60000) / 1000)) } },
    );
  }
  const spend = checkDailySpend(user.id);
  if (!spend.allowed) return dailySpendExceededResponse(spend);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { image_url, image_description } = body as {
    image_url?: string;
    image_description?: string;
  };

  if (!image_url || typeof image_url !== "string") {
    return NextResponse.json({ error: "image_url required" }, { status: 400 });
  }

  // SSRF guard: extraction fetches image_url server-side (runFloorPlanExtraction
  // → fetchAsBlob). fetchAsBlob reads our own uploads from local disk when the
  // URL is a relative "/uploads/..." path, but does a raw fetch() on any
  // absolute URL — so an unvalidated absolute image_url lets an authed caller
  // make the server fetch internal endpoints (169.254.169.254 IMDS, localhost,
  // private IPs). Allow only the two shapes our own POST /api/upload produces:
  //   1. a relative "/uploads/..." path (local-disk read, no external fetch), or
  //   2. an https URL on our own Supabase Storage host (the real-Storage shape).
  // Reject everything else before extraction runs. (".." blocks path traversal
  // out of public/uploads on the local-disk branch.)
  const isLocalUpload = image_url.startsWith("/uploads/") && !image_url.includes("..");
  if (!isLocalUpload) {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(image_url);
    } catch {
      return NextResponse.json({ error: "image_url is not a valid URL" }, { status: 400 });
    }
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseHost = supabaseUrl ? new URL(supabaseUrl).hostname : null;
    if (parsedUrl.protocol !== "https:" || !supabaseHost || parsedUrl.hostname !== supabaseHost) {
      return NextResponse.json(
        { error: "image_url must be an uploaded image URL" },
        { status: 400 },
      );
    }
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
    return apiError("projects.floor-plan", updateErr);
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

  // Authenticated DB write — apply the shared per-user write baseline (Track G1)
  // so a client can't hammer the projects table with clear requests, matching the
  // sibling project/room/product CRUD deletes.
  const limited = enforceWriteRateLimit(user.id, "floor-plan:delete", DELETE_WRITE_LIMIT);
  if (limited) return limited;

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
    return apiError("projects.floor-plan", updateErr);
  }

  return NextResponse.json({ success: true });
}
