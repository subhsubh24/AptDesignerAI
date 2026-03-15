import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateMockupPrompt, generateMockupImage } from "@/lib/agents/mockup-agent";
import { createAgentRun, completeAgentRun } from "@/lib/db/agent-runs";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const roomId = request.nextUrl.searchParams.get("room_id");
  if (!roomId) return NextResponse.json({ error: "room_id required" }, { status: 400 });

  const { data, error } = await supabase
    .from("mockup_jobs")
    .select("*")
    .eq("room_id", roomId)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { room_id, bundle_id, product_ids } = body;

  if (!room_id) return NextResponse.json({ error: "room_id required" }, { status: 400 });

  // Fetch room and diagnosis
  const { data: room } = await supabase
    .from("rooms")
    .select("*, room_images(*)")
    .eq("id", room_id)
    .single();

  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

  const { data: diagnosis } = await supabase
    .from("room_diagnoses")
    .select("*")
    .eq("room_id", room_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  // Fetch products
  let products;
  if (bundle_id) {
    const { data } = await supabase
      .from("product_bundle_items")
      .select("candidate_products(*)")
      .eq("bundle_id", bundle_id);
    products = (data || []).map((item: { candidate_products: unknown }) => item.candidate_products);
  } else if (product_ids?.length) {
    const { data } = await supabase
      .from("candidate_products")
      .select("*")
      .in("id", product_ids);
    products = data || [];
  } else {
    return NextResponse.json({ error: "bundle_id or product_ids required" }, { status: 400 });
  }

  // Create mockup job
  const { data: mockupJob } = await supabase
    .from("mockup_jobs")
    .insert({
      room_id,
      bundle_id,
      selected_products: products,
      status: "generating",
    })
    .select()
    .single();

  // Create agent run
  const agentRun = await createAgentRun(supabase, {
    room_id,
    agent_type: "mockup",
    input_json: { bundle_id, product_count: products.length },
  });

  // Generate mockup prompt
  const diagnosisSummary = diagnosis?.diagnosis_json
    ? (diagnosis.diagnosis_json as { current_vibe_summary?: string }).current_vibe_summary || "Modern apartment room"
    : "Modern apartment room";

  const promptResult = await generateMockupPrompt(room.room_type, diagnosisSummary, products);

  if (!promptResult.success || !promptResult.data) {
    await supabase
      .from("mockup_jobs")
      .update({ status: "failed", error_message: promptResult.error })
      .eq("id", mockupJob?.id);
    await completeAgentRun(supabase, agentRun.id, {
      status: "failed",
      error_message: promptResult.error,
    });
    return NextResponse.json({ error: promptResult.error }, { status: 500 });
  }

  // Generate image
  const imageResult = await generateMockupImage(promptResult.data.prompt);

  if (!imageResult.success || !imageResult.data) {
    await supabase
      .from("mockup_jobs")
      .update({
        status: "failed",
        prompt: promptResult.data.prompt,
        error_message: imageResult.error,
      })
      .eq("id", mockupJob?.id);
    await completeAgentRun(supabase, agentRun.id, {
      status: "failed",
      error_message: imageResult.error,
    });
    return NextResponse.json({ error: imageResult.error }, { status: 500 });
  }

  // Update mockup job
  await supabase
    .from("mockup_jobs")
    .update({
      status: "completed",
      prompt: promptResult.data.prompt,
      result_image_url: imageResult.data.image_url,
      generation_provider: imageResult.data.provider,
      completed_at: new Date().toISOString(),
    })
    .eq("id", mockupJob?.id);

  await completeAgentRun(supabase, agentRun.id, {
    status: "completed",
    output_json: { image_url: imageResult.data.image_url },
    tokens_used: promptResult.tokensUsed,
  });

  return NextResponse.json({
    id: mockupJob?.id,
    image_url: imageResult.data.image_url,
    prompt: promptResult.data.prompt,
  });
}
