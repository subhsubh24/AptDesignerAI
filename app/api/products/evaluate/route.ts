import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { scoreProduct } from "@/lib/agents/fit-scorer";
import { createAgentRun, completeAgentRun } from "@/lib/db/agent-runs";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { product_id, room_id } = body;

  if (!product_id || !room_id) {
    return NextResponse.json({ error: "product_id and room_id required" }, { status: 400 });
  }

  // Fetch product and room
  const [productRes, roomRes] = await Promise.all([
    supabase.from("candidate_products").select("*").eq("id", product_id).single(),
    supabase.from("rooms").select("*, room_images(*)").eq("id", room_id).single(),
  ]);

  if (productRes.error || !productRes.data) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }
  if (roomRes.error || !roomRes.data) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  const product = productRes.data;
  const room = roomRes.data;
  const roomImageUrls = (room.room_images || []).map((img: { image_url: string }) => img.image_url);

  // Build cross-room context
  let otherRoomsContext: string | undefined;
  const { data: otherRooms } = await supabase
    .from("rooms")
    .select("name, room_type, room_diagnoses(diagnosis_json)")
    .eq("project_id", room.project_id)
    .neq("id", room_id);

  if (otherRooms && otherRooms.length > 0) {
    otherRoomsContext = otherRooms
      .map((r: any) => {
        const diag = r.room_diagnoses?.[r.room_diagnoses.length - 1];
        const summary = diag
          ? (diag.diagnosis_json as Record<string, string>).summary || "analyzed"
          : "not analyzed";
        return `- ${r.name} (${r.room_type}): ${summary}`;
      })
      .join("\n");
  }

  // Create agent run
  const agentRun = await createAgentRun(supabase, {
    room_id,
    agent_type: "scorer",
    input_json: { product_id, product_title: product.title },
  });

  const result = await scoreProduct(
    product,
    room.room_type,
    room.budget_mode,
    room.keep_items || [],
    roomImageUrls,
    otherRoomsContext
  );

  if (!result.success || !result.data) {
    await completeAgentRun(supabase, agentRun.id, {
      status: "failed",
      error_message: result.error,
    });
    return NextResponse.json({ error: result.error || "Scoring failed" }, { status: 500 });
  }

  // Save evaluation (include area/apartment fit notes in reasoning)
  const reasoning = {
    ...result.data.reasoning,
    area_fit_note: result.data.area_fit_note,
    apartment_fit_note: result.data.apartment_fit_note,
  };

  const { data: evaluation, error: saveError } = await supabase
    .from("product_evaluations")
    .insert({
      product_id,
      room_id,
      ...result.data.scores,
      final_item_score: result.data.final_item_score,
      verdict: result.data.verdict,
      reasoning,
      model_used: result.model,
    })
    .select()
    .single();

  if (saveError) {
    return NextResponse.json({ error: saveError.message }, { status: 500 });
  }

  // Update product status
  await supabase
    .from("candidate_products")
    .update({ status: "evaluated", updated_at: new Date().toISOString() })
    .eq("id", product_id);

  await completeAgentRun(supabase, agentRun.id, {
    status: "completed",
    output_json: result.data as unknown as Record<string, unknown>,
    tokens_used: result.tokensUsed,
  });

  return NextResponse.json(evaluation, { status: 201 });
}
