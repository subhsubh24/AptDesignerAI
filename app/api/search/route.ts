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

  // Fetch project for floor plan context
  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", room.project_id)
    .single();

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

  // Categories can be strings or rich objects { category, search_title, specs }
  const rawCategories = categories && categories.length > 0
    ? categories
    : ["rug", "coffee_table", "accent_chair"];

  const missingCategories: string[] = rawCategories.map(
    (c: string | { category: string }) => typeof c === "string" ? c : c.category
  );

  // Build search hints from rich category objects (search_title, specs)
  const categoryHints: Record<string, string> = {};
  if (Array.isArray(categories)) {
    for (const c of categories) {
      if (typeof c === "object" && c.category) {
        const parts: string[] = [];
        if (c.search_title) parts.push(c.search_title);
        if (c.specs) parts.push(typeof c.specs === "string" ? c.specs : JSON.stringify(c.specs));
        if (parts.length > 0) categoryHints[c.category] = parts.join(" — ");
      }
    }
  }

  // Inject floor plan context into category hints so search queries include correct sizing
  if (project?.building_research) {
    const br = project.building_research as Record<string, unknown>;
    const fp = br.floor_plan as Record<string, unknown> | undefined;
    if (fp) {
      const dims = fp.room_dimensions as Record<string, string> | undefined;
      const roomDim = dims?.[room.room_type] || dims?.living_room;
      const spatialNotes = Array.isArray(fp.notable_spatial_features)
        ? fp.notable_spatial_features.join(", ")
        : "";
      const floorPlanHint = [
        roomDim ? `Room dimensions: ~${roomDim}` : "",
        fp.total_sqft ? `Apartment: ~${fp.total_sqft} sqft` : "",
        fp.living_dining_combined ? "Combined living/dining space" : "",
        spatialNotes ? `Layout notes: ${spatialNotes}` : "",
      ].filter(Boolean).join(". ");

      if (floorPlanHint) {
        categoryHints["_floor_plan"] = floorPlanHint;
      }
    }
  }

  console.log(`[search] Starting agentic search for categories: ${missingCategories.join(", ")}`);

  const result = await runAgenticSearch(ctx, missingCategories, undefined, categoryHints);

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
