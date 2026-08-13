import { NextResponse } from "next/server";
import { apiError } from "@/lib/utils/api-error";
import { createClient } from "@/lib/supabase/server";
import { extractFromUrl, extractFromImage } from "@/lib/agents/product-extractor";
import { createAgentRun, completeAgentRun } from "@/lib/db/agent-runs";
import { buildDesignProfile } from "@/lib/design-context/build-profile";
import { checkRateLimit, RATE_LIMITS } from "@/lib/utils/rate-limiter";
import { checkDailySpend, dailySpendExceededResponse } from "@/lib/utils/spend-limiter";
import { requireRoomOwnership } from "@/lib/auth/ownership";
import { validateExternalUrl } from "@/lib/utils/url-validator";

// Product extraction runs a vision/LLM call per request. Without an explicit
// maxDuration, Vercel applies a short platform default and can kill the function
// mid-run — a "builds green, request gets killed" failure on a paid path. 300s
// is the Vercel Pro ceiling and covers the documented worst-case latency.
export const maxDuration = 300;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limit = checkRateLimit(`products-ingest:${user.id}`, RATE_LIMITS.productsIngest);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many ingest requests. Please wait a moment." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((limit.retryAfterMs || 60000) / 1000)) } },
    );
  }
  // Extraction is a paid LLM call — gate it behind the daily spend breaker too
  // so a single authed user can't drive unbounded model spend (matching the
  // other paid LLM endpoints).
  const spend = checkDailySpend(user.id);
  if (!spend.allowed) return dailySpendExceededResponse(spend);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { room_id, url, image_url, source_type } = body;

  if (!room_id) return NextResponse.json({ error: "room_id required" }, { status: 400 });
  if (!url && !image_url) return NextResponse.json({ error: "url or image_url required" }, { status: 400 });

  if (url) {
    const validation = validateExternalUrl(url);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
  }
  if (image_url) {
    const validation = validateExternalUrl(image_url);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
  }

  const postOwnership = await requireRoomOwnership(supabase, room_id, user.id);
  if (postOwnership) return postOwnership;

  // Fetch room → project for design context. Pull room photos so the
  // extractor always has the target room as visual context (never forgets
  // what we're furnishing). Ownership was just verified against this same
  // row, so a failure here is essentially always transient (DB/connection),
  // not a legitimate not-found — and losing roomImageUrls degrades the vision
  // call's grounding (product-extractor.ts uses it to match visual_style_tags
  // to the actual room), not just metadata. Hard-fail rather than silently
  // running a poorly-grounded extraction on that degraded context (matches
  // the room-fetch precedent in area-analysis/refine-chat/route.ts, which
  // 404s the same way). Note: checkDailySpend() above already incremented
  // the caller's daily quota unconditionally at request entry — this fetch
  // failing doesn't change that either way, so the return here is about
  // extraction quality, not spend.
  const { data: room, error: roomError } = await supabase
    .from("rooms")
    .select("project_id, room_images(*)")
    .eq("id", room_id)
    .single();
  if (roomError || !room) {
    console.error("[products.ingest] Room fetch failed after ownership check:", roomError?.message);
    return NextResponse.json({ error: "Failed to load room context. Please retry." }, { status: 500 });
  }
  const roomImageUrls: string[] = (
    (room.room_images as Array<{ image_url: string }> | undefined) || []
  ).map((img) => img.image_url);
  // The project fetch only personalizes the design profile — a read failure
  // here degrades to an unpersonalized profile rather than failing the whole
  // extraction, but it must be LOGGED (matches refine-chat/route.ts's
  // identical project-fetch precedent).
  const { data: project, error: projectError } = room.project_id
    ? await supabase.from("projects").select("*").eq("id", room.project_id).single()
    : { data: null, error: null };
  if (projectError) {
    console.error("[products.ingest] Project fetch failed:", projectError.message);
  }
  const designProfile = buildDesignProfile(project);

  // Create agent run
  const agentRun = await createAgentRun(supabase, {
    room_id,
    agent_type: "extractor",
    input_json: { url, image_url, source_type },
  });

  let result;
  if (url) {
    result = await extractFromUrl(url, designProfile, roomImageUrls);
  } else {
    result = await extractFromImage(image_url, designProfile, roomImageUrls);
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
    return apiError("products.ingest", saveError);
  }

  await completeAgentRun(supabase, agentRun.id, {
    status: "completed",
    output_json: result.data as unknown as Record<string, unknown>,
    tokens_used: result.tokensUsed,
  });

  return NextResponse.json(product, { status: 201 });
}
