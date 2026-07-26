/**
 * Per-user/day paid-API spend ceiling (circuit breaker) — ROADMAP G7.
 *
 * Caps how many paid external-API calls (Gemini / Tavily / Browserbase / Google
 * Maps) a single user can trigger per UTC day, summed across ALL expensive
 * endpoints. This is defense-in-depth ON TOP of lib/utils/rate-limiter.ts:
 *   - the rate limiter caps bursts on one endpoint (e.g. 5 diagnoses/min);
 *   - this caps total daily spend per user across every expensive endpoint, so a
 *     compromised or abusive account can't quietly drain the API budget by
 *     spreading calls across routes or pacing them under each route's limit.
 *
 * In-memory, like the rate limiter: state is per server instance and resets on
 * cold start (acceptable pre-launch; move to Upstash Redis with the rate limiter
 * before scale — see PENDING_OPS.md). The human-only hard caps + 50%-of-cap
 * alerts in the provider dashboards are the durable backstop (also PENDING_OPS).
 */

import { NextResponse } from "next/server";
import { getWebBillingStatus } from "@/lib/entitlements/web";

const DEFAULT_DAILY_LIMIT = 60;
const DEFAULT_PRO_DAILY_LIMIT = 180;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

function envLimit(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function dailyLimit(): number {
  return envLimit("DAILY_PAID_CALL_LIMIT", DEFAULT_DAILY_LIMIT);
}

/**
 * The Pro ceiling. Pro is sold with "Higher AI generation limits" (the Pro tier
 * on /pricing and /billing/upgrade), so the ceiling has to actually differ —
 * otherwise the subscription advertises a benefit the server does not grant,
 * which is both untrue and an App Store 3.1.2 review risk.
 *
 * Never let the Pro ceiling resolve BELOW the free one: a mis-set
 * DAILY_PAID_CALL_LIMIT_PRO (or a raised free limit) must not leave subscribers
 * worse off than free users.
 */
function proDailyLimit(): number {
  return Math.max(dailyLimit(), envLimit("DAILY_PAID_CALL_LIMIT_PRO", DEFAULT_PRO_DAILY_LIMIT));
}

interface DailyEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, DailyEntry>();
let lastCleanup = 0;

function nextUtcMidnight(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0, 0);
}

function maybeCleanup(now: number): void {
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  for (const [key, entry] of store) {
    if (now >= entry.resetAt) store.delete(key);
  }
}

/**
 * Result of a daily-spend check. Discriminated on `allowed` so that, inside an
 * `if (!result.allowed)` guard, the type narrows to BlockedSpendResult — making
 * it a compile error to pass an allowed result to dailySpendExceededResponse().
 * `used` = calls used today; `limit` = active daily limit; `retryAfterMs` = ms
 * until reset (0 when allowed).
 */
export type SpendCheckResult =
  | { allowed: true; used: number; limit: number; retryAfterMs: 0 }
  | { allowed: false; used: number; limit: number; retryAfterMs: number };

/** A spend result that has been rejected — the only valid input to the 429 helper. */
export type BlockedSpendResult = Extract<SpendCheckResult, { allowed: false }>;

/**
 * Record a paid-API call for `userId` and report whether it is within the daily
 * ceiling. A rejected call does NOT consume budget (a call that never runs costs
 * nothing), so once at the limit the count stays pinned until reset.
 *
 * `now` is injectable for deterministic tests; defaults to the wall clock.
 */
export function checkDailySpend(
  userId: string,
  now: number = Date.now(),
  limitOverride?: number,
): SpendCheckResult {
  maybeCleanup(now);
  const limit = limitOverride ?? dailyLimit();
  const entry = store.get(userId);

  if (!entry || now >= entry.resetAt) {
    store.set(userId, { count: 1, resetAt: nextUtcMidnight(now) });
    return { allowed: true, used: 1, limit, retryAfterMs: 0 };
  }

  if (entry.count >= limit) {
    return { allowed: false, used: entry.count, limit, retryAfterMs: entry.resetAt - now };
  }

  entry.count++;
  return { allowed: true, used: entry.count, limit, retryAfterMs: 0 };
}

/**
 * True only for a subscriber on an ACTIVE Pro plan (monthly or annual).
 *
 * `hasPaid` alone is not enough: the one-time Apartment purchase also sets it,
 * and "Higher AI generation limits" is sold on the Pro tier only.
 *
 * FAILS TO THE FREE CEILING whenever the tier cannot be determined — a missing
 * service-role key, a DB outage, a user with no billing row. This is the
 * DELIBERATE OPPOSITE of hasProEntitlementWeb(), which fails OPEN so an outage
 * never locks a paying subscriber out of a feature they bought. The two differ
 * because the failure costs differ: wrongly denying a *feature* is a broken
 * product, but wrongly raising a *spend ceiling* hands an abusive account 3x the
 * paid-API budget — and the downside here is mild and self-correcting (a Pro
 * user briefly capped at the free ceiling during an outage, on a limit most
 * users never approach). An abuse ceiling must never be raised by an error.
 */
async function hasActiveProPlan(userId: string): Promise<boolean> {
  let status: Awaited<ReturnType<typeof getWebBillingStatus>>;
  try {
    status = await getWebBillingStatus(userId);
  } catch {
    // getWebBillingStatus already returns null for a query error, but a thrown
    // network/client failure must not take down an otherwise-working route.
    return false;
  }
  if (!status || !status.hasPaid) return false;
  return status.tier === "pro" || status.tier === "pro_annual";
}

/**
 * Record a paid-API call and report whether it is within THAT USER'S daily
 * ceiling — the free ceiling by default, the higher Pro ceiling for an active
 * Pro subscriber. Prefer this over calling checkDailySpend() directly from a
 * route; the bare function applies the free ceiling to everyone.
 *
 * `now` is injectable for deterministic tests; defaults to the wall clock.
 */
export async function checkDailySpendForUser(
  userId: string,
  now: number = Date.now(),
): Promise<SpendCheckResult> {
  const limit = (await hasActiveProPlan(userId)) ? proDailyLimit() : dailyLimit();
  return checkDailySpend(userId, now, limit);
}

/** Uniform 429 response for an exceeded daily ceiling — keeps route wiring DRY. */
export function dailySpendExceededResponse(result: BlockedSpendResult): NextResponse {
  return NextResponse.json(
    { error: "Daily usage limit reached. Please try again tomorrow." },
    {
      status: 429,
      headers: { "Retry-After": String(Math.max(1, Math.ceil(result.retryAfterMs / 1000))) },
    },
  );
}

/** Test helper: clear all daily-spend state. */
export function __resetDailySpend(): void {
  store.clear();
  lastCleanup = 0;
}
