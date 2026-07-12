import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, RATE_LIMITS } from "@/lib/utils/rate-limiter";

// Public endpoint: no auth required.
// Returns a curated design snapshot identified by share_token.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  // Unauthenticated + token-addressable → rate-limit per IP to slow token
  // enumeration/scraping. A genuine viewer following a link makes one request.
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";
  const limit = checkRateLimit(`shared-design:${ip}`, RATE_LIMITS.sharedDesign);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil((limit.retryAfterMs || 60000) / 1000)) },
      },
    );
  }

  const { token } = await params;

  if (!token || token.length < 16) {
    return NextResponse.json({ error: "Invalid token" }, { status: 400 });
  }

  // createClient() returns the memory store (or real Supabase) — no user_id
  // filter here, so this path is intentionally public.
  const supabase = await createClient();

  const { data } = await supabase
    .from("saved_designs")
    .select(
      "id, title, room_type, stage, thumbnail_url, snapshot, created_at, is_public"
    )
    .eq("share_token", token)
    .eq("is_public", true)
    .maybeSingle();

  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Omit internal IDs and user_id from the public response
  const { id, title, room_type, stage, thumbnail_url, snapshot, created_at } = data as {
    id: string;
    title: string;
    room_type: string | null;
    stage: string;
    thumbnail_url: string | null;
    snapshot: Record<string, unknown>;
    created_at: string;
    is_public: boolean;
  };

  return NextResponse.json({ id, title, room_type, stage, thumbnail_url, snapshot, created_at });
}
