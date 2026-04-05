import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateMockupPrompt, generateMockupImage } from "@/lib/agents/mockup-agent";
import type { MockupContext } from "@/lib/agents/mockup-agent";
import { createAgentRun, completeAgentRun } from "@/lib/db/agent-runs";
import { checkRateLimit, RATE_LIMITS } from "@/lib/utils/rate-limiter";

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

  // Rate limit
  const limit = checkRateLimit(`mockup:${user.id}`, RATE_LIMITS.mockup);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many mockup requests. Please wait a moment." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((limit.retryAfterMs || 60000) / 1000)) } }
    );
  }

  const body = await request.json();
  const { room_id, bundle_id, product_ids, vision_mode, design_direction, items_description, iteration_notes } = body;

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
    .maybeSingle();

  // Load project for building research context (finishes, flooring, walls, etc.)
  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", room.project_id)
    .single();

  const buildingResearch = project?.building_research as Record<string, unknown> | undefined;

  // Collect room image URLs for visual reference
  const roomImageUrls = (room.room_images || []).map((img: { image_url: string }) => img.image_url);

  // Extract diagnosis context that's useful for both modes
  const djson = diagnosis?.diagnosis_json as Record<string, unknown> | undefined;
  const ddJson = diagnosis?.design_direction_json as Record<string, unknown> | undefined;

  // Extract spatial/environmental context from diagnosis
  const spatialLayout = djson?.spatial_layout as string | undefined;
  const lightingConditions = djson?.lighting_conditions as string | undefined;
  const windowDoorPositions = djson?.window_door_positions as string | undefined;

  // Extract design palette/materials/textures
  const palette = (ddJson?.recommended_palette as string[]) || (djson?.recommended_palette as string[]) || [];
  const materials = (ddJson?.recommended_materials as string[]) || (djson?.recommended_materials as string[]) || [];
  const textures = (ddJson?.recommended_textures as string[]) || (djson?.recommended_textures as string[]) || [];

  // Build placement map from what_it_needs
  const placementMap: Record<string, string> = {};
  const whatItNeeds = djson?.what_it_needs as Array<{ category?: string; placement?: string }> | undefined;
  if (whatItNeeds) {
    for (const item of whatItNeeds) {
      if (item.category && item.placement) {
        placementMap[item.category] = item.placement;
      }
    }
  }

  // ─── Vision Mode: pre-search imagination mockup ─────��──────────
  if (vision_mode) {
    const agentRun = await createAgentRun(supabase, {
      room_id,
      agent_type: "mockup_vision",
      input_json: { vision_mode: true },
    });

    // Build architectural context from building research
    const archContext = buildArchitecturalContext(buildingResearch, room.room_type);

    // Build extra context for vision mode
    const existingItems = (djson?.what_works as string[]) || (djson?.what_is_working as string[]) || [];
    const keepSection = existingItems.length > 0
      ? `\nExisting furniture to KEEP in the scene:\n${existingItems.map((item, i) => `${i + 1}. ${item}`).join("\n")}`
      : "";
    const paletteSection = palette.length > 0 ? `\nColor palette: ${palette.join(", ")}` : "";
    const materialsSection = materials.length > 0 ? `\nMaterials: ${materials.join(", ")}` : "";
    const texturesSection = textures.length > 0 ? `\nTextures: ${textures.join(", ")}` : "";
    const spatialSection = spatialLayout ? `\nSpatial layout plan: ${spatialLayout}` : "";
    const lightingSection = lightingConditions ? `\nLighting conditions: ${lightingConditions}` : "";
    const windowDoorSection = windowDoorPositions ? `\nWindow/door positions: ${windowDoorPositions}` : "";
    const userContextSection = room.user_context ? `\nUser notes: "${room.user_context}" — respect these notes in the visualization.` : "";
    const prioritiesSection = room.priorities?.length ? `\nClient priorities: ${room.priorities.join(", ")}` : "";

    const iterationSection = iteration_notes
      ? `\n\nITERATION FEEDBACK — The user has seen a previous version and wants these changes:\n"${iteration_notes}"\nApply these changes while keeping everything else the same.`
      : "";

    const visionPrompt = `Generate a photorealistic interior design visualization of this ${room.room_type}.

CRITICAL — MATCH THE ACTUAL ROOM:
Study the reference photos carefully. The generated image MUST preserve:
- The EXACT same room shape, dimensions, and proportions
- The EXACT same flooring (type, color, plank direction)
- The EXACT same wall color and finish
- The EXACT same windows (shape, size, position, trim style)
- The EXACT same ceiling height and any ceiling details
- The EXACT same doorways, built-ins, and architectural features
- The same natural lighting direction and quality
${archContext}

Design direction: ${design_direction || "modern, cohesive apartment design"}${paletteSection}${materialsSection}${texturesSection}${spatialSection}${lightingSection}${windowDoorSection}${prioritiesSection}${userContextSection}${keepSection}

New furniture and decor to place in the room:
${items_description || "All recommended furniture and decor items from the diagnosis"}${iterationSection}

RULES:
- The room shell (walls, floor, ceiling, windows) must look IDENTICAL to the reference photos — same colors, same materials, same proportions.
- Only change the furniture and decor, not the architecture.
- Place furniture at realistic scale relative to the actual room size visible in photos.
- Use natural lighting consistent with the window positions in the reference photos.
- The result should look like a real photograph taken in this exact apartment, not a generic render.`;

    const imageResult = await generateMockupImage(visionPrompt, roomImageUrls);

    if (!imageResult.success || !imageResult.data) {
      await completeAgentRun(supabase, agentRun.id, {
        status: "failed",
        error_message: imageResult.error,
      });
      return NextResponse.json({ error: imageResult.error }, { status: 500 });
    }

    // Upload generated image to Supabase Storage
    const imageUrl = await uploadMockupImage(supabase, imageResult.data.image_url, imageResult.data.image_mime_type);

    await completeAgentRun(supabase, agentRun.id, {
      status: "completed",
      output_json: { image_url: imageUrl },
    });

    return NextResponse.json({
      image_url: imageUrl,
      prompt: visionPrompt,
      vision_mode: true,
    });
  }

  // ─── Standard Mode: product-based mockup ───────────────────────
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

  // Generate mockup prompt — extract diagnosis fields with fallbacks
  const diagnosisSummary = (djson?.current_vibe_summary as string)
    || (djson?.summary as string)
    || "Modern apartment room";

  // Extract existing items to keep from diagnosis
  const stdExistingItems: string[] =
    (djson?.what_works as string[])
    || (djson?.what_is_working as string[])
    || [];

  // Extract design direction
  const designDir = (ddJson?.style_notes as string)
    || (ddJson?.direction as string)
    || (djson?.design_direction as string)
    || "";

  // Build full mockup context with all available data
  const mockupCtx: MockupContext = {
    roomType: room.room_type,
    diagnosisSummary,
    existingItems: stdExistingItems,
    designDirection: designDir,
    buildingResearch,
    palette,
    materials,
    textures,
    spatialLayout,
    placementMap: Object.keys(placementMap).length > 0 ? placementMap : undefined,
    lightingConditions,
    windowDoorPositions,
    priorities: room.priorities || undefined,
    userContext: room.user_context || undefined,
    iterationNotes: iteration_notes || undefined,
  };

  const promptResult = await generateMockupPrompt(room.room_type, diagnosisSummary, products, stdExistingItems, designDir, buildingResearch, mockupCtx);

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

  // Generate image — pass room photos for visual reference
  const imageResult = await generateMockupImage(promptResult.data.prompt, roomImageUrls);

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

  // Upload generated image to Supabase Storage
  const finalImageUrl = await uploadMockupImage(supabase, imageResult.data.image_url, imageResult.data.image_mime_type);

  // Update mockup job
  await supabase
    .from("mockup_jobs")
    .update({
      status: "completed",
      prompt: promptResult.data.prompt,
      result_image_url: finalImageUrl,
      generation_provider: imageResult.data.provider,
      completed_at: new Date().toISOString(),
    })
    .eq("id", mockupJob?.id);

  await completeAgentRun(supabase, agentRun.id, {
    status: "completed",
    output_json: { image_url: finalImageUrl },
    tokens_used: promptResult.tokensUsed,
  });

  return NextResponse.json({
    id: mockupJob?.id,
    image_url: finalImageUrl,
    prompt: promptResult.data.prompt,
  });
}

