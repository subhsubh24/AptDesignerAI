import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { hasProEntitlement } from "@/lib/entitlements/server";

/**
 * GET /api/mobile/entitlements
 *
 * Returns the subscription tier for the authenticated user by calling the
 * RevenueCat REST API server-side. Uses REVENUECAT_SECRET_KEY (never the
 * client SDK key) so the result can be trusted for server-side gating.
 *
 * The RC app user ID is the Supabase user UUID (set by _layout.tsx via
 * Purchases.logIn(session.user.id)).
 *
 * Live key: set REVENUECAT_SECRET_KEY in Vercel env — see PENDING_OPS.md.
 */
export async function GET(request: NextRequest) {
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

  const anonClient = createClient(supabaseUrl, supabaseKey);
  const { data: { user }, error: authError } = await anonClient.auth.getUser(token);
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // The RC app user ID mirrors the Supabase user ID (set on logIn in _layout.tsx)
  const isPro = await hasProEntitlement(user.id);

  return NextResponse.json({
    tier: isPro ? "pro" : "free",
    isPro,
    canSaveDesigns: isPro,
    canAnalyze: true,
  });
}
