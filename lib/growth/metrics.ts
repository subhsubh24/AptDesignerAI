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
    /** Subscriptions with status = active (any paid tier). */
    active_subscribers: number;
    /** Active subscriptions on the Pro tier specifically. */
    paid_pro_subscribers: number;
  };
  notes: string;
}

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
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [waitlistTotal, waitlist7d, activeSubscribers, proSubscribers] = await Promise.all([
    toCount(admin.from("waitlist_emails").select("*", { count: "exact", head: true })),
    toCount(
      admin
        .from("waitlist_emails")
        .select("*", { count: "exact", head: true })
        .gte("created_at", sevenDaysAgo),
    ),
    toCount(
      admin
        .from("stripe_customers")
        .select("*", { count: "exact", head: true })
        .eq("status", "active"),
    ),
    toCount(
      admin
        .from("stripe_customers")
        .select("*", { count: "exact", head: true })
        .eq("status", "active")
        .eq("tier", "pro"),
    ),
  ]);

  return {
    as_of: new Date().toISOString(),
    source: "supabase",
    funnel: {
      waitlist_signups_total: waitlistTotal,
      waitlist_signups_7d: waitlist7d,
      active_subscribers: activeSubscribers,
      paid_pro_subscribers: proSubscribers,
    },
    notes:
      "Visitor, trial-start and conversion-rate metrics require the Vercel Analytics and Stripe reporting APIs — see docs/growth/CONNECT.md.",
  };
}