/**
 * Upload base64 image data to Supabase Storage and return the public URL.
 */
async function uploadMockupImage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  base64Data: string,
  mimeType?: string,
): Promise<string> {
  const mime = mimeType || "image/png";
  const ext = mime.includes("jpeg") || mime.includes("jpg") ? "jpg" : "png";
  const fileName = `mockups/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  const buffer = Buffer.from(base64Data, "base64");

  const { data, error } = await supabase.storage
    .from("room-images")
    .upload(fileName, buffer, {
      contentType: mime,
      upsert: false,
    });

  if (error) {
    console.error("[mockup] Failed to upload image to storage:", error.message);
    // Fall back to data URI if storage upload fails
    return `data:${mime};base64,${base64Data}`;
  }

  const { data: urlData } = supabase.storage.from("room-images").getPublicUrl(data.path);
  return urlData.publicUrl;
}

/**
 * Build a text block describing the apartment's architectural details
 * from building research, so the image generator knows the exact finishes.
 */
function buildArchitecturalContext(
  br: Record<string, unknown> | undefined,
  roomType: string,
): string {
  if (!br) return "";

  const lines: string[] = [];

  const finishes = br.finishes as Record<string, string> | undefined;
  if (finishes) {
    if (finishes.flooring) lines.push(`Flooring: ${finishes.flooring}`);
    if (finishes.countertops && roomType === "kitchen") lines.push(`Countertops: ${finishes.countertops}`);
    if (finishes.cabinetry && roomType === "kitchen") lines.push(`Cabinetry: ${finishes.cabinetry}`);
    if (finishes.fixtures) lines.push(`Fixtures: ${finishes.fixtures}`);
  }

  if (br.windows) lines.push(`Windows: ${br.windows}`);
  if (br.ceiling_height) lines.push(`Ceiling height: ${br.ceiling_height}`);
  if (br.layout_style) lines.push(`Layout: ${br.layout_style}`);
  if (br.building_style) lines.push(`Building style: ${br.building_style}`);

  const fp = br.floor_plan as Record<string, unknown> | undefined;
  if (fp) {
    const dims = fp.room_dimensions as Record<string, string> | undefined;
    const roomDim = dims?.[roomType] || dims?.living_room;
    if (roomDim) lines.push(`Room dimensions: ~${roomDim}`);
    if (fp.total_sqft) lines.push(`Apartment: ~${fp.total_sqft} sqft`);
  }

  if (lines.length === 0) return "";
  return `\nKnown architectural details (from building research):\n${lines.map((l) => `- ${l}`).join("\n")}`;
}
