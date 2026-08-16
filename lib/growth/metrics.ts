// Growth-metrics gatherer — REAL funnel numbers from the durable datastore.
//
// The daily Growth Agent (and the factory dashboard) pulls these via the
// internal API at /api/internal/growth-metrics to populate GROWTH_STATUS with
// data that actually happened — never invented. Only metrics backed by a
// queryable source are returned here; visitor/trial/conversion metrics that
// live in Vercel Analytics or Stripe's reporting API are deliberately omitted
// (they stay null in GROWTH_STATUS until those sources are wired — see
// docs/growth/CONNECT.md).

import type { SupabaseClient } from "@supabase/supabase-js";

export interface GrowthMetrics {
  /** ISO timestamp this snapshot was taken. */
  as_of: string;
  /** Where the numbers came from. */
  source: "supabase";
  funnel: {
    /** All-time waitlist sign-ups. */
    waitlist_signups_total: number;
    /** Waitlist sign-ups in the last 7 days. */
    waitlist_signups_7d: number;
    /**
     * Active recurring subscribers — status = active on a subscription tier
     * (pro or pro_annual). Excludes the one-time `apartment` purchase tier.
     */
    active_subscribers: number;
    /** Subset of active_subscribers on the annual (pro_annual) plan. */
    annual_subscribers: number;
    /**
     * All-time cancelled recurring subscribers (status = cancelled on a
     * subscription tier). A lifetime churn signal for the business case.
     */
    cancelled_subscribers: number;
    /**
     * Recurring subscribers whose row was cancelled in the last 30 days —
     * APPROXIMATE: keyed on `updated_at`, which the Stripe webhook stamps to
     * `now()` on the cancellation event (no dedicated `cancelled_at` column
     * yet). Good enough for a recent-churn gauge; precise cohort churn needs a
     * `cancelled_at` column (future work).
     */
    cancelled_30d: number;
    /**
     * `cancelled_30d` expressed as a RATE over subscribers who were active as
     * of 30 days ago, not a raw count — `null` when that denominator is 0
     * (nothing to churn from). APPROXIMATE for the same reason `cancelled_30d`
     * is: the denominator (`active_30d_ago`) is itself a proxy — subscribers
     * who existed before the 30-day window and either are still active now,
     * or cancelled sometime within the window (so they were still active at
     * its start) — because there is no historical subscriber-count snapshot
     * to read the true count from.
     */
    churn_rate_30d: number | null;
  };
  notes: string;
}

// Recurring subscription tiers. `apartment` is a one-time purchase, not a
// subscription, so it is excluded from subscriber counts. Keep in sync with the
// tier CHECK constraint in supabase/migrations (018 + 021) and lib/entitlements.
const SUBSCRIPTION_TIERS = ["pro", "pro_annual"] as const;

type CountResult = PromiseLike<{ count: number | null; error: unknown }>;

async function toCount(query: CountResult): Promise<number> {
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

/**
 * Gather growth metrics from Supabase via the service-role admin client.
 * Counts run concurrently; throws if any underlying query errors.
 */
export async function gatherGrowthMetrics(admin: SupabaseClient): Promise<GrowthMetrics> {
  const now = Date.now();
  const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
  const tiers = SUBSCRIPTION_TIERS as unknown as string[];

  const [
    waitlistTotal,
    waitlist7d,
    activeSubscribers,
    annualSubscribers,
    cancelledSubscribers,
    cancelled30d,
    active30dAgo,
  ] = await Promise.all([
    toCount(admin.from("waitlist_emails").select("id", { count: "exact", head: true })),
    toCount(
      admin
        .from("waitlist_emails")
        .select("id", { count: "exact", head: true })
        .gte("created_at", sevenDaysAgo),
    ),
    toCount(
      admin
        .from("stripe_customers")
        .select("id", { count: "exact", head: true })
        .eq("status", "active")
        .in("tier", tiers),
    ),
    toCount(
      admin
        .from("stripe_customers")
        .select("id", { count: "exact", head: true })
        .eq("status", "active")
        .eq("tier", "pro_annual"),
    ),
    toCount(
      admin
        .from("stripe_customers")
        .select("id", { count: "exact", head: true })
        .eq("status", "cancelled")
        .in("tier", tiers),
    ),
    toCount(
      admin
        .from("stripe_customers")
        .select("id", { count: "exact", head: true })
        .eq("status", "cancelled")
        .in("tier", tiers)
        .gte("updated_at", thirtyDaysAgo),
    ),
    // Denominator for churn_rate_30d: subscribers who were active as of 30
    // days ago — existed before the window (created_at <= cutoff) and either
    // are still active now, or cancelled sometime WITHIN the window (so they
    // were necessarily still active at its start).
    toCount(
      admin
        .from("stripe_customers")
        .select("id", { count: "exact", head: true })
        .lte("created_at", thirtyDaysAgo)
        .in("tier", tiers)
        .or(`status.eq.active,and(status.eq.cancelled,updated_at.gte.${thirtyDaysAgo})`),
    ),
  ]);

  const churnRate30d = active30dAgo > 0 ? cancelled30d / active30dAgo : null;

  return {
    as_of: new Date().toISOString(),
    source: "supabase",
    funnel: {
      waitlist_signups_total: waitlistTotal,
      waitlist_signups_7d: waitlist7d,
      active_subscribers: activeSubscribers,
      annual_subscribers: annualSubscribers,
      cancelled_subscribers: cancelledSubscribers,
      cancelled_30d: cancelled30d,
      churn_rate_30d: churnRate30d,
    },
    notes:
      "Cancelled counts are sourced from stripe_customers (status = cancelled); " +
      "cancelled_30d is approximate (keyed on updated_at, set by the cancellation " +
      "webhook). churn_rate_30d = cancelled_30d / (subscribers active as of 30 days " +
      "ago, itself an approximation with no historical snapshot to read from) — null " +
      "when that denominator is 0. Visitor, trial-start and conversion-rate metrics require the " +
      "Vercel Analytics and Stripe reporting APIs — see docs/growth/CONNECT.md.",
  };
}
