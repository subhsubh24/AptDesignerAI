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
 * Maximum number of standard full-room mockup renders for free-tier web users.
 *
 * "AI mockups of finished rooms" is listed on /pricing as an Apartment-tier
 * feature and is absent from the Explore (free) feature list, so a free user is
 * entitled to zero by the published plan — one is deliberately MORE generous
 * than advertised, never less. It exists so the free tier can see the finished
 * result once before the upgrade ask lands.
 *
 * SCOPE — read this before relying on it as a cost ceiling. It caps exactly one
 * of the three render modes in app/api/mockups: the standard full-room render,
 * the branch that writes a `mockup_jobs` row. `recommendation_mockup` has its
 * own cap, `FREE_RECOMMENDATION_MOCKUP_LIMIT_WEB` below. It does NOT cap
 * `vision_mode`, the design preview: the focus page auto-generates it when an
 * analysis lands (the first-run "aha", which is why it is deliberately left
 * ungated), but it is ALSO reachable from a "Regenerate" control the user can
 * click repeatedly, and it reaches the same image model at the same cost.
 * `vision_mode` remains bounded only by the per-user rate limit and the daily
 * spend ceiling. Bounding it properly means choosing a free budget for it
 * without spending the activation moment, which is a product decision rather
 * than a mechanical fix; tracked separately (#748).
 */
export const FREE_MOCKUP_LIMIT_WEB = 1;

/**
 * Maximum number of per-item recommendation-mockup renders (catalog-style
 * product shots, fired once per recommended item from the results page) for
 * free-tier web users, summed across all of a user's rooms.
 *
 * Unlike the standard render, there's no natural per-request bound — a single
 * room's recommendation list can hold a dozen items, each one a full
 * image-model call, previously reachable at zero cost to the caller. Set
 * higher than FREE_MOCKUP_LIMIT_WEB because these are cheaper single-product
 * shots (no room photos, no photo-orientation/room-architecture extraction —
 * see the early-return in app/api/mockups/route.ts) rather than full-scene
 * renders, and because a free user needs to see more than one recommended
 * product before the upgrade ask is meaningful. Failed renders are excluded
 * from the count (an outage must not consume the allowance), matching
 * FREE_MOCKUP_LIMIT_WEB's rule.
 */
export const FREE_RECOMMENDATION_MOCKUP_LIMIT_WEB = 5;

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

type StripeCustomerFields = {
  tier: "apartment" | "pro" | "pro_annual";
  status: "active" | "cancelled" | "past_due" | "unpaid";
  current_period_end: string | null;
  updated_at: string;
};

/**
 * Pure tier/status → hasPaid computation, shared by the single-user
 * (getWebBillingStatus) and batched (getProEntitlementMapWeb) lookups so the
 * two can never drift apart.
 */
function computeHasPaid(row: StripeCustomerFields): boolean {
  // Apartment is a one-time purchase — active indefinitely once status = active.
  if (row.tier === "apartment") return row.status === "active";

  // Pro is a subscription — check status and optionally current_period_end.
  if (row.status === "active") {
    // If period end is set and in the past, Stripe hasn't fired the update yet.
    if (row.current_period_end) {
      return new Date(row.current_period_end) > new Date();
    }
    return true;
  }

  // Payment-retry grace: see getWebBillingStatus for the full rationale. The
  // grace is anchored on current_period_end when known, else updated_at.
  if (row.status === "past_due") {
    const anchor = row.current_period_end ?? row.updated_at;
    if (!anchor) return false;
    const graceEnd = new Date(anchor);
    graceEnd.setDate(graceEnd.getDate() + PAST_DUE_GRACE_DAYS);
    return graceEnd > new Date();
  }

  return false;
}

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

  // Payment-retry grace (status === "past_due"): a subscription whose renewal
  // charge just failed enters `past_due` while Stripe retries. Keep access for
  // a bounded grace window so a transient failed charge doesn't instantly
  // revoke a paying subscriber (the uninterrupted-access expectation of both
  // app stores). The grace is anchored on current_period_end when known, else
  // the webhook's updated_at (stamped on every upsert, so it marks when the row
  // entered past_due) — making the bound REAL and self-contained rather than
  // dependent on Stripe delivering a later canceled/unpaid event. `unpaid` and
  // `cancelled` never get grace; they fall through to hasPaid:false.
  return {
    hasPaid: computeHasPaid({
      tier,
      status,
      current_period_end: data.current_period_end,
      updated_at: data.updated_at,
    }),
    tier,
    status,
  };
}

/**
 * Batched variant of hasProEntitlementWeb — one stripe_customers query for a
 * whole cohort instead of one per user (built for the habit-emails cron, which
 * otherwise issues N sequential entitlement lookups per run). Same fail-open
 * (outage) / fail-closed-in-production (misconfiguration) semantics as
 * hasProEntitlementWeb, applied once for the batch rather than per user.
 */
export async function getProEntitlementMapWeb(
  userIds: string[],
  adminClient?: ReturnType<typeof getAdminClient>,
): Promise<Map<string, boolean>> {
  const result = new Map<string, boolean>();
  if (!userIds.length) return result;

  const admin = adminClient ?? getAdminClient();
  if (!admin) {
    const isProduction = process.env.NODE_ENV === "production";
    console.error(
      "[entitlements/web] Supabase credentials not configured — " +
      (isProduction
        ? "denying Pro entitlement (fail-closed in production)"
        : "granting access (fail-open in development)") +
      ". Set SUPABASE_SERVICE_ROLE_KEY in Vercel env vars (see PENDING_OPS.md).",
    );
    for (const userId of userIds) result.set(userId, !isProduction);
    return result;
  }

  const { data, error } = await admin
    .from("stripe_customers")
    .select("user_id, tier, status, current_period_end, updated_at")
    .in("user_id", userIds);

  if (error) {
    console.error("[entitlements/web] batched stripe_customers query error:", error.message);
    // fail-open on a transient query error (outage), same as hasProEntitlementWeb.
    for (const userId of userIds) result.set(userId, true);
    return result;
  }

  const rowByUser = new Map<string, StripeCustomerFields>();
  for (const row of (data ?? []) as (StripeCustomerFields & { user_id: string })[]) {
    rowByUser.set(row.user_id, row);
  }

  for (const userId of userIds) {
    const row = rowByUser.get(userId);
    result.set(userId, row ? computeHasPaid(row) : false);
  }
  return result;
}
