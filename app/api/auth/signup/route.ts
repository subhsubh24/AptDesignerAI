import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { verifyTurnstile } from "@/lib/security/turnstile";
import { isAlreadyRegisteredError } from "@/lib/auth/signup-errors";
import { rateLimitBypassedForTest } from "@/lib/utils/rate-limiter";

/**
 * Server-side account creation — auto-confirmed, NO email verification.
 *
 * WHY: there is no working transactional-email pipeline pre-launch (Supabase's
 * built-in auth email is unconfigured; real deliverability needs an owner-set
 * SMTP/Resend secret + verified domain). Gating signup on an email link that
 * never arrives dead-ends every new user. So we create the user already
 * CONFIRMED via the service-role admin client (the same pattern the e2e seeder
 * uses) and the client then signs in normally. No "check your email" promise is
 * made because no email is sent. To RE-ENABLE verification later, connect a real
 * email provider AND add the email round-trip test first — see PENDING_OPS.md.
 *
 * Hardened like the public waitlist route: per-IP rate limit + Turnstile +
 * enumeration-safe (a brand-new and an already-registered address return the
 * SAME response, so this endpoint can't be used to probe which emails exist).
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254;
const MIN_PASSWORD = 6; // matches the signup form's stated minimum
const MAX_PASSWORD = 200;
const MAX_NAME_LENGTH = 120;

// In-memory rate limiter: 5 sign-ups per IP per 15 minutes (mirrors the
// waitlist route). Acceptable for a single instance; swap for Upstash if scaled.
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT = 5;
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

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";

  if (isRateLimited(ip)) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait a few minutes and try again." },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const rec = (body ?? {}) as Record<string, unknown>;

  const email = typeof rec.email === "string" ? rec.email.trim().toLowerCase() : "";
  const password = typeof rec.password === "string" ? rec.password : "";
  const fullName =
    typeof rec.fullName === "string" ? rec.fullName.trim().slice(0, MAX_NAME_LENGTH) : "";

  if (!email || email.length > MAX_EMAIL_LENGTH || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
  }
  if (password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) {
    return NextResponse.json(
      { error: `Password must be at least ${MIN_PASSWORD} characters.` },
      { status: 400 },
    );
  }

  // Bot protection (G5). No-op until TURNSTILE_SECRET_KEY is set.
  const captchaToken = typeof rec.turnstileToken === "string" ? rec.turnstileToken : null;
  const captcha = await verifyTurnstile(captchaToken, ip);
  if (captcha.reason === "unreachable") {
    console.warn("[auth/signup] turnstile verification unreachable; allowed");
  }
  if (!captcha.success) {
    return NextResponse.json(
      { error: "Couldn't verify you're human. Please try again." },
      { status: 400 },
    );
  }

  const admin = getAdminClient();
  if (!admin) {
    return NextResponse.json(
      { error: "Sign-up is temporarily unavailable. Please try again later." },
      { status: 503 },
    );
  }

  const { error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: fullName ? { full_name: fullName } : undefined,
  });

  // Enumeration-safe: an already-registered address returns the SAME { ok }
  // response as a fresh one (the client then attempts sign-in either way).
  if (error && !isAlreadyRegisteredError(error)) {
    console.error("[auth/signup] createUser failed:", error.message);
    return NextResponse.json(
      { error: "Something went wrong creating your account. Please try again." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
