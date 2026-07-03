/**
 * Server-side Stripe entitlement check for web users.
 *
 * Reads from the stripe_customers table (written by the webhook handler) via
 * the Supabase service-role client, so this runs only in server contexts and
 * never exposes the service-role key to the browser.
 *
 * Two distinct failure modes are handled differently:
 *   - MISCONFIGURATION (service-role credentials unset): fails CLOSED in
 *     production so a missing key can't silently grant Pro to everyone, and
 *     OPEN in development. Production must set the keys via PENDING_OPS.md.
 *   - RUNTIME query error (client configured, the DB call fails): fails OPEN so
 *     paying subscribers are never blocked by a transient outage.
 */

import { getAdminClient } from "@/lib/supabase/admin";

/** Maximum number of saved designs for free-tier web users. */
export const FREE_SAVE_LIMIT_WEB = 3;

/**
 * True when Supabase service-role credentials are absent — a deploy-time
 * misconfiguration (distinct from a runtime query failure). Kept separate so
 * entitlement checks can fail CLOSED on misconfiguration in production without
 * changing the fail-OPEN-on-outage behaviour.
 */
export function isEntitlementConfigured(): boolean {
  return getAdminClient() !== null;
}

export type WebBillingStatus = {
  hasPaid: boolean;
  tier: "apartment" | "pro" | "pro_annual" | null;
  status: "active" | "cancelled" | "past_due" | "unpaid" | null;
};

/**
 * Returns true if the given Supabase user has an active paid Stripe entitlement.
 *
 * MISCONFIGURATION (service-role credentials unset) fails CLOSED in production
 * (a missing key must not silently grant Pro to everyone) and OPEN in
 * development. A RUNTIME query error while the client IS configured fails OPEN
 * so paying subscribers are never blocked by a transient DB outage.
 */
export async function hasProEntitlementWeb(userId: string): Promise<boolean> {
  if (!isEntitlementConfigured()) {
    const isProduction = process.env.NODE_ENV === "production";
    console.error(
      "[entitlements/web] Supabase credentials not configured — " +
      (isProduction
        ? "denying Pro entitlement (fail-closed in production)"
        : "granting access (fail-open in development)") +
      ". Set SUPABASE_SERVICE_ROLE_KEY in Vercel env vars (see PENDING_OPS.md).",
    );
    return !isProduction;
  }
  const result = await getWebBillingStatus(userId);
  if (result === null) return true; // fail-open on a transient query error (outage)
  return result.hasPaid;
}

/**
 * Returns full billing status for the user, or null when it cannot be
 * determined — EITHER credentials are absent (misconfiguration) OR the query
 * errored (outage). Callers decide how to treat null: use isEntitlementConfigured()
 * to distinguish the two (see hasProEntitlementWeb, which fails closed in
 * production only on the misconfiguration case).
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
