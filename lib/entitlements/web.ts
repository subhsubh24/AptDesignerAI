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
 * Days a Pro subscription retains access after entering `past_due`.
 *
 * When a renewal charge fails, Stripe moves the subscription to `past_due` and
 * retries payment (Smart Retries run up to ~3 weeks) before finally moving it
 * to `canceled`/`unpaid`. Revoking access the instant a charge fails would
 * violate the uninterrupted-access expectation of the App Store / Google Play
 * (and is hostile to a subscriber whose card merely expired). So Pro keeps
 * access through a bounded grace window measured from the row's grace anchor
 * (see getWebBillingStatus).
 *
 * The bound is REAL, not dependent on Stripe delivering a later `canceled`
 * event: the anchor is `current_period_end` when known, else the webhook's
 * `updated_at` (stamped every upsert, so it marks when the row entered
 * past_due). A subscription abandoned in past_due — webhook downtime, a dropped
 * event, misconfigured dunning — therefore still lapses `PAST_DUE_GRACE_DAYS`
 * after its last write rather than staying free forever. An actively-retrying
 * subscription keeps re-stamping updated_at and stays in grace until Stripe
 * resolves it to active (success) or canceled/unpaid (retries exhausted).
 */
export const PAST_DUE_GRACE_DAYS = 14;

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
    .select("tier, status, current_period_end, updated_at")
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

  // Payment-retry grace: a subscription whose renewal charge just failed enters
  // `past_due` while Stripe retries. Keep access for a bounded grace window so a
  // transient failed charge doesn't instantly revoke a paying subscriber (the
  // uninterrupted-access expectation of both app stores). The grace is anchored
  // on current_period_end when known, else the webhook's updated_at (stamped on
  // every upsert, so it marks when the row entered past_due) — making the bound
  // REAL and self-contained rather than dependent on Stripe delivering a later
  // canceled/unpaid event. `unpaid` and `cancelled` never get grace; they fall
  // through to hasPaid:false below.
  if (status === "past_due") {
    const anchor = data.current_period_end ?? data.updated_at;
    // No anchor at all (updated_at is NOT NULL in schema, so this is defensive):
    // can't prove we're inside the window, so deny rather than grant unbounded.
    if (!anchor) return { hasPaid: false, tier, status };
    const graceEnd = new Date(anchor);
    graceEnd.setDate(graceEnd.getDate() + PAST_DUE_GRACE_DAYS);
    return { hasPaid: graceEnd > new Date(), tier, status };
  }

  return { hasPaid: false, tier, status };
}
