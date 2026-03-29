import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { extractFromUrl, extractFromImage } from "@/lib/agents/product-extractor";
import { createAgentRun, completeAgentRun } from "@/lib/db/agent-runs";
import { buildDesignProfile } from "@/lib/design-context/build-profile";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { room_id, url, image_url, source_type } = body;

  if (!room_id) return NextResponse.json({ error: "room_id required" }, { status: 400 });
  if (!url && !image_url) return NextResponse.json({ error: "url or image_url required" }, { status: 400 });

  // Fetch room → project for design context
  const { data: room } = await supabase.from("rooms").select("project_id").eq("id", room_id).single();
  const { data: project } = room?.project_id
    ? await supabase.from("projects").select("*").eq("id", room.project_id).single()
    : { data: null };
  const designProfile = buildDesignProfile(project);

  // Create agent run
  const agentRun = await createAgentRun(supabase, {
    room_id,
    agent_type: "extractor",
    input_json: { url, image_url, source_type },
  });

  let result;
  if (url) {
    result = await extractFromUrl(url, designProfile);
  } else {
    result = await extractFromImage(image_url, designProfile);
  }

  if (!result.success || !result.data) {
    await completeAgentRun(supabase, agentRun.id, {
      status: "failed",
      error_message: result.error,
    });
    return NextResponse.json({ error: result.error || "Extraction failed" }, { status: 500 });
  }

  // Save product
  const { data: product, error: saveError } = await supabase
    .from("candidate_products")
    .insert({
      room_id,
      title: result.data.title,
      category: result.data.category,
      retailer: result.data.retailer,
      product_url: url || null,
      image_url: result.data.image_url || image_url || null,
      price: result.data.price,
      dimensions: result.data.dimensions,
      materials: result.data.materials,
      colors: result.data.colors,
      description: result.data.description,
      source_type: source_type || (url ? "manual_url" : "manual_upload"),
    })
    .select()
    .single();

  if (saveError) {
    return NextResponse.json({ error: saveError.message }, { status: 500 });
  }

  await completeAgentRun(supabase, agentRun.id, {
    status: "completed",
    output_json: result.data as unknown as Record<string, unknown>,
    tokens_used: result.tokensUsed,
  });

  return NextResponse.json(product, { status: 201 });
}
