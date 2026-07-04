/**
 * Simple in-memory rate limiter for API routes.
 *
 * Uses a sliding window counter per key (IP or user ID).
 * Not suitable for multi-instance deployments — use Redis/Upstash for that.
 * Good enough for single-instance or Vercel serverless (per-function scope).
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Clean up expired entries every 5 minutes
const CLEANUP_INTERVAL = 5 * 60 * 1000;
let lastCleanup = Date.now();

function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;
  for (const [key, entry] of store) {
    if (now >= entry.resetAt) {
      store.delete(key);
    }
  }
}

export interface RateLimitConfig {
  /** Maximum requests allowed in the window */
  maxRequests: number;
  /** Window size in milliseconds */
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  retryAfterMs?: number;
}

let _bypassWarned = false;

/**
 * FAIL-CLOSED guard: the test bypass must NEVER be active on a deployed platform.
 * If E2E_RATE_LIMIT_BYPASS is ever set on Vercel (any deploy — prod OR preview),
 * REFUSE TO BOOT — a disabled rate limiter in production is a wallet-drain/abuse
 * hole. CI/local have no `VERCEL` env, so the bypass works there. Runs at module
 * load (first import on a serverless cold start), so a misconfigured deploy fails
 * fast + loud instead of silently running unprotected.
 */
export function assertRateLimitBypassSafe(): void {
  if (process.env.E2E_RATE_LIMIT_BYPASS === "1" && process.env.VERCEL) {
    throw new Error(
      "FATAL: E2E_RATE_LIMIT_BYPASS is set on a deployed (Vercel) environment — it " +
        "DISABLES rate limiting and must only ever be set in CI. Unset it immediately.",
    );
  }
}
assertRateLimitBypassSafe();

/**
 * TEST-ONLY rate-limit bypass for the CI functional-journey suite.
 *
 * A self-seeding journey suite hammers the API from ONE CI-runner IP and would
 * trip per-IP limits. Gated SOLELY on E2E_RATE_LIMIT_BYPASS=1, an env var
 * PRODUCTION MUST NEVER SET (the CI workflow sets it only on the journey job).
 * Not gated on NODE_ENV (the suite runs a production build via `next start`); the
 * fail-closed guard above hard-refuses it on any Vercel deploy. Logs once, loudly.
 */
export function rateLimitBypassedForTest(): boolean {
  const on = process.env.E2E_RATE_LIMIT_BYPASS === "1";
  if (on && !_bypassWarned) {
    _bypassWarned = true;
    console.warn(
      "[rate-limit] E2E_RATE_LIMIT_BYPASS active — rate limiting DISABLED. " +
        "This is CI/test only; PRODUCTION must never set this env var.",
    );
  }
  return on;
}

/**
 * Check rate limit for a given key.
 *
 * Usage:
 *   const limit = checkRateLimit(`diagnosis:${userId}`, { maxRequests: 5, windowMs: 60_000 });
 *   if (!limit.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
 */
export function checkRateLimit(key: string, config: RateLimitConfig): RateLimitResult {
  if (rateLimitBypassedForTest()) {
    return { allowed: true, remaining: config.maxRequests, resetAt: Date.now() + config.windowMs };
  }
  cleanup();

  const now = Date.now();
  const entry = store.get(key);

  // No existing entry or window expired — start fresh
  if (!entry || now >= entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + config.windowMs });
    return {
      allowed: true,
      remaining: config.maxRequests - 1,
      resetAt: now + config.windowMs,
    };
  }

  // Within window — increment
  entry.count++;

  if (entry.count > config.maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: entry.resetAt,
      retryAfterMs: entry.resetAt - now,
    };
  }

  return {
    allowed: true,
    remaining: config.maxRequests - entry.count,
    resetAt: entry.resetAt,
  };
}

/**
 * Pre-built rate limit configs for different endpoints.
 */
export const RATE_LIMITS = {
  /** Diagnosis: 5 per minute per user */
  diagnosis: { maxRequests: 5, windowMs: 60_000 },
  /** Search: 10 per minute per user */
  search: { maxRequests: 10, windowMs: 60_000 },
  /** Product evaluation: 30 per minute per user */
  evaluate: { maxRequests: 30, windowMs: 60_000 },
  /** Mockup generation: 5 per minute per user */
  mockup: { maxRequests: 5, windowMs: 60_000 },
  /** Recommendation mockups: lightweight product shots, higher limit */
  recommendationMockup: { maxRequests: 15, windowMs: 60_000 },
  /** Upload: 20 per minute per user */
  upload: { maxRequests: 20, windowMs: 60_000 },
  /** Mobile entitlements — proxies a paid RevenueCat REST call; 30 per minute per user */
  mobileEntitlements: { maxRequests: 30, windowMs: 60_000 },
  /** Area analysis — slow, heavy. 3 per 5 minutes per user */
  areaAnalysis: { maxRequests: 3, windowMs: 5 * 60_000 },
  /** Area analysis refine — cheap follow-up. 10 per minute */
  areaAnalysisRefine: { maxRequests: 10, windowMs: 60_000 },
  /** Products ingest — 20 per minute */
  productsIngest: { maxRequests: 20, windowMs: 60_000 },
  /** Places photo — 30 per minute */
  placesPhoto: { maxRequests: 30, windowMs: 60_000 },
  /** Bundle evaluate — 10 per minute */
  bundleEvaluate: { maxRequests: 10, windowMs: 60_000 },
  /** Product evaluate — 30 per minute */
  productEvaluate: { maxRequests: 30, windowMs: 60_000 },
  /** Apartment analysis (heavy LLM, multi-room) — 5 per hour */
  analyzeApartment: { maxRequests: 5, windowMs: 60 * 60_000 },
  /** Building research (Gemini + Maps) — 3 per hour */
  apartmentResearch: { maxRequests: 3, windowMs: 60 * 60_000 },
  /** Computer-use product verifier (Browserbase ~$5-20/session) — 2 per hour */
  computerUseVerify: { maxRequests: 2, windowMs: 60 * 60_000 },
  /** Billing checkout session creation — 10 per hour */
  billingCheckout: { maxRequests: 10, windowMs: 60 * 60_000 },
  /** Account deletion — 3 per day (highly destructive) */
  userDelete: { maxRequests: 3, windowMs: 24 * 60 * 60_000 },
  /** Area analysis refine chat — 20 per minute */
  areaAnalysisRefineChat: { maxRequests: 20, windowMs: 60_000 },
  /** Area analysis refine (full re-run) — 5 per 5 minutes */
  areaAnalysisRefineFull: { maxRequests: 5, windowMs: 5 * 60_000 },
  /** Floor-plan extraction (heavy vision LLM) — 5 per 5 minutes per user */
  floorPlanExtract: { maxRequests: 5, windowMs: 5 * 60_000 },
  /** Product correction (grounded verifier + embedding) — 10 per minute per user */
  productCorrect: { maxRequests: 10, windowMs: 60_000 },
} as const;
