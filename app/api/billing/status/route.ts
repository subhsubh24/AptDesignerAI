import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getWebBillingStatus, FREE_SAVE_LIMIT_WEB } from "@/lib/entitlements/web";
import { apiError } from "@/lib/utils/api-error";

/**
 * GET /api/billing/status
 *
 * Returns the authenticated web user's plan + free-tier save usage so the app
 * can render an in-product upgrade surface (usage meter + paywall card) without
 * trusting the client for entitlement. Mirrors the server-side gate in
 * app/api/saved-designs/route.ts (same FREE_SAVE_LIMIT_WEB).
 *
 * Fails open to hasPaid=true when billing credentials are absent — consistent
 * with hasProEntitlementWeb — so a user we cannot verify is never nagged.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { count, error } = await supabase
    .from("saved_designs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);

  if (error) return apiError("billing/status", error);

  const billing = await getWebBillingStatus(user.id);
  // null => credentials missing (fail-open: treat as paid so we don't nag).
  const hasPaid = billing === null ? true : billing.hasPaid;
  const tier = billing === null ? null : billing.tier;

  return NextResponse.json({
    hasPaid,
    tier,
    savedCount: count ?? 0,
    limit: FREE_SAVE_LIMIT_WEB,
  });
}
