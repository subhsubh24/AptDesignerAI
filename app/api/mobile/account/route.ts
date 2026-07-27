import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAdminClient } from "@/lib/supabase/admin";
import { purgeUserStorage } from "@/lib/storage/user-storage";
import { checkRateLimit, RATE_LIMITS } from "@/lib/utils/rate-limiter";

// Matches the web deletion route: purging every stored object is more round
// trips than the cascade alone.
export const maxDuration = 60;

/**
 * DELETE /api/mobile/account
 *
 * In-app account deletion for the native app (Apple App Store Guideline
 * 5.1.1(v) + Google Play require an in-app path to delete the account).
 *
 * Mobile clients authenticate with a Bearer token (the Supabase session
 * access token), not cookies — so this mirrors the other /api/mobile/* routes
 * rather than the cookie-based web route at /api/user/delete. Deleting the
 * auth user cascades to profiles → projects → rooms → all room data, and
 * directly to saved_designs (ON DELETE CASCADE).
 */
export async function DELETE(request: NextRequest) {
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
  // client-supplied id).
  const anonClient = createClient(supabaseUrl, supabaseKey);
  const { data: { user }, error: authError } = await anonClient.auth.getUser(token);
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Same cap as the web deletion route: a destructive, irreversible action.
  const limit = checkRateLimit(`mobile-account-delete:${user.id}`, RATE_LIMITS.userDelete);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many deletion requests. Please try again later." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((limit.retryAfterMs || 86400000) / 1000)) } },
    );
  }

  const admin = getAdminClient();
  if (!admin) {
    return NextResponse.json(
      { error: "Account deletion is unavailable right now. Please contact support." },
      { status: 503 },
    );
  }

  // Storage sits outside the Postgres cascade and both buckets are public, so
  // purge the user's objects BEFORE the cascade removes the rows that attribute
  // generated mockups to them. A failed purge must not report a successful
  // deletion — the account stays intact and the (idempotent) call is retryable.
  try {
    await purgeUserStorage(admin, user.id);
  } catch (err) {
    console.error("[mobile-account-delete] storage purge failed:", err instanceof Error ? err.message : err);
    return NextResponse.json(
      {
        error:
          "We couldn't remove your stored images, so your account was not deleted. Please try again or contact support.",
      },
      { status: 500 },
    );
  }

  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) {
    return NextResponse.json(
      { error: "Failed to delete account. Please try again or contact support." },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}
