// Waitlist double opt-in confirmation endpoint (E7.1).
//
// The subscriber lands here from the link in their confirmation email. We look
// up the (pending) row by its single-use token, stamp confirmed_at, and clear
// the token so the link can't be replayed, then redirect to a friendly page.
//
// Public route: an unauthenticated person clicks this from their inbox, so it is
// allowlisted in lib/supabase/middleware.ts. Auth here is the unguessable token
// itself, verified against the service-role-only waitlist_emails table.

import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { buildWaitlistWelcomeEmail } from "@/lib/email/templates/waitlist-welcome";
import { checkRateLimit, RATE_LIMITS } from "@/lib/utils/rate-limiter";

// Tokens are exactly 64 hex chars (randomBytes(32)). Match that exactly so a
// junk query string can't trigger a wide scan or odd Postgres behaviour.
const TOKEN_RE = /^[a-f0-9]{64}$/;

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

function redirectTo(req: NextRequest, status: "confirmed" | "invalid"): NextResponse {
  const url = req.nextUrl.clone();
  url.pathname = "/waitlist/confirmed";
  url.search = status === "confirmed" ? "" : "?status=invalid";
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest) {
  // Throttle per IP: this public, unauthenticated endpoint writes the DB and can
  // fire a welcome email on each pending-token match, so an unthrottled burst is
  // a write-load + email-quota abuse surface. A real subscriber follows the link
  // once, so 10/15min per IP never impedes legitimate use. Over the limit we
  // redirect to the same friendly "invalid/try again" page rather than exposing
  // a raw 429, keeping the inbox-clicker's experience coherent.
  const rate = checkRateLimit(`waitlist-confirm:${clientIp(req)}`, RATE_LIMITS.waitlistConfirm);
  if (!rate.allowed) {
    return redirectTo(req, "invalid");
  }

  const token = req.nextUrl.searchParams.get("token") ?? "";
  if (!TOKEN_RE.test(token)) {
    return redirectTo(req, "invalid");
  }

  const admin = getAdminClient();
  if (!admin) {
    // Datastore unavailable — can't confirm right now. Treat as invalid so the
    // user sees a retry-able message rather than a false success.
    return redirectTo(req, "invalid");
  }

  // Only match a still-pending row; a used (confirmed) link has its token cleared
  // and therefore won't be found. select() lets us detect whether a row changed
  // and returns the address so we can send the one-time welcome email.
  const { data, error } = await admin
    .from("waitlist_emails")
    .update({ confirmed_at: new Date().toISOString(), confirmation_token: null })
    .eq("confirmation_token", token)
    .is("confirmed_at", null)
    .select("id, email, unsubscribed_at");

  if (error || !data || data.length === 0) {
    return redirectTo(req, "invalid");
  }

  // First (and only) confirmation: send the welcome email. Because the token is
  // cleared above, a replayed link won't match a pending row, so this fires at
  // most once per subscriber. Dry-run until RESEND_API_KEY is set; sendEmail
  // never throws, so a send failure must not turn a real confirmation into an
  // "invalid" message.
  const row = data[0];
  const email = row?.email;
  if (row?.unsubscribed_at) {
    // Someone can unsubscribe (via an older welcome email, or by request)
    // before ever clicking a still-pending confirm link — honor that opt-out
    // rather than mailing them anyway. The waitlist confirmation itself still
    // succeeds; only the marketing welcome send is skipped.
    console.info("[waitlist] confirmed row already unsubscribed; welcome not sent");
  } else if (typeof email === "string" && email) {
    const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://aptdesignerai.com").replace(
      /\/+$/,
      "",
    );
    const { subject, html, text } = buildWaitlistWelcomeEmail(siteUrl, row.id);
    const result = await sendEmail({ to: email, subject, html, text, stage: "waitlist_welcome_1" });
    if (result.error) {
      console.error("[waitlist] welcome email not sent:", result.error);
    }
  } else {
    // A confirmed row with no email is a data-integrity anomaly — confirmation
    // still succeeds, but surface it so it isn't an invisible "no welcome" hole.
    console.warn("[waitlist] confirmed row missing email; welcome not sent");
  }

  return redirectTo(req, "confirmed");
}
