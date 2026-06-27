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

const DEFAULT_DAILY_LIMIT = 60;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

function dailyLimit(): number {
  const raw = process.env.DAILY_PAID_CALL_LIMIT;
  if (!raw) return DEFAULT_DAILY_LIMIT;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_DAILY_LIMIT;
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

export interface SpendCheckResult {
  allowed: boolean;
  /** Calls used today (including this one when allowed). */
  used: number;
  /** The active daily limit. */
  limit: number;
  /** Milliseconds until the daily window resets (0 when allowed). */
  retryAfterMs: number;
}

/**
 * Record a paid-API call for `userId` and report whether it is within the daily
 * ceiling. A rejected call does NOT consume budget (a call that never runs costs
 * nothing), so once at the limit the count stays pinned until reset.
 *
 * `now` is injectable for deterministic tests; defaults to the wall clock.
 */
export function checkDailySpend(userId: string, now: number = Date.now()): SpendCheckResult {
  maybeCleanup(now);
  const limit = dailyLimit();
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

/** Uniform 429 response for an exceeded daily ceiling — keeps route wiring DRY. */
export function dailySpendExceededResponse(result: SpendCheckResult): NextResponse {
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
