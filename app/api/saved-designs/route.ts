import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUserId } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const userId = await getCurrentUserId();

  const { data, error } = await supabase
    .from("saved_designs")
    .select("id, title, room_type, stage, thumbnail_url, created_at, updated_at, project_id, room_id")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const userId = await getCurrentUserId();

  const body = await request.json();
  const { room_id, project_id, stage } = body as {
    room_id: string;
    project_id?: string;
    stage: "assessment" | "full";
  };

  if (!room_id) {
    return NextResponse.json({ error: "room_id required" }, { status: 400 });
  }

  // Fetch room details
  const { data: room } = await supabase
    .from("rooms")
    .select("name, room_type")
    .eq("id", room_id)
    .single();

  // Fetch latest diagnosis (area_analysis)
  const { data: diagnosis } = await supabase
    .from("room_diagnoses")
    .select("diagnosis_json, design_direction_json")
    .eq("room_id", room_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!diagnosis?.diagnosis_json) {
    return NextResponse.json({ error: "No analysis found for this room" }, { status: 404 });
  }

  const djson = diagnosis.diagnosis_json as Record<string, unknown>;
  const title = (room?.name as string) || (room?.room_type as string) || "Untitled Room";

  // Build snapshot
  const snapshot: Record<string, unknown> = {
    assessment: {
      what_it_needs: djson.what_it_needs ?? [],
      what_works: djson.what_works ?? [],
      what_should_go: djson.what_should_go ?? [],
      design_direction: djson.design_direction ?? "",
      room_description: djson.summary ?? "",
      mockup_url: djson.mockup_url ?? null,
      floor_plan_dims: djson.floor_plan_dims ?? null,
    },
    metadata: {
      saved_at: new Date().toISOString(),
    },
  };

  // If stage is "full", include product search results
  if (stage === "full") {
    const { data: products } = await supabase
      .from("candidate_products")
      .select("*, product_evaluations(*)")
      .eq("room_id", room_id)
      .eq("status", "selected");

    const { data: bundles } = await supabase
      .from("product_bundles")
      .select("*, product_bundle_items(*), bundle_evaluations(*)")
      .eq("room_id", room_id);

    snapshot.products = {
      bundles: bundles ?? [],
      per_tier_products: groupByTier(products ?? []),
      validation: null,
    };
  }

  // Fetch project name for metadata
  if (project_id) {
    const { data: project } = await supabase
      .from("projects")
      .select("name, building_name")
      .eq("id", project_id)
      .single();

    if (project) {
      (snapshot.metadata as Record<string, unknown>).project_name = project.name;
      (snapshot.metadata as Record<string, unknown>).building_name = project.building_name;
    }
  }

  // Upsert: if a saved design for this room already exists, update it
  const { data: existing } = await supabase
    .from("saved_designs")
    .select("id")
    .eq("user_id", userId)
    .eq("room_id", room_id)
    .maybeSingle();

  let result;
  if (existing) {
    const { data, error } = await supabase
      .from("saved_designs")
      .update({
        stage,
        snapshot,
        title,
        room_type: room?.room_type ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    result = data;
  } else {
    const { data, error } = await supabase
      .from("saved_designs")
      .insert({
        user_id: userId,
        project_id: project_id ?? null,
        room_id,
        title,
        room_type: room?.room_type ?? null,
        stage,
        snapshot,
      })
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    result = data;
  }

  return NextResponse.json(result, { status: existing ? 200 : 201 });
}

function groupByTier(products: Array<Record<string, unknown>>): Record<string, unknown[]> {
  const grouped: Record<string, unknown[]> = { budget: [], balanced: [], high_end: [] };
  for (const p of products) {
    const tier = ((p.metadata as Record<string, unknown>)?.price_tier as string) || "balanced";
    if (!grouped[tier]) grouped[tier] = [];
    grouped[tier].push(p);
  }
  return grouped;
}
