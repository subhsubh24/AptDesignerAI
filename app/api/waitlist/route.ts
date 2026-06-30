import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { getAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { buildWaitlistConfirmEmail } from "@/lib/email/templates/waitlist";
import { verifyTurnstile } from "@/lib/security/turnstile";
import { rateLimitBypassedForTest } from "@/lib/utils/rate-limiter";
import { generateReferralCode, sanitizeReferralCode } from "@/lib/waitlist/referral";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254;

// In-memory rate limiter: 5 requests per IP per 15 minutes.
// Acceptable for a single-instance deployment; swap for Upstash Redis if needed.
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT = 5;

// Don't re-send a confirmation email to a still-pending address more than once
// per this window, so the public endpoint can't be used to spam an inbox.
const RESEND_COOLDOWN_MS = 5 * 60 * 1000;
const ipBucket = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string): boolean {
  if (rateLimitBypassedForTest()) return false; // CI journey suite only (E2E_RATE_LIMIT_BYPASS)
  const now = Date.now();
  const entry = ipBucket.get(ip);
  if (!entry || now >= entry.resetAt) {
    ipBucket.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  if (entry.count >= RATE_LIMIT) return true;
  entry.count++;
  return false;
}

/** 64-char unguessable hex token mailed in the confirmation link. */
function newConfirmationToken(): string {
  return randomBytes(32).toString("hex");
}

/** Absolute base URL for confirm links: explicit site URL in prod, else the request origin. */
function siteOrigin(req: NextRequest): string {
  return process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ?? req.nextUrl.origin;
}

/**
 * Send the double opt-in confirmation email. Never throws — the lib/email layer
 * is dry-run until RESEND_API_KEY is set, so a sign-up succeeds (and is stored
 * as pending) whether or not a real send happens.
 */
async function sendConfirmation(req: NextRequest, email: string, token: string): Promise<void> {
  const confirmUrl = `${siteOrigin(req)}/api/waitlist/confirm?token=${token}`;
  const { subject, html, text } = buildWaitlistConfirmEmail(confirmUrl);
  const result = await sendEmail({ to: email, subject, html, text, stage: "waitlist_confirm" });
  if (result.error) {
    // Log only; the address is already stored as pending and the user is told to
    // check their inbox. A transient provider failure must not 500 the sign-up.
    console.error("[waitlist] confirmation email not sent:", result.error);
  }
}

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";

  if (isRateLimited(ip)) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a few minutes and try again." },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = typeof (body as Record<string, unknown>).email === "string"
    ? ((body as Record<string, unknown>).email as string).trim().toLowerCase()
    : "";

  if (!email || email.length > MAX_EMAIL_LENGTH || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
  }

  // Bot protection (G5). No-op until TURNSTILE_SECRET_KEY is set; once enabled,
  // a request must carry a valid Turnstile token. The widget puts it on the body
  // as `turnstileToken`.
  const captchaToken =
    typeof (body as Record<string, unknown>).turnstileToken === "string"
      ? ((body as Record<string, unknown>).turnstileToken as string)
      : null;
  const captcha = await verifyTurnstile(captchaToken, ip);
  if (captcha.reason === "unreachable") {
    // Failed open during a Cloudflare outage — surface it so a silent
    // bypass window is visible in logs (rate limiting still applies).
    console.warn("[waitlist] turnstile verification unreachable; allowed");
  }
  if (!captcha.success) {
    console.warn("[waitlist] turnstile rejected sign-up:", captcha.reason);
    return NextResponse.json(
      { error: "Couldn't verify you're human. Please try again." },
      { status: 400 },
    );
  }

  const admin = getAdminClient();
  if (!admin) {
    return NextResponse.json(
      { error: "Waitlist sign-up is temporarily unavailable. Please try again later." },
      { status: 503 },
    );
  }

  // Referral attribution: only store a `referred_by` code that actually exists,
  // so a hand-typed or junk `?ref=` never pollutes the funnel data.
  const refInput = sanitizeReferralCode((body as Record<string, unknown>).ref);
  let referredBy: string | null = null;
  if (refInput) {
    const { data: referrer } = await admin
      .from("waitlist_emails")
      .select("id")
      .eq("referral_code", refInput)
      .maybeSingle();
    if (referrer) referredBy = refInput;
  }

  const token = newConfirmationToken();
  // This subscriber's own shareable code. A unique collision is astronomically
  // unlikely (~6.5e11 space) but handled: regenerate and retry rather than fail.
  let referralCode = generateReferralCode();
  let error: { code?: string; message?: string; details?: string } | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await admin.from("waitlist_emails").insert({
      email,
      source: "waitlist",
      confirmation_token: token,
      token_sent_at: new Date().toISOString(),
      referral_code: referralCode,
      referred_by: referredBy,
    });
    error = res.error;
    if (!error) break;
    // Retry ONLY a referral_code collision; an email duplicate falls through to
    // the existing-subscriber handling below.
    const isReferralCollision =
      error.code === "23505" && /referral_code/i.test(`${error.message ?? ""} ${error.details ?? ""}`);
    if (!isReferralCollision) break;
    referralCode = generateReferralCode();
  }

  // Retries exhausted on a referral_code collision (astronomically unlikely):
  // fail explicitly rather than fall through to the email-duplicate handler
  // below, which would wrongly tell a never-inserted user they're already
  // subscribed.
  if (
    error &&
    error.code === "23505" &&
    /referral_code/i.test(`${error.message ?? ""} ${error.details ?? ""}`)
  ) {
    console.error("[waitlist] referral_code collision retries exhausted");
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 },
    );
  }

  if (error) {
    if (error.code === "23505") {
      // Address already captured. If it was already confirmed, say so; if it is
      // still pending, re-issue a fresh token and resend the confirmation so a
      // lost first email isn't a dead end.
      const { data: existing } = await admin
        .from("waitlist_emails")
        .select("id, confirmed_at, token_sent_at, referral_code")
        .eq("email", email)
        .maybeSingle();

      // Return the subscriber's existing code so re-visiting can still grab their
      // share link (NULL for rows that predate the referral migration).
      const existingCode = (existing?.referral_code as string | null) ?? null;

      if (existing && existing.confirmed_at == null) {
        // Throttle resends so the public endpoint can't be used to flood a
        // victim's inbox (the per-IP limit doesn't stop distributed IPs). If a
        // confirm email went out recently, acknowledge as pending WITHOUT
        // resending — the subscriber already has a live link.
        const lastSent = existing.token_sent_at ? Date.parse(existing.token_sent_at as string) : 0;
        const throttled = Number.isFinite(lastSent) && Date.now() - lastSent < RESEND_COOLDOWN_MS;
        if (throttled) {
          return NextResponse.json({ pendingConfirmation: true, referralCode: existingCode }, { status: 200 });
        }

        const resendToken = newConfirmationToken();
        const { error: updateError } = await admin
          .from("waitlist_emails")
          .update({ confirmation_token: resendToken, token_sent_at: new Date().toISOString() })
          .eq("id", existing.id)
          .is("confirmed_at", null);
        if (!updateError) {
          await sendConfirmation(req, email, resendToken);
          return NextResponse.json({ pendingConfirmation: true, referralCode: existingCode }, { status: 200 });
        }
      }

      return NextResponse.json({ alreadySubscribed: true, referralCode: existingCode }, { status: 200 });
    }
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 },
    );
  }

  await sendConfirmation(req, email, token);
  return NextResponse.json({ pendingConfirmation: true, referralCode }, { status: 200 });
}
