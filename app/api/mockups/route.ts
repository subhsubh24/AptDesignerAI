import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { createClient } from "@/lib/supabase/server";
import { generateMockupPrompt, generateMockupImage, buildMockupContext } from "@/lib/agents/mockup-agent";
import type { MockupImageOptions } from "@/lib/agents/mockup-agent";
import { validateMockupPrompt } from "@/lib/agents/mockup-prompt-validator";
import { generateWithVerification } from "@/lib/agents/mockup-verifier";
import { analyzePhotoOrientations } from "@/lib/agents/photo-orientation-analyzer";
import { extractRoomArchitecture, formatArchitectureForPrompt } from "@/lib/agents/room-architecture-extractor";
import { getRoomFromFloorPlan } from "@/lib/agents/format-floor-plan";
import type { ExtractedFloorPlan } from "@/lib/types/database";
import { IMAGE_GENERATION_CONFIG } from "@/lib/config/pipeline";
import type { ImageSize, ImageAspectRatio } from "@/lib/ai/provider";
import { createAgentRun, completeAgentRun } from "@/lib/db/agent-runs";
import { checkRateLimit, RATE_LIMITS } from "@/lib/utils/rate-limiter";
import { userOwnsRoom } from "@/lib/auth/ownership";
import { parsePagination } from "@/lib/utils/pagination";

/**
 * Canonical JSON stringify — keys sorted recursively. Used for building
 * cache keys where any ordering drift in a Map/object could defeat the cache.
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson((value as Record<string, unknown>)[k])).join(",") + "}";
}

/**
 * Compute a content-addressed cache key for a mockup render. Identical
 * (room photos, product set, placement map, style prompt) → identical key
 * → identical saved file. Subsequent requests with the same inputs short-
 * circuit the (expensive) image model call.
 */
function computeMockupCacheKey(input: {
  roomImageUrls: string[];
  productIds: string[];
  placementMap: Record<string, string> | undefined;
  designDirection: string;
  iterationNotes?: string;
  imageSize?: string;
  aspectRatio?: string;
  grounded?: boolean;
}): string {
  const payload = [
    [...input.roomImageUrls].sort().join("|"),
    [...input.productIds].sort().join(","),
    canonicalJson(input.placementMap ?? {}),
    input.designDirection || "",
    input.iterationNotes || "",
    input.imageSize || "",
    input.aspectRatio || "",
    input.grounded ? "grounded" : "",
  ].join("||");
  return crypto.createHash("sha256").update(payload).digest("hex").slice(0, 32);
}

/**
 * Validate incoming resolution / aspect ratio from the request body against
 * the allowed set from IMAGE_GENERATION_CONFIG. Falls back to defaults on
 * invalid input so a bad client can't break rendering.
 */
function resolveImageOptions(body: Record<string, unknown>): MockupImageOptions {
  const rawSize = body.image_size as string | undefined;
  const rawAspect = body.aspect_ratio as string | undefined;
  const rawGrounding = body.image_search_grounding as boolean | undefined;
  const rawRefs = body.grounding_references as unknown;

  const imageSize = (IMAGE_GENERATION_CONFIG.allowedImageSizes as readonly string[]).includes(rawSize || "")
    ? (rawSize as ImageSize)
    : (IMAGE_GENERATION_CONFIG.defaultImageSize as ImageSize);

  const aspectRatio = (IMAGE_GENERATION_CONFIG.allowedAspectRatios as readonly string[]).includes(rawAspect || "")
    ? (rawAspect as ImageAspectRatio)
    : (IMAGE_GENERATION_CONFIG.defaultAspectRatio as ImageAspectRatio);

  const groundingReferences = Array.isArray(rawRefs)
    ? (rawRefs as unknown[]).filter((r): r is string => typeof r === "string" && r.length > 0).slice(0, 10)
    : undefined;

  return {
    imageSize,
    aspectRatio,
    imageSearchGrounding: typeof rawGrounding === "boolean"
      ? rawGrounding
      : IMAGE_GENERATION_CONFIG.imageSearchGroundingDefault,
    groundingReferences,
  };
}

