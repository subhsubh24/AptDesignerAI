import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { checkRateLimit } from "@/lib/utils/rate-limiter";

/**
 * POST /api/mobile/saved-designs/[id]/share
 *
 * Enables public sharing on a saved design and returns the share URL.
 * Accepts a Bearer token (mobile Supabase session). Idempotent: re-calling
 * returns the same share_token so the URL stays stable.
 *
 * Returns: { share_url: string }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // --- Bearer token auth (same pattern as other mobile endpoints) ---
  const authHeader = request.headers.get("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 503 });
  }

  const anonClient = createClient(supabaseUrl, supabaseKey);
  const { data: { user }, error: authError } = await anonClient.auth.getUser(token);
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = checkRateLimit(`mobile-share:${user.id}`, { maxRequests: 20, windowMs: 60_000 });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((limit.retryAfterMs ?? 60000) / 1000)) } },
    );
  }

  const authedClient = createClient(supabaseUrl, supabaseKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  // --- Verify ownership and fetch existing share_token ---
  const { data: existing, error: fetchError } = await authedClient
    .from("saved_designs")
    .select("id, share_token, is_public")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (fetchError || !existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Preserve existing token so the URL stays stable if called multiple times
  const share_token = existing.share_token ?? randomBytes(16).toString("hex");

  const { data: updateData, error: updateError } = await authedClient
    .from("saved_designs")
    .update({ is_public: true, share_token, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id");

  if (updateError || !updateData?.length) {
    console.error("[mobile/share] update error or 0 rows", updateError?.message);
    return NextResponse.json({ error: "Failed to enable sharing" }, { status: 500 });
  }

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "https://aptdesignerai.com").replace(/\/$/, "");
  const share_url = `${appUrl}/shared/${share_token}`;

  return NextResponse.json({ share_url });
}
