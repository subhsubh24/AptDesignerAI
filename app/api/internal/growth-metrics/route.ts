// Internal growth-metrics read API.
//
// Protected by a shared secret (INTERNAL_METRICS_TOKEN, owner-supplied via env).
// The daily Growth Agent calls this each run to read REAL funnel numbers and
// populate GROWTH_STATUS — it never holds DB credentials itself. Returns 503
// until the token is configured, so the endpoint is closed by default.

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getAdminClient } from "@/lib/supabase/admin";
import { gatherGrowthMetrics } from "@/lib/growth/metrics";
import { checkRateLimit } from "@/lib/utils/rate-limiter";

function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function GET(request: NextRequest) {
  const expected = process.env.INTERNAL_METRICS_TOKEN;
  if (!expected) {
    return NextResponse.json(
      { error: "Metrics endpoint is not configured." },
      { status: 503 },
    );
  }

  // Rate-limit by IP first so the shared secret can't be brute-forced.
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";
  const limit = checkRateLimit(`growth-metrics:${ip}`, { maxRequests: 30, windowMs: 60_000 });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil((limit.retryAfterMs ?? 60_000) / 1000)) },
      },
    );
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const provided = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!provided || !tokenMatches(provided, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getAdminClient();
  if (!admin) {
    return NextResponse.json(
      { error: "Metrics datastore is unavailable." },
      { status: 503 },
    );
  }

  try {
    const metrics = await gatherGrowthMetrics(admin);
    return NextResponse.json(metrics);
  } catch (err) {
    console.error("[growth-metrics] failed to gather metrics:", err);
    return NextResponse.json({ error: "Failed to gather metrics." }, { status: 500 });
  }
}
