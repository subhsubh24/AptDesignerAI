// Waitlist unsubscribe endpoint — the no-login CAN-SPAM opt-out for
// waitlist_emails subscribers.
//
// waitlist_welcome_1 is classified as a marketing send (lib/email/index.ts
// TRANSACTIONAL_STAGES excludes it), so it needs a WORKING opt-out that does
// NOT require signing in — waitlist subscribers never get a Supabase auth
// account (see app/api/waitlist/route.ts, app/api/waitlist/confirm/route.ts).
// Auth here is the row's own `id` (an unguessable UUID) — the same
// unguessable-token-as-auth pattern already used for confirmation_token on
// this same table (see app/api/waitlist/confirm/route.ts's own comment).
//
// Public route: an unauthenticated person clicks this from an email footer,
// so it is allowlisted in lib/supabase/middleware.ts alongside /confirm.

import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, RATE_LIMITS } from "@/lib/utils/rate-limiter";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

function redirectTo(req: NextRequest, status: "unsubscribed" | "invalid"): NextResponse {
  const url = req.nextUrl.clone();
  url.pathname = "/waitlist/confirmed";
  url.search = `?status=${status}`;
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest) {
  // Same throttle as /confirm: a public, unauthenticated, DB-writing endpoint.
  const rate = checkRateLimit(`waitlist-unsubscribe:${clientIp(req)}`, RATE_LIMITS.waitlistConfirm);
  if (!rate.allowed) {
    return redirectTo(req, "invalid");
  }

  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!UUID_RE.test(id)) {
    return redirectTo(req, "invalid");
  }

  const admin = getAdminClient();
  if (!admin) {
    return redirectTo(req, "invalid");
  }

  // Idempotent: only stamps unsubscribed_at the first time. Re-clicking an
  // already-used link (or a bounced auto-retry) still redirects to the
  // friendly confirmation page rather than erroring.
  const { error } = await admin
    .from("waitlist_emails")
    .update({ unsubscribed_at: new Date().toISOString() })
    .eq("id", id)
    .is("unsubscribed_at", null);

  if (error) {
    console.error("[waitlist] unsubscribe failed:", error.message);
    return redirectTo(req, "invalid");
  }

  return redirectTo(req, "unsubscribed");
}