/**
 * Check the local filesystem mockups dir for an already-rendered image at
 * the given cache key. Returns the public URL if present, null otherwise.
 */
function findCachedMockup(cacheKey: string): { url: string } | null {
  const mockupsDir = path.join(process.cwd(), "public", "uploads", "room-images", "mockups");
  try {
    if (!fs.existsSync(mockupsDir)) return null;
    const files = fs.readdirSync(mockupsDir);
    const hit = files.find((f) => f.startsWith(cacheKey + "."));
    if (hit) return { url: `/uploads/room-images/mockups/${hit}` };
  } catch {
    // Ignore — fall through to regenerate
  }
  return null;
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const roomId = request.nextUrl.searchParams.get("room_id");
  if (!roomId) return NextResponse.json({ error: "room_id required" }, { status: 400 });
  if (!(await userOwnsRoom(supabase, roomId, user.id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { offset, rangeEnd } = parsePagination(request.nextUrl.searchParams, { defaultLimit: 100, maxLimit: 300 });

  const { data, error } = await supabase
    .from("mockup_jobs")
    .select("*")
    .eq("room_id", roomId)
    .order("created_at", { ascending: false })
    .range(offset, rangeEnd);

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
  const { room_id, bundle_id, product_ids, vision_mode, recommendation_mockup, design_direction, items_description, iteration_notes } = body;

  if (!room_id) return NextResponse.json({ error: "room_id required" }, { status: 400 });
  if (!(await userOwnsRoom(supabase, room_id, user.id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Resolve optional Nano Banana 2 image generation options (resolution,
  // aspect ratio, Image Search Grounding). Accepts body fields:
  //   image_size: "0.5K" | "1K" | "2K" | "4K"
  //   aspect_ratio: "1:1" | "16:9" | "4:3" | "1:4" | "4:1" | ...
  //   image_search_grounding: boolean (default: true)
  //   grounding_references: string[] — product/style hints for web search
  const imageOptions = resolveImageOptions(body);

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
  const floorPlanImageUrl = buildingResearch?.floor_plan_image_url as string | undefined;
  const extractedFloorPlan = buildingResearch?.extracted_floor_plan as ExtractedFloorPlan | undefined;

  // Collect room image URLs for visual reference
  const roomImageUrls = (room.room_images || []).map((img: { image_url: string }) => img.image_url);

  // Extract this room's specific dimensions — prefer extracted floor plan room
  // data (exact), fall back to legacy room_dimensions text string.
  const fp = buildingResearch?.floor_plan as Record<string, unknown> | undefined;
  const roomDims = fp?.room_dimensions as Record<string, string> | undefined;
  const thisRoomDimensions = roomDims?.[room.room_type] ?? undefined;
  const extractedRoom = getRoomFromFloorPlan(extractedFloorPlan, room.room_type);

  // Run photo orientation analysis and room architecture extraction in parallel.
  // Both are non-fatal — if either fails, the mockup still generates without
  // the extra grounding information.
  const [photoOrientations, roomArchitecture] = await Promise.all([
    roomImageUrls.length > 0
      ? analyzePhotoOrientations(roomImageUrls, room.room_type, thisRoomDimensions, extractedRoom)
      : Promise.resolve([]),
    roomImageUrls.length > 0
      ? extractRoomArchitecture(roomImageUrls, room.room_type, floorPlanImageUrl)
      : Promise.resolve(null),
  ]);

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

  // Build placement map from what_it_needs (area-analysis) and action_list (diagnosis).
  // Both carry per-category placement descriptions; prefer what_it_needs (more specific)
  // but fall back to action_list when available.
  const placementMap: Record<string, string> = {};
  const actionList = djson?.action_list as Array<{ category?: string; placement?: string }> | undefined;
  if (actionList) {
    for (const item of actionList) {
      if (item.category && item.placement) {
        placementMap[item.category] = item.placement;
      }
    }
  }
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

    // Build extra context for vision mode — pull ALL available data from the
    // diagnosis so the image model generates a room matching the actual photos,
    // not a generic render.
    const existingItems = (djson?.what_works as string[]) || (djson?.what_is_working as string[]) || [];
    const keepSection = existingItems.length > 0
      ? `\nExisting furniture to KEEP in the scene:\n${existingItems.map((item, i) => `${i + 1}. ${item}`).join("\n")}`
      : "";

    // Use diagnosis design_direction when the caller doesn't send one
    const effectiveDirection = design_direction
      || (djson?.design_direction as string)
      || (ddJson?.style_notes as string)
      || "modern, cohesive apartment design";

    // Build specific items description from what_it_needs (area-analysis) or
    // action_list (diagnosis). Prefer what_it_needs — it has search_title + specs.
    // Fall back to action_list when area-analysis hasn't run yet.
    const whatItNeedsItems = (djson?.what_it_needs as Array<Record<string, unknown>>) || [];
    const diagActionList = (djson?.action_list as Array<Record<string, unknown>>) || [];
    const itemsSource = whatItNeedsItems.length > 0 ? whatItNeedsItems : diagActionList;
    const effectiveItems = items_description
      || (itemsSource.length > 0
        ? itemsSource.map((item, i) => {
          const title = item.search_title || item.action || item.category;
          const placement = item.placement ? ` — PLACE: ${item.placement}` : "";
          return `${i + 1}. [${item.category}] ${title}${placement}`;
        }).join("\n")
        : "Furnish the room according to the design direction");

    const paletteSection = palette.length > 0 ? `\nColor palette: ${palette.join(", ")}` : "";
    const materialsSection = materials.length > 0 ? `\nMaterials: ${materials.join(", ")}` : "";
    const texturesSection = textures.length > 0 ? `\nTextures: ${textures.join(", ")}` : "";
    const userContextSection = room.user_context ? `\nUser notes: "${room.user_context}" — respect these notes in the visualization.` : "";
    const prioritiesSection = room.priorities?.length ? `\nClient priorities: ${room.priorities.join(", ")}` : "";

    // Current room summary from diagnosis — the most specific description of
    // what the room ACTUALLY looks like right now
    const roomSummary = (djson?.summary as string) || "";

    const iterationSection = iteration_notes
      ? `\n\nITERATION FEEDBACK — The user has seen a previous version and wants these changes:\n"${iteration_notes}"\nApply these changes while keeping everything else the same.`
      : "";

    // Build the architecture block — verbatim extracted values when available,
    // fall back to the generic "match the photos" directive when not.
    const architectureBlock = roomArchitecture
      ? formatArchitectureForPrompt(roomArchitecture)
      : `The reference photos show the EXACT physical room you must render. Your generated image MUST reproduce:
- The EXACT same room shape, dimensions, and proportions as shown in the photos
- The EXACT same flooring — match the precise color, material, plank/tile pattern, and sheen visible in the photos
- The EXACT same wall color, undertone, and finish — do NOT default to white if the photos show a different color
- The EXACT same windows — count them, match their size, position on the correct walls, frame style, and trim
- The EXACT same ceiling height and any ceiling details visible in the photos
- The EXACT same doorways, built-ins, and architectural features
- The same natural lighting direction and quality as seen in the photos`;

    const visionPrompt = `Generate a photorealistic interior design visualization of this ${room.room_type}.

CRITICAL — THIS IS A REAL APARTMENT. MATCH IT EXACTLY.
${roomSummary ? `\nCURRENT ROOM (from analysis of the reference photos):\n${roomSummary}\n` : ""}
${architectureBlock}
${archContext}
${spatialLayout ? `\nSpatial layout: ${spatialLayout}` : ""}
${lightingConditions ? `\nLighting: ${lightingConditions}` : ""}
${windowDoorPositions ? `\nWindows and doors: ${windowDoorPositions}` : ""}

Design direction: ${effectiveDirection}${paletteSection}${materialsSection}${texturesSection}${prioritiesSection}${userContextSection}${keepSection}

New furniture and decor to place in the room:
${effectiveItems}${iterationSection}

RULES:
- The room shell (walls, floor, ceiling, windows) must look IDENTICAL to the reference photos and the architecture block above — same colors, same materials, same proportions.
- Only change the furniture and decor, not the architecture.
- Place furniture at realistic scale relative to the actual room size visible in photos.
- Use natural lighting consistent with the window positions in the reference photos.
- The result should look like a real photograph taken in this exact apartment, not a generic render or a showroom.
- Do NOT brighten, whiten, or "clean up" the walls or floors — match their actual tone from the photos.`;

    // Check mockup cache first — identical room photos + identical prompt =
    // identical render, no need to re-run the image model.
    const visionCacheKey = computeMockupCacheKey({
      roomImageUrls,
      productIds: [],  // vision mode has no products, just the prompt
      placementMap: undefined,
      designDirection: visionPrompt,  // the full prompt is the "design"
      imageSize: imageOptions.imageSize,
      aspectRatio: imageOptions.aspectRatio,
      grounded: imageOptions.imageSearchGrounding,
    });
    const cachedVision = findCachedMockup(visionCacheKey);
    if (cachedVision) {
      console.log(`[mockup] vision cache hit key=${visionCacheKey}`);
      await completeAgentRun(supabase, agentRun.id, {
        status: "completed",
        output_json: { image_url: cachedVision.url, cache_hit: true },
      });
      return NextResponse.json({
        image_url: cachedVision.url,
        prompt: visionPrompt,
        vision_mode: true,
        cache_hit: true,
      });
    }

    // Vision mode is a pre-search "imagination" preview shown while the user
    // reviews the area analysis — it is NOT the final design. Tight wall-clock
    // budget (90s) prevents the browser from dropping the background fetch
    // when the verify→regenerate loop runs long.
    const verificationResult = await generateWithVerification({
      generateFn: async (prompt) => {
        const result = await generateMockupImage(prompt, roomImageUrls, imageOptions, photoOrientations, floorPlanImageUrl);
        if (!result.success || !result.data) return { success: false, error: result.error };
        return { success: true, data: result.data };
      },
      originalPrompt: visionPrompt,
      roomImageUrls,
      wallClockBudgetMs: 90_000,
    });

    if (!verificationResult.finalImageData) {
      await completeAgentRun(supabase, agentRun.id, {
        status: "failed",
        error_message: "Image generation failed after verification attempts",
      });
      return NextResponse.json({ error: "Image generation failed" }, { status: 500 });
    }

    const imageUrl = await uploadMockupImage(supabase, verificationResult.finalImageData, verificationResult.finalImageMimeType, visionCacheKey);

    await completeAgentRun(supabase, agentRun.id, {
      status: "completed",
      output_json: {
        image_url: imageUrl,
        verified: verificationResult.verified,
        verification_attempts: verificationResult.attempts,
        verification: verificationResult.finalVerification,
      },
    });

    return NextResponse.json({
      image_url: imageUrl,
      prompt: visionPrompt,
      vision_mode: true,
      verified: verificationResult.verified,
      verification_attempts: verificationResult.attempts,
    });
  }

  // ─── Recommendation Mockup Mode: per-item preview ──────────────
  // Generates a focused mockup showing ONE recommended item placed in the
  // room alongside all existing/kept items. The caller passes the full
  // recommendation object (category, search_title, description, specs,
  // placement) and the existing_items array with detailed descriptions.
  if (recommendation_mockup) {
    const rec = recommendation_mockup as {
      category?: string;
      search_title?: string;
      description?: string;
      specs?: string;
      placement?: string;
    };
    const existingItems = (body.existing_items as string[]) || (djson?.what_works as string[]) || (djson?.what_is_working as string[]) || [];

    const agentRun = await createAgentRun(supabase, {
      room_id,
      agent_type: "mockup_recommendation",
      input_json: { category: rec.category },
    });

    const archContext = buildArchitecturalContext(buildingResearch, room.room_type);
    const roomSummary = (djson?.summary as string) || "";

    const effectiveDirection = design_direction
      || (djson?.design_direction as string)
      || (ddJson?.style_notes as string)
      || "modern, cohesive apartment design";

    const paletteSection = palette.length > 0 ? `\nColor palette: ${palette.join(", ")}` : "";
    const materialsSection = materials.length > 0 ? `\nMaterials: ${materials.join(", ")}` : "";
    const texturesSection = textures.length > 0 ? `\nTextures: ${textures.join(", ")}` : "";

    // Build detailed existing items block — each item fully described
    const existingBlock = existingItems.length > 0
      ? `\nEXISTING FURNITURE THAT MUST APPEAR IN THE SCENE (keep these exactly as described — same material, color, position):\n${existingItems.map((item, i) => `${i + 1}. ${item}`).join("\n")}`
      : "";

    // Build the focal item description with every available detail
    const focalParts: string[] = [];
    if (rec.search_title) focalParts.push(rec.search_title);
    else if (rec.category) focalParts.push(rec.category.replace(/_/g, " "));
    if (rec.specs) focalParts.push(`Specs: ${rec.specs}`);
    if (rec.placement) focalParts.push(`Placement: ${rec.placement}`);
    if (rec.description) focalParts.push(`Purpose: ${rec.description}`);
    const focalDescription = focalParts.join("\n");

    const roomArchitectureBlock = roomArchitecture
      ? formatArchitectureForPrompt(roomArchitecture)
      : `Match the reference photos exactly — same walls, floor, windows, ceiling, proportions.`;

    const recPrompt = `Generate a photorealistic interior design visualization of this ${room.room_type} focusing on ONE NEW ITEM being added.

CRITICAL — THIS IS A REAL APARTMENT. MATCH IT EXACTLY.
${roomSummary ? `\nCURRENT ROOM:\n${roomSummary}\n` : ""}
${roomArchitectureBlock}
${archContext}
${spatialLayout ? `\nSpatial layout: ${spatialLayout}` : ""}
${lightingConditions ? `\nLighting: ${lightingConditions}` : ""}
${windowDoorPositions ? `\nWindows and doors: ${windowDoorPositions}` : ""}

Design direction: ${effectiveDirection}${paletteSection}${materialsSection}${texturesSection}
${existingBlock}

FOCAL ITEM — this is the NEW piece being added to the room. It should be prominent and clearly visible:
${focalDescription}

RULES:
- The room shell (walls, floor, ceiling, windows) must look IDENTICAL to the reference photos.
- ALL existing items listed above must appear in their described positions with correct materials and colors.
- The FOCAL ITEM is the star — render it with clear detail, correct scale, and proper material/color as specified.
- The focal item should be well-lit and prominently placed per the placement instructions.
- Do NOT add any furniture beyond the existing items + the focal item.
- The result should look like a real photograph, not a generic render.`;

    const recCacheKey = computeMockupCacheKey({
      roomImageUrls,
      productIds: [rec.category || "rec"],
      placementMap: rec.placement ? { [rec.category || "focal"]: rec.placement } : undefined,
      designDirection: recPrompt,
      imageSize: imageOptions.imageSize,
      aspectRatio: imageOptions.aspectRatio,
      grounded: imageOptions.imageSearchGrounding,
    });
    const cachedRec = findCachedMockup(recCacheKey);
    if (cachedRec) {
      console.log(`[mockup] recommendation cache hit key=${recCacheKey}`);
      await completeAgentRun(supabase, agentRun.id, {
        status: "completed",
        output_json: { image_url: cachedRec.url, cache_hit: true },
      });
      return NextResponse.json({
        image_url: cachedRec.url,
        prompt: recPrompt,
        recommendation_mockup: true,
        category: rec.category,
        cache_hit: true,
      });
    }

    // Recommendation mockups are lightweight previews — skip verification
    // to keep latency low (one image gen call only).
    const verificationResult = await generateWithVerification({
      generateFn: async (prompt) => {
        const result = await generateMockupImage(prompt, roomImageUrls, imageOptions, photoOrientations, floorPlanImageUrl);
        if (!result.success || !result.data) return { success: false, error: result.error };
        return { success: true, data: result.data };
      },
      originalPrompt: recPrompt,
      roomImageUrls,
      wallClockBudgetMs: 90_000,
      skipVerification: true,
    });

    if (!verificationResult.finalImageData) {
      await completeAgentRun(supabase, agentRun.id, {
        status: "failed",
        error_message: "Recommendation mockup generation failed",
      });
      return NextResponse.json({ error: "Image generation failed" }, { status: 500 });
    }

    const imageUrl = await uploadMockupImage(supabase, verificationResult.finalImageData, verificationResult.finalImageMimeType, recCacheKey);

    await completeAgentRun(supabase, agentRun.id, {
      status: "completed",
      output_json: { image_url: imageUrl, category: rec.category },
    });

    return NextResponse.json({
      image_url: imageUrl,
      prompt: recPrompt,
      recommendation_mockup: true,
      category: rec.category,
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

  // Compute cache key from the inputs that actually determine the render.
  // Same (room, products, placement, style direction, iteration notes) →
  // same cache key → return the existing file without re-running the model.
  const productIdList = products.map((p: { id: string }) => p.id);
  const cacheKey = computeMockupCacheKey({
    roomImageUrls,
    productIds: productIdList,
    placementMap: Object.keys(placementMap).length > 0 ? placementMap : undefined,
    designDirection: (ddJson?.style_notes as string) || (ddJson?.direction as string) || "",
    iterationNotes: iteration_notes || undefined,
    imageSize: imageOptions.imageSize,
    aspectRatio: imageOptions.aspectRatio,
    grounded: imageOptions.imageSearchGrounding,
  });
  const cached = findCachedMockup(cacheKey);
  if (cached) {
    console.log(`[mockup] cache hit key=${cacheKey}`);
    // Still record this as a mockup job so the UI can reference it
    const { data: cachedJob } = await supabase
      .from("mockup_jobs")
      .insert({
        room_id,
        bundle_id,
        selected_products: products,
        status: "completed",
        result_image_url: cached.url,
        generation_provider: "cache",
        completed_at: new Date().toISOString(),
      })
      .select()
      .single();
    return NextResponse.json({
      id: cachedJob?.id,
      image_url: cached.url,
      cache_hit: true,
    });
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

  // Assemble full mockup context from the raw diagnosis rows. The helper
  // centralizes the key-name fallbacks (current_vibe_summary vs summary,
  // what_works vs what_is_working, style_notes vs direction, etc.) so this
  // route stays in sync with any schema drift without re-implementing them.
  const mockupCtx = buildMockupContext({
    roomType: room.room_type,
    diagnosisJson: djson,
    designDirectionJson: ddJson,
    buildingResearch,
    priorities: room.priorities,
    userContext: room.user_context,
    iterationNotes: iteration_notes,
  });

  const promptResult = await generateMockupPrompt(
    room.room_type,
    mockupCtx.diagnosisSummary,
    products,
    mockupCtx.existingItems,
    mockupCtx.designDirection,
    buildingResearch,
    mockupCtx,
    roomImageUrls,
    photoOrientations,
    floorPlanImageUrl,
  );

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

  // LLM audit of the generated prompt — completeness, spec fidelity,
  // placement, architectural grounding. Fails open: if the audit agent
  // errors, the original prompt is used unchanged. When the audit
  // returns a revised prompt (prompt_score < 8 or a sub-score < 7),
  // we feed the revised prompt into the image model instead.
  let finalPrompt = promptResult.data.prompt;
  try {
    const auditResult = await validateMockupPrompt({
      prompt: promptResult.data.prompt,
      products: products as Array<{ category?: string | null; title?: string | null; materials?: string[] | null; colors?: string[] | null; dimensions?: string | Record<string, unknown> | null; description?: string | null }>,
      placementMap: Object.keys(placementMap).length > 0 ? placementMap : undefined,
      roomType: room.room_type,
      designDirection: mockupCtx.designDirection,
    });
    if (auditResult.success && auditResult.data) {
      const audit = auditResult.data;
      console.log(
        `[mockup] Prompt audit: score=${audit.prompt_score}/10, completeness=${audit.completeness.score}, fidelity=${audit.spec_fidelity.score}, placement=${audit.placement.score}, arch=${audit.architectural_grounding.score}, issues=${audit.issues.length}`,
      );
      if (audit.issues.length > 0) {
        console.warn(`[mockup] Prompt audit issues: ${audit.issues.join("; ")}`);
      }
      if (audit.revised_prompt && audit.revised_prompt.length > 200) {
        console.log(`[mockup] Using revised prompt from audit (original score ${audit.prompt_score}/10)`);
        finalPrompt = audit.revised_prompt;
      }
    }
  } catch (err) {
    console.warn(`[mockup] Prompt audit threw — continuing with original prompt`, err);
  }

  // Seed grounding refs with product titles + retailers so Image Search
  // Grounding pulls real product photos during rendering. Caller-provided
  // refs (if any) take precedence.
  //
  // Also attach each product's actual image as a visual reference so the
  // image model renders THESE items (not a generic stylistic match). Text
  // grounding alone gave us mockups unrelated to the selected tier.
  const productReferences = products
    .filter((p: { image_url?: string | null }) => !!p.image_url)
    .map((p: { image_url?: string | null; title?: string; category?: string; colors?: string[]; materials?: string[]; price?: number; retailer?: string }) => {
      const captionParts = [
        p.category ? `[${p.category}]` : "",
        p.title || "",
        p.materials?.length ? `materials: ${p.materials.join(", ")}` : "",
        p.colors?.length ? `colors: ${p.colors.join(", ")}` : "",
        p.retailer ? `(${p.retailer})` : "",
      ].filter(Boolean);
      return { imageUrl: p.image_url as string, caption: captionParts.join(" ") };
    })
    .slice(0, 10);

  const stdImageOptions: MockupImageOptions = {
    ...imageOptions,
    groundingReferences:
      imageOptions.groundingReferences && imageOptions.groundingReferences.length > 0
        ? imageOptions.groundingReferences
        : products
            .map((p: { title?: string; retailer?: string }) => {
              const parts = [p.title, p.retailer].filter(Boolean);
              return parts.join(" — ");
            })
            .filter((s: string) => s.length > 0)
            .slice(0, 8),
    productReferences,
  };

  // Generate image with self-correction verification loop.
  // finalPrompt is either the original mockup prompt or the audit-revised
  // version when the audit flagged gaps.
  const verificationResult = await generateWithVerification({
    generateFn: async (prompt) => {
      const result = await generateMockupImage(prompt, roomImageUrls, stdImageOptions, photoOrientations, floorPlanImageUrl);
      if (!result.success || !result.data) return { success: false, error: result.error };
      return { success: true, data: result.data };
    },
    originalPrompt: finalPrompt,
    roomImageUrls,
  });

  if (!verificationResult.finalImageData) {
    await supabase
      .from("mockup_jobs")
      .update({
        status: "failed",
        prompt: finalPrompt,
        error_message: "Image generation failed after verification attempts",
      })
      .eq("id", mockupJob?.id);
    await completeAgentRun(supabase, agentRun.id, {
      status: "failed",
      error_message: "Image generation failed after verification attempts",
    });
    return NextResponse.json({ error: "Image generation failed" }, { status: 500 });
  }

  // Upload verified image under the content-addressed cache key.
  const finalImageUrl = await uploadMockupImage(supabase, verificationResult.finalImageData, verificationResult.finalImageMimeType, cacheKey);

  // Update mockup job
  await supabase
    .from("mockup_jobs")
    .update({
      status: "completed",
      prompt: finalPrompt,
      result_image_url: finalImageUrl,
      generation_provider: "gemini-image",
      generation_metadata: {
        verified: verificationResult.verified,
        verification_attempts: verificationResult.attempts,
        verification: verificationResult.finalVerification,
      },
      completed_at: new Date().toISOString(),
    })
    .eq("id", mockupJob?.id);

  await completeAgentRun(supabase, agentRun.id, {
    status: "completed",
    output_json: {
      image_url: finalImageUrl,
      verified: verificationResult.verified,
      verification_attempts: verificationResult.attempts,
    },
    tokens_used: promptResult.tokensUsed,
  });

  return NextResponse.json({
    id: mockupJob?.id,
    image_url: finalImageUrl,
    prompt: finalPrompt,
    verified: verificationResult.verified,
    verification_attempts: verificationResult.attempts,
  });
}

/**
 * Upload base64 image data to storage and return the public URL.
 *
 * The filename is content-addressed when `cacheKey` is provided so that
 * identical inputs produce identical paths (enables the mockup cache).
 * When omitted, falls back to a sha256 of the bytes themselves.
 */
async function uploadMockupImage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  base64Data: string,
  mimeType?: string,
  cacheKey?: string,
): Promise<string> {
  const mime = mimeType || "image/png";
  const ext = mime.includes("jpeg") || mime.includes("jpg") ? "jpg" : "png";
  const buffer = Buffer.from(base64Data, "base64");
  const stem = cacheKey ?? crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 32);
  const fileName = `mockups/${stem}.${ext}`;

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

  // ── Room-specific context first (highest priority for the image generator) ──
  const fp = br.floor_plan as Record<string, unknown> | undefined;
  if (fp) {
    const dims = fp.room_dimensions as Record<string, string> | undefined;
    // Prefer the exact room's dimension; do NOT fall back to another room's dims
    const roomDim = dims?.[roomType];
    if (roomDim) lines.push(`${roomType} dimensions: ~${roomDim}`);
  }

  if (br.ceiling_height) lines.push(`Ceiling height: ${br.ceiling_height}`);

  // Cardinal orientation of this room — helps the image generator correctly
  // place which wall the windows are on and where light enters from
  const loc = br.location_context as Record<string, unknown> | undefined;
  if (loc) {
    if (loc.primary_orientation) lines.push(`Room orientation: ${loc.primary_orientation}-facing`);
    if (loc.likely_light_direction) lines.push(`Dominant daylight: ${loc.likely_light_direction}`);
  }

  // ── Finishes (room-level surface details) ───────────────────────────────────
  const finishes = br.finishes as Record<string, string> | undefined;
  if (finishes) {
    if (finishes.flooring) lines.push(`Flooring: ${finishes.flooring}`);
    if (finishes.countertops && roomType === "kitchen") lines.push(`Countertops: ${finishes.countertops}`);
    if (finishes.cabinetry && roomType === "kitchen") lines.push(`Cabinetry: ${finishes.cabinetry}`);
    if (finishes.fixtures) lines.push(`Fixtures: ${finishes.fixtures}`);
  }

  if (br.windows) lines.push(`Windows: ${br.windows}`);

  // ── Building-level context (lower priority — background reference only) ─────
  if (br.layout_style) lines.push(`Layout style: ${br.layout_style}`);
  if (br.building_style) lines.push(`Building style: ${br.building_style}`);

  if (lines.length === 0) return "";
  return `\nKnown architectural details for this ${roomType}:\n${lines.map((l) => `- ${l}`).join("\n")}`;
}
