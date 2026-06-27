// Internal social publishing queue API (E7.3).
//
// The daily Growth Agent uses this to WRITE drafts into the queue and to read
// queue status; the app (which holds the channel secrets) FLUSHES due posts
// through lib/social providers — dry-run until a channel is connected. Shares
// the internal-tooling auth model (INTERNAL_METRICS_TOKEN shared secret); the
// agent never holds channel credentials.
//
//   GET                      -> queue status counts
//   POST { action: "enqueue", platform, body, mediaUrls?, scheduledFor?, dedupeKey? }
//   POST { action: "flush", limit? }
//
// Closed by default: returns 503 until INTERNAL_METRICS_TOKEN is set.

import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit } from "@/lib/utils/rate-limiter";
import { enqueuePost, flushDueQueue, getQueueStatus } from "@/lib/social/queue";
import { isSocialPlatform } from "@/lib/social";

// Constant-time compare that doesn't leak the expected token's length.
function tokenMatches(provided: string, expected: string): boolean {
  const key = "internal-token-compare";
  const a = createHmac("sha256", key).update(provided).digest();
  const b = createHmac("sha256", key).update(expected).digest();
  return timingSafeEqual(a, b);
}

// Returns the authed admin client, or a NextResponse to short-circuit with.
function authorize(request: NextRequest): { admin: ReturnType<typeof getAdminClient> } | NextResponse {
  const expected = process.env.INTERNAL_METRICS_TOKEN;
  if (!expected) {
    return NextResponse.json({ error: "Queue endpoint is not configured." }, { status: 503 });
  }

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";
  const limit = checkRateLimit(`social-queue:${ip}`, { maxRequests: 30, windowMs: 60_000 });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((limit.retryAfterMs ?? 60_000) / 1000)) } },
    );
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const provided = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!provided || !tokenMatches(provided, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Queue datastore is unavailable." }, { status: 503 });
  }
  return { admin };
}

export async function GET(request: NextRequest) {
  const authed = authorize(request);
  if (authed instanceof NextResponse) return authed;
  const admin = authed.admin!;

  try {
    const status = await getQueueStatus(admin);
    return NextResponse.json({ status });
  } catch (err) {
    console.error("[social-queue] status failed:", err);
    return NextResponse.json({ error: "Failed to read queue status." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const authed = authorize(request);
  if (authed instanceof NextResponse) return authed;
  const admin = authed.admin!;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const action = body.action;

  if (action === "enqueue") {
    if (!isSocialPlatform(body.platform)) {
      return NextResponse.json({ error: "Unknown or missing platform." }, { status: 400 });
    }
    if (typeof body.body !== "string") {
      return NextResponse.json({ error: "Missing post body." }, { status: 400 });
    }
    const mediaUrls = Array.isArray(body.mediaUrls)
      ? body.mediaUrls.filter((u): u is string => typeof u === "string")
      : undefined;
    const result = await enqueuePost(admin, {
      platform: body.platform,
      body: body.body,
      mediaUrls,
      scheduledFor: typeof body.scheduledFor === "string" ? body.scheduledFor : undefined,
      dedupeKey: typeof body.dedupeKey === "string" ? body.dedupeKey : undefined,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json(result, { status: 200 });
  }

  if (action === "flush") {
    const limit = typeof body.limit === "number" ? body.limit : undefined;
    try {
      const summary = await flushDueQueue(admin, { limit });
      return NextResponse.json({ summary });
    } catch (err) {
      console.error("[social-queue] flush failed:", err);
      return NextResponse.json({ error: "Flush failed." }, { status: 500 });
    }
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
