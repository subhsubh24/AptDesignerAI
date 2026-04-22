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

/**
 * Check rate limit for a given key.
 *
 * Usage:
 *   const limit = checkRateLimit(`diagnosis:${userId}`, { maxRequests: 5, windowMs: 60_000 });
 *   if (!limit.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
 */
export function checkRateLimit(key: string, config: RateLimitConfig): RateLimitResult {
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
  /** Upload: 20 per minute per user */
  upload: { maxRequests: 20, windowMs: 60_000 },
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
} as const;
