import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { evaluateBundle } from "@/lib/agents/bundle-optimizer";
import { createAgentRun, completeAgentRun } from "@/lib/db/agent-runs";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { bundle_id } = body;
  if (!bundle_id) return NextResponse.json({ error: "bundle_id required" }, { status: 400 });

  // Fetch bundle with items
  const { data: bundle } = await supabase
    .from("product_bundles")
    .select("*, product_bundle_items(*, candidate_products(*))")
    .eq("id", bundle_id)
    .single();

  if (!bundle) return NextResponse.json({ error: "Bundle not found" }, { status: 404 });

  const products = (bundle.product_bundle_items || []).map(
    (item: { candidate_products: unknown }) => item.candidate_products
  );

  // Fetch room images
  const { data: room } = await supabase
    .from("rooms")
    .select("*, room_images(*)")
    .eq("id", bundle.room_id)
    .single();

  const roomImageUrls = (room?.room_images || []).map((img: { image_url: string }) => img.image_url);

  // Create agent run
  const agentRun = await createAgentRun(supabase, {
    room_id: bundle.room_id,
    agent_type: "bundler",
    input_json: { bundle_id, product_count: products.length },
  });

  const result = await evaluateBundle(products, room?.room_type || "living_room", roomImageUrls);

  if (!result.success || !result.data) {
    await completeAgentRun(supabase, agentRun.id, {
      status: "failed",
      error_message: result.error,
    });
    return NextResponse.json({ error: result.error || "Bundle evaluation failed" }, { status: 500 });
  }

  // Save evaluation
  const { data: evaluation, error: saveError } = await supabase
    .from("bundle_evaluations")
    .insert({
      bundle_id,
      ...result.data.scores,
      final_bundle_score: result.data.final_bundle_score,
      verdict: result.data.verdict,
      analysis: result.data.analysis,
      model_used: result.model,
    })
    .select()
    .single();

  if (saveError) return NextResponse.json({ error: saveError.message }, { status: 500 });

  await supabase
    .from("product_bundles")
    .update({ status: "evaluated", updated_at: new Date().toISOString() })
    .eq("id", bundle_id);

  await completeAgentRun(supabase, agentRun.id, {
    status: "completed",
    output_json: result.data as unknown as Record<string, unknown>,
    tokens_used: result.tokensUsed,
  });

  return NextResponse.json(evaluation, { status: 201 });
}
