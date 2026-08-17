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
  /**
   * PMF leading-indicator signal (ROADMAP "PMF FIRST"). Field names mirror
   * `docs/growth/GROWTH_STATUS.md`'s `pmf` block exactly so the daily Growth
   * Agent can copy these values straight in. `null` means the cohort for
   * that window is currently empty (nobody has been signed up long enough
   * yet to measure it) — never a computed 0/0 masquerading as a real rate.
   */
  pmf: {
    /**
     * Share of a signup cohort who reached "first value" — their first
     * `room_diagnoses` row, the same AI understand+diagnose "aha" event the
     * activation-email cron already targets (see
     * `app/api/cron/activation-emails/route.ts`) — within
     * `ACTIVATION_WINDOW_DAYS` of signing up. Cohort = profiles whose signup
     * is at least `ACTIVATION_WINDOW_DAYS` old, so the window has fully
     * elapsed for everyone counted; a user who signed up yesterday is not
     * "not activated" — they're simply not measurable yet and excluded.
     */
    activation_rate: number | null;
    /**
     * Rolling N-day retention: share of a signup cohort (old enough that
     * day N has fully elapsed) with at least one `room_diagnoses` row ON OR
     * AFTER day N post-signup — i.e. they came back and used the product
     * again, not just their initial activation event. This is a "rolling"
     * definition (any return on/after day N), not "active on exactly day
     * N" — more meaningful at low volume, where an exact-day-N bucket is
     * mostly empty. `retention_d1 >= retention_d7 >= retention_d30` by
     * construction; the SHAPE of the curve (how much it decays) is the PMF
     * signal, per ROADMAP: "a flattening return-cohort curve is the
     * strongest PMF signal."
     */
    retention_d1: number | null;
    retention_d7: number | null;
    retention_d30: number | null;
  };
  notes: string;
}

// Recurring subscription tiers. `apartment` is a one-time purchase, not a
// subscription, so it is excluded from subscriber counts. Keep in sync with the
// tier CHECK constraint in supabase/migrations (018 + 021) and lib/entitlements.
const SUBSCRIPTION_TIERS = ["pro", "pro_annual"] as const;

// Matches activation_3 — the activation-email sequence's own final "have you
// run an analysis yet" nudge (app/api/cron/activation-emails/route.ts). Reusing
// this cutoff rather than inventing a new one keeps "activated" consistent with
// the moment the product itself already treats as the deadline.
const ACTIVATION_WINDOW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

type CountResult = PromiseLike<{ count: number | null; error: unknown }>;

