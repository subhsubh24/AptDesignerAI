import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, RATE_LIMITS } from "@/lib/utils/rate-limiter";

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

  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) {
    return NextResponse.json(
      { error: "Failed to delete account. Please try again or contact support." },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}
