import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { checkRateLimit, RATE_LIMITS } from "@/lib/utils/rate-limiter";

const MAX_TOKEN_LENGTH = 512;
const ALLOWED_PLATFORMS = new Set(["ios", "android"]);

/**
 * POST /api/mobile/push-tokens
 *
 * Receiver for the Expo push token mobile/src/hooks/use-push-notifications.ts
 * already collects on-device but previously had nowhere to send (APT-67).
 * Bearer-token auth (mobile clients cannot use cookies), matching the other
 * /api/mobile/* routes. Upserts on `token` (not user_id) — a user can hold
 * more than one device token, and a reinstall issues a fresh token for the
 * same device, so both are ordinary idempotent writes rather than conflicts.
 *
 * Body: { token: string, platform?: "ios" | "android" }
 *
 * Out of scope by design (see APT-67): this stores tokens only. Sending push
 * notifications is a separate, larger feature.
 */
export async function POST(request: NextRequest) {
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

  // Validate the JWT and resolve the user id from the token (never trust a
  // client-supplied id) — same pattern as the other /api/mobile/* routes.
  const anonClient = createClient(supabaseUrl, supabaseKey);
  const { data: { user }, error: authError } = await anonClient.auth.getUser(token);
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = checkRateLimit(`mobile-push-token:${user.id}`, RATE_LIMITS.mobilePushTokenRegister);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((limit.retryAfterMs || 60000) / 1000)) } },
    );
  }

  let body: { token?: unknown; platform?: unknown };
  try {
    body = await request.json() as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { token: pushToken, platform } = body;
  if (typeof pushToken !== "string" || !pushToken || pushToken.length > MAX_TOKEN_LENGTH) {
    return NextResponse.json(
      { error: `token is required and must be a string of at most ${MAX_TOKEN_LENGTH} characters` },
      { status: 400 },
    );
  }
  if (platform !== undefined && (typeof platform !== "string" || !ALLOWED_PLATFORMS.has(platform))) {
    return NextResponse.json({ error: 'platform must be "ios" or "android"' }, { status: 400 });
  }

  // RLS-scoped client (forwards the caller's JWT) — the upsert is validated
  // against the "user_id = auth.uid()" policy, so a user can never attach
  // their token to someone else's account even if this handler had a bug.
  const authedClient = createClient(supabaseUrl, supabaseKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { error } = await authedClient
    .from("push_tokens")
    .upsert(
      {
        user_id: user.id,
        token: pushToken,
        platform: platform ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "token" },
    );

  if (error) {
    console.error("[mobile/push-tokens] upsert error", error.message);
    return NextResponse.json({ error: "Failed to register push token" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
