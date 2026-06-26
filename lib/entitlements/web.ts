/**
 * Server-side Stripe entitlement check for web users.
 *
 * Reads from the stripe_customers table (written by the webhook handler) via
 * the Supabase service-role client, so this runs only in server contexts and
 * never exposes the service-role key to the browser.
 *
 * Fails open (returns true) when credentials are absent so paying subscribers
 * are never denied service due to a missing key — production must set the keys
 * via PENDING_OPS.md.
 */

import { getAdminClient } from "@/lib/supabase/admin";

/** Maximum number of saved designs for free-tier web users. */
export const FREE_SAVE_LIMIT_WEB = 3;

export type WebBillingStatus = {
  hasPaid: boolean;
  tier: "apartment" | "pro" | "pro_annual" | null;
  status: "active" | "cancelled" | "past_due" | "unpaid" | null;
};

/**
 * Returns true if the given Supabase user has an active paid Stripe entitlement.
 * Fails open when Supabase credentials are unset.
 */
export async function hasProEntitlementWeb(userId: string): Promise<boolean> {
  const result = await getWebBillingStatus(userId);
  if (result === null) return true; // fail-open: missing config
  return result.hasPaid;
}

/**
 * Returns full billing status for the user, or null when credentials are absent
 * (fail-open caller should treat null as "allow").
 */
export async function getWebBillingStatus(userId: string): Promise<WebBillingStatus | null> {
  const admin = getAdminClient();
  if (!admin) {
    console.error(
      "[entitlements/web] Supabase credentials not configured — skipping entitlement check. " +
      "Set SUPABASE_SERVICE_ROLE_KEY in Vercel env vars (see PENDING_OPS.md).",
    );
    return null;
  }

  const { data, error } = await admin
    .from("stripe_customers")
    .select("tier, status, current_period_end")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("[entitlements/web] stripe_customers query error:", error.message);
    return null;
  }

  if (!data) {
    return { hasPaid: false, tier: null, status: null };
  }

  const tier = data.tier as "apartment" | "pro" | "pro_annual";
  const status = data.status as "active" | "cancelled" | "past_due" | "unpaid";

  // Apartment is a one-time purchase — active indefinitely once status = active.
  if (tier === "apartment") {
    return { hasPaid: status === "active", tier, status };
  }

  // Pro is a subscription — check status and optionally current_period_end.
  if (status === "active") {
    // If period end is set and in the past, Stripe hasn't fired the update yet
    if (data.current_period_end) {
      const periodEnd = new Date(data.current_period_end);
      const now = new Date();
      return { hasPaid: periodEnd > now, tier, status };
    }
    return { hasPaid: true, tier, status };
  }

  return { hasPaid: false, tier, status };
}