async function toCount(query: CountResult): Promise<number> {
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

type RowsResult<T> = PromiseLike<{ data: T[] | null; error: unknown }>;

async function toRows<T>(query: RowsResult<T>): Promise<T[]> {
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

interface ProfileRow {
  id: string;
  created_at: string;
}

// PostgREST returns the embedded owner chain as a nested object (same shape
// the habit-emails cron already relies on for its own "first analysis" proxy
// query). Non-matching rows are excluded by the `!inner` joins, so each row
// should carry a user_id — stay defensive against a null embed regardless.
interface DiagnosisActivityRow {
  created_at: string;
  rooms?: { projects?: { user_id?: string } | null } | null;
}

function userIdOfDiagnosis(row: DiagnosisActivityRow): string | undefined {
  return row.rooms?.projects?.user_id ?? undefined;
}

/** Buckets each user's room_diagnoses timestamps so activation/retention can
 * be computed against per-user signup dates without a per-user query. */
function groupDiagnosesByUser(rows: DiagnosisActivityRow[]): Map<string, number[]> {
  const byUser = new Map<string, number[]>();
  for (const row of rows) {
    const userId = userIdOfDiagnosis(row);
    if (!userId) continue;
    const ts = new Date(row.created_at).getTime();
    if (Number.isNaN(ts)) continue;
    const existing = byUser.get(userId);
    if (existing) existing.push(ts);
    else byUser.set(userId, [ts]);
  }
  return byUser;
}

function computeActivationRate(
  profiles: ProfileRow[],
  diagnosesByUser: Map<string, number[]>,
  nowMs: number,
): number | null {
  const windowMs = ACTIVATION_WINDOW_DAYS * DAY_MS;
  let eligible = 0;
  let activated = 0;
  for (const profile of profiles) {
    const signupMs = new Date(profile.created_at).getTime();
    if (Number.isNaN(signupMs) || nowMs - signupMs < windowMs) continue;
    eligible++;
    const events = diagnosesByUser.get(profile.id);
    if (events?.some((ts) => ts >= signupMs && ts <= signupMs + windowMs)) activated++;
  }
  return eligible > 0 ? activated / eligible : null;
}

function computeRollingRetention(
  profiles: ProfileRow[],
  diagnosesByUser: Map<string, number[]>,
  nowMs: number,
  days: number,
): number | null {
  const windowMs = days * DAY_MS;
  let eligible = 0;
  let retained = 0;
  for (const profile of profiles) {
    const signupMs = new Date(profile.created_at).getTime();
    if (Number.isNaN(signupMs) || nowMs - signupMs < windowMs) continue;
    eligible++;
    const events = diagnosesByUser.get(profile.id);
    // No separate `ts >= signupMs` guard needed here (unlike activation, below):
    // callers only ever pass a positive `days`, so `ts >= signupMs + windowMs`
    // already implies `ts >= signupMs` — a diagnosis predating its own user's
    // signup can never satisfy this condition.
    if (events?.some((ts) => ts >= signupMs + windowMs)) retained++;
  }
  return eligible > 0 ? retained / eligible : null;
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
    profiles,
    diagnosisRows,
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
    // Signup cohort for activation/retention. Fetches every profile — fine at
    // today's pre-launch volume; a future run should page/bound this once the
    // user count grows large enough for it to matter.
    toRows<ProfileRow>(admin.from("profiles").select("id, created_at")),
    // "First value" / "came back" events for the same cohort — the identical
    // rooms!inner(projects!inner(user_id)) embed the habit-emails cron already
    // uses for its own "first analysis" proxy query.
    toRows<DiagnosisActivityRow>(
      admin.from("room_diagnoses").select("created_at, rooms!inner(projects!inner(user_id))"),
    ),
  ]);

  const churnRate30d = active30dAgo > 0 ? cancelled30d / active30dAgo : null;

  const diagnosesByUser = groupDiagnosesByUser(diagnosisRows);
  const activationRate = computeActivationRate(profiles, diagnosesByUser, now);
  const retentionD1 = computeRollingRetention(profiles, diagnosesByUser, now, 1);
  const retentionD7 = computeRollingRetention(profiles, diagnosesByUser, now, 7);
  const retentionD30 = computeRollingRetention(profiles, diagnosesByUser, now, 30);

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
    pmf: {
      activation_rate: activationRate,
      retention_d1: retentionD1,
      retention_d7: retentionD7,
      retention_d30: retentionD30,
    },
    notes:
      "Cancelled counts are sourced from stripe_customers (status = cancelled); " +
      "cancelled_30d is approximate (keyed on updated_at, set by the cancellation " +
      "webhook). churn_rate_30d = cancelled_30d / (subscribers active as of 30 days " +
      "ago, itself an approximation with no historical snapshot to read from) — null " +
      "when that denominator is 0. Visitor, trial-start and conversion-rate metrics require the " +
      "Vercel Analytics and Stripe reporting APIs — see docs/growth/CONNECT.md. " +
      "pmf.activation_rate / retention_d1 / retention_d7 / retention_d30 are cohort rates over " +
      `profiles, using each user's first room_diagnoses row as the "first value"/"came back" ` +
      `event (activation window = ${ACTIVATION_WINDOW_DAYS} days); null when that window's cohort ` +
      "is currently empty, not a computed 0/0. organic_share_rate remains unbuilt (no " +
      "referral/share query yet).",
  };
}
