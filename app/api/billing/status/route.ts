import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getWebBillingStatus,
  isEntitlementConfigured,
  FREE_SAVE_LIMIT_WEB,
} from "@/lib/entitlements/web";
import { apiError } from "@/lib/utils/api-error";

/**
 * GET /api/billing/status
 *
 * Returns the authenticated web user's plan + free-tier save usage so the app
 * can render an in-product upgrade surface (usage meter + paywall card) without
 * trusting the client for entitlement. Mirrors the server-side gate in
 * app/api/saved-designs/route.ts (same FREE_SAVE_LIMIT_WEB).
 *
 * hasPaid is kept CONSISTENT with the enforcement gate (hasProEntitlementWeb):
 * on a MISCONFIGURATION (credentials absent) it fails closed in production so
 * the UI never renders "Pro" while saves are actually capped, and open in dev;
 * on a RUNTIME query error (client configured) it fails open so a transient
 * outage never nags a user we simply couldn't verify.
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
  // billing === null means EITHER missing creds (misconfig) OR a query error.
  // Mirror hasProEntitlementWeb so the displayed plan can't contradict the
  // enforcement gate: misconfig fails closed in production / open in dev; a
  // runtime error (client configured) fails open so we don't nag.
  const hasPaid =
    billing !== null
      ? billing.hasPaid
      : isEntitlementConfigured()
        ? true // configured but the query failed → transient outage, fail open
        : process.env.NODE_ENV !== "production"; // misconfig → open in dev, closed in prod
  const tier = billing?.tier ?? null;

  return NextResponse.json({
    hasPaid,
    tier,
    savedCount: count ?? 0,
    limit: FREE_SAVE_LIMIT_WEB,
  });
}
