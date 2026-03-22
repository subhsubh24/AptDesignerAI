import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { runAgenticSearch } from "@/lib/agents/orchestrator";
import { createAgentRun, completeAgentRun } from "@/lib/db/agent-runs";
import type { AgentContext } from "@/lib/agents/types";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { room_id, categories } = body;

  if (!room_id) return NextResponse.json({ error: "room_id required" }, { status: 400 });

  // Fetch room
  const { data: room } = await supabase
    .from("rooms")
    .select("*, room_images(*)")
    .eq("id", room_id)
    .single();

  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

  // Create search session
  const { data: session } = await supabase
    .from("search_sessions")
    .insert({
      room_id,
      mode: "agentic",
      categories_to_search: categories,
    })
    .select()
    .single();

  // Create agent run
  const agentRun = await createAgentRun(supabase, {
    room_id,
    search_session_id: session?.id,
    agent_type: "researcher",
    input_json: { categories },
  });

  const imageUrls = (room.room_images || []).map((img: { image_url: string }) => img.image_url);

  const ctx: AgentContext = {
    roomId: room_id,
    roomType: room.room_type,
    keepItems: room.keep_items || [],
    replaceItems: room.replace_items || [],
    priorities: room.priorities || [],
    budgetMode: room.budget_mode,
    sourcingMode: room.sourcing_mode,
    imageUrls,
  };

  const missingCategories = categories && categories.length > 0
    ? categories
    : ["rug", "coffee_table", "accent_chair"];

  console.log(`[search] Starting agentic search for categories: ${missingCategories.join(", ")}`);

  const result = await runAgenticSearch(ctx, missingCategories);

  if (!result.success || !result.data) {
    console.error("[search] Failed:", result.error);
    await completeAgentRun(supabase, agentRun.id, {
      status: "failed",
      error_message: result.error,
    });
    return NextResponse.json({ error: result.error || "Search failed" }, { status: 500 });
  }

  console.log(`[search] Complete. Found ${Object.values(result.data.candidatesByCategory).flat().length} products`);

  // Save all discovered products to DB with tier metadata
  const savedProducts = [];
  for (const [, products] of Object.entries(result.data.candidatesByCategory)) {
    for (const product of products) {
      const { data: saved } = await supabase
        .from("candidate_products")
        .insert({
          room_id,
          search_session_id: session?.id,
          title: product.title,
          category: product.category,
          retailer: product.retailer,
          product_url: product.product_url,
          image_url: product.image_url,
          price: product.price,
          dimensions: product.dimensions,
          materials: product.materials,
          colors: product.colors,
          description: product.description,
          source_type: "agentic_search",
          metadata: product.metadata,
        })
        .select()
        .single();

      if (saved) {
        savedProducts.push(saved);
        // Save evaluation if exists
        const evaluation = result.data.evaluations.get(product.id);
        if (evaluation) {
          await supabase.from("product_evaluations").insert({
            product_id: saved.id,
            room_id,
            ...evaluation.scores,
            final_item_score: evaluation.final_item_score,
            verdict: evaluation.verdict,
            reasoning: evaluation.reasoning,
          });
          await supabase
            .from("candidate_products")
            .update({ status: "evaluated" })
            .eq("id", saved.id);
        }
      }
    }
  }

  // Update search session
  await supabase
    .from("search_sessions")
    .update({ status: "completed", updated_at: new Date().toISOString() })
    .eq("id", session?.id);

  // Update room status
  await supabase
    .from("rooms")
    .update({ status: "sourcing", updated_at: new Date().toISOString() })
    .eq("id", room_id);

  await completeAgentRun(supabase, agentRun.id, {
    status: "completed",
    output_json: {
      products_found: savedProducts.length,
      categories_searched: Object.keys(result.data.candidatesByCategory),
      steps_count: result.data.steps.length,
    },
  });

  return NextResponse.json({
    session_id: session?.id,
    products_found: savedProducts.length,
    products: savedProducts,
    steps: result.data.steps,
    stats: result.data.stats,
    validation: result.data.validation,
  });
}
