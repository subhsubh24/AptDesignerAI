import { NextRequest, NextResponse } from "next/server";
import {
  MIN_SHARE_TOKEN_LENGTH,
  readSharedDesignByToken,
} from "@/lib/supabase/public-share";
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

  if (!token || token.length < MIN_SHARE_TOKEN_LENGTH) {
    return NextResponse.json({ error: "Invalid token" }, { status: 400 });
  }

  // Intentionally public — but the token is the credential, so the lookup runs
  // through the one module that binds share_token AND is_public server-side.
  // See lib/supabase/public-share.ts for why this cannot go through the anon
  // client (its RLS policy could never require the token filter).
  const data = await readSharedDesignByToken(token);

  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Already narrowed to the public column set (no user_id, no share_token).
  const { id, title, room_type, stage, thumbnail_url, snapshot, created_at } = data;

  return NextResponse.json({ id, title, room_type, stage, thumbnail_url, snapshot, created_at });
}
