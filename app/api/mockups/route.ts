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
  const { room_id, bundle_id, product_ids, vision_mode, design_direction, items_description } = body;

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

  // Collect room image URLs for visual reference
  const roomImageUrls = (room.room_images || []).map((img: { image_url: string }) => img.image_url);

  // ─── Vision Mode: pre-search imagination mockup ────────────────
  if (vision_mode) {
    const agentRun = await createAgentRun(supabase, {
      room_id,
      agent_type: "mockup_vision",
      input_json: { vision_mode: true },
    });

    const visionPrompt = `Redesign this room as a photorealistic interior design visualization of a ${room.room_type}.

Current design direction: ${design_direction || "modern, cohesive apartment design"}

Items to visualize in the room:
${items_description || "All recommended furniture and decor items from the diagnosis"}

IMPORTANT: Keep the same room architecture, layout, flooring, walls, and windows visible in the reference photos. Replace/add furniture and decor as described above. Make it look like a real photograph of a beautifully designed room. The style should be aspirational but achievable.`;

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
  const djson = diagnosis?.diagnosis_json as Record<string, unknown> | undefined;
  const diagnosisSummary = (djson?.current_vibe_summary as string)
    || (djson?.summary as string)
    || "Modern apartment room";

  // Extract existing items to keep from diagnosis
  const existingItems: string[] =
    (djson?.what_works as string[])
    || (djson?.what_is_working as string[])
    || [];

  // Extract design direction
  const ddJson = diagnosis?.design_direction_json as Record<string, unknown> | undefined;
  const designDir = (ddJson?.style_notes as string)
    || (ddJson?.direction as string)
    || (djson?.design_direction as string)
    || "";

  const promptResult = await generateMockupPrompt(room.room_type, diagnosisSummary, products, existingItems, designDir);

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
  supabase: Awaited<ReturnType<typeof createClient>>,
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
