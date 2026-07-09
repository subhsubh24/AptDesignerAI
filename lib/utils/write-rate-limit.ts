import { NextResponse } from "next/server";
import { checkRateLimit, type RateLimitConfig } from "@/lib/utils/rate-limiter";

/**
 * Per-user rate limit for authenticated DB-write endpoints (Track G1).
 *
 * The paid-API / auth routes already carry their own (stricter) limits; this is
 * the abuse baseline for the cheap authenticated writes (project/room/product/
 * design CRUD) so a single client can't hammer the DB with create/update/delete
 * traffic. Limits are generous — they only stop abuse, never a real burst.
 *
 * Returns a ready-to-return 429 `NextResponse` when the caller is over the
 * limit, or `null` when the request may proceed. Keyed on the authenticated
 * user id so it never throttles across users.
 */

/** Default: 60 writes/min per user — covers any legitimate create/update burst. */
export const DEFAULT_WRITE_LIMIT: RateLimitConfig = { maxRequests: 60, windowMs: 60_000 };

/** Deletes are rarer in normal use; a tighter cap still clears real usage. */
export const DELETE_WRITE_LIMIT: RateLimitConfig = { maxRequests: 30, windowMs: 60_000 };

export function enforceWriteRateLimit(
  userId: string,
  bucket: string,
  config: RateLimitConfig = DEFAULT_WRITE_LIMIT,
): NextResponse | null {
  const limit = checkRateLimit(`write:${bucket}:${userId}`, config);
  if (limit.allowed) return null;
  return NextResponse.json(
    { error: "Too many requests. Please wait a moment and try again." },
    {
      status: 429,
      headers: { "Retry-After": String(Math.ceil((limit.retryAfterMs ?? 60_000) / 1000)) },
    },
  );
}
