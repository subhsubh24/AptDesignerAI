import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * GET /api/mobile/entitlements
 *
 * Returns subscription tier for the authenticated user. Currently stubs 'free'
 * for all users. RevenueCat integration: replace the stub with a server-side
 * receipt validation call using the user's RevenueCat app user ID.
 *
 * See PENDING_OPS.md for the RevenueCat setup steps required before go-live.
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

  // RevenueCat integration point (Track C Phase 2):
  //   const rcCustomer = await fetchRevenueCatCustomer(user.id);
  //   const isPro = rcCustomer.entitlements.active['pro'] != null;
  //   return NextResponse.json({ tier: isPro ? 'pro' : 'free', ... });

  return NextResponse.json({
    tier: "free",
    canSaveDesigns: false,
    canAnalyze: true,
  });
}
