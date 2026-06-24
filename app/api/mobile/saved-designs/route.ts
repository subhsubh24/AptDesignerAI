import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { checkRateLimit } from "@/lib/utils/rate-limiter";
import { hasProEntitlement, FREE_SAVE_LIMIT } from "@/lib/entitlements/server";

const ROOM_TYPES = new Set([
  "living_room", "bedroom", "kitchen", "bathroom", "dining_room",
  "home_office", "nursery", "laundry_room", "garage", "basement",
]);

const ROOM_LABELS: Record<string, string> = {
  living_room: "Living Room",
  bedroom: "Bedroom",
  kitchen: "Kitchen",
  bathroom: "Bathroom",
  dining_room: "Dining Room",
  home_office: "Home Office",
  nursery: "Nursery",
  laundry_room: "Laundry Room",
  garage: "Garage",
  basement: "Basement",
};

interface AnalysisResult {
  summary: string;
  style_name: string;
  design_direction: string;
  recommended_palette: string[];
  recommended_materials: string[];
  recommended_textures: string[];
  what_works: string[];
  what_should_go: string[];
}

/**
 * POST /api/mobile/saved-designs
 *
 * Saves a mobile room analysis to saved_designs. Accepts a Bearer token
 * (from the mobile Supabase session) instead of cookies. No project/room
 * DB records are required — the mobile flow is stateless.
 *
 * Body: { room_type, analysis, thumbnail_url? }
 * Returns: { id, title }
 */
export async function POST(request: NextRequest) {
  // Bearer token auth — mobile clients cannot use cookies
  const authHeader = request.headers.get("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }

  // Validate JWT (reuse anon client pattern from analyze endpoint)
  const anonClient = createClient(supabaseUrl, supabaseKey);
  const { data: { user }, error: authError } = await anonClient.auth.getUser(token);
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Rate limit: 10 saves per minute per user (cheap DB write, not an LLM call)
  const limit = checkRateLimit(`mobile-save:${user.id}`, { maxRequests: 10, windowMs: 60_000 });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many save requests. Please wait a moment." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil((limit.retryAfterMs ?? 60000) / 1000)) },
      },
    );
  }

  // Reuse one authed client for both the count check and the insert.
  const authedClient = createClient(supabaseUrl, supabaseKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  // Server-side entitlement gate: enforce FREE_SAVE_LIMIT for non-Pro users.
  // Checked before body parsing so rejected requests skip validation work.
  const { count: existingSaveCount } = await authedClient
    .from("saved_designs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);

  if ((existingSaveCount ?? 0) >= FREE_SAVE_LIMIT) {
    const isPro = await hasProEntitlement(user.id);
    if (!isPro) {
      return NextResponse.json(
        { error: "Free save limit reached. Upgrade to Pro to save unlimited designs.", subscription_required: true },
        { status: 403 },
      );
    }
  }

  let body: { room_type?: unknown; analysis?: unknown; thumbnail_url?: unknown };
  try {
    body = await request.json() as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { room_type, analysis, thumbnail_url } = body;

  if (typeof room_type !== "string" || !ROOM_TYPES.has(room_type)) {
    return NextResponse.json({ error: "room_type is required and must be a known room type" }, { status: 400 });
  }

  // Validate analysis shape (must have the required fields from mobile/analyze)
  if (!analysis || typeof analysis !== "object" || Array.isArray(analysis)) {
    return NextResponse.json({ error: "analysis is required" }, { status: 400 });
  }
  const a = analysis as Record<string, unknown>;
  const requiredStrings = ["summary", "style_name", "design_direction"];
  const requiredArrays = ["recommended_palette", "recommended_materials", "recommended_textures", "what_works", "what_should_go"];
  for (const field of requiredStrings) {
    if (typeof a[field] !== "string" || !a[field]) {
      return NextResponse.json({ error: `analysis.${field} is required` }, { status: 400 });
    }
  }
  for (const field of requiredArrays) {
    if (!Array.isArray(a[field])) {
      return NextResponse.json({ error: `analysis.${field} must be an array` }, { status: 400 });
    }
  }

  // Validate thumbnail_url if provided: must be https from our Supabase Storage host
  let thumbnailUrl: string | null = null;
  if (thumbnail_url != null) {
    if (typeof thumbnail_url !== "string") {
      return NextResponse.json({ error: "thumbnail_url must be a string" }, { status: 400 });
    }
    try {
      const parsed = new URL(thumbnail_url);
      const supabaseHost = new URL(supabaseUrl).hostname;
      if (parsed.protocol !== "https:" || parsed.hostname !== supabaseHost) {
        return NextResponse.json({ error: "thumbnail_url must be a Supabase Storage URL" }, { status: 400 });
      }
      thumbnailUrl = thumbnail_url;
    } catch {
      return NextResponse.json({ error: "thumbnail_url is not a valid URL" }, { status: 400 });
    }
  }

  const roomLabel = ROOM_LABELS[room_type] ?? room_type.replace(/_/g, " ");
  const styleName = a["style_name"] as string;
  const title = `${styleName} · ${roomLabel}`;

  const snapshot = {
    mobile_analysis: analysis as AnalysisResult,
    metadata: {
      saved_at: new Date().toISOString(),
      source: "mobile",
    },
  };

  const { data, error } = await authedClient
    .from("saved_designs")
    .insert({
      user_id: user.id,
      project_id: null,
      room_id: null,
      title,
      room_type,
      stage: "assessment",
      snapshot,
      thumbnail_url: thumbnailUrl,
    })
    .select("id, title")
    .single();

  if (error) {
    console.error("[mobile/saved-designs] insert error", error.message);
    return NextResponse.json({ error: "Failed to save design" }, { status: 500 });
  }

  return NextResponse.json({ id: data.id, title: data.title }, { status: 201 });
}
