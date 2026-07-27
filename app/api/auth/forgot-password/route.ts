import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { getAdminClient } from "@/lib/supabase/admin";
import { verifyTurnstile } from "@/lib/security/turnstile";
import { sendEmail, isEmailDryRun } from "@/lib/email";
import { buildPasswordResetEmail } from "@/lib/email/templates/password-reset";
import { createHash } from "node:crypto";
import { checkRateLimit, RATE_LIMITS, rateLimitBypassedForTest } from "@/lib/utils/rate-limiter";

// Mints a Supabase recovery link (admin call) and hands it to the email
// provider (outbound Resend fetch). Bound the function so a slow upstream can't
// hang past the serverless budget — same 20s as the signup route.
export const maxDuration = 20;

/**
 * Password reset — request a recovery link (G4 account recovery).
 *
 * Until this existed, a user who forgot their password was permanently locked
 * out: there was no reset flow anywhere in the app, so a paying subscriber
 * losing their password lost their account and their saved designs.
 *
 * Three properties this route MUST hold, in priority order:
 *
 *  1. NO FAKE SUCCESS. The email pipeline ships in dry-run until the owner sets
 *     RESEND_API_KEY (PENDING_OPS `connect-email-resend`). Telling a
 *     locked-out user "check your inbox" while nothing is sent is the exact
 *     BUILDS≠WORKS trap that made signup drop its verification step. So the
 *     dry-run case returns `emailUnavailable: true` and the page points the
 *     user at support instead of promising mail we cannot send.
 *  2. ENUMERATION-SAFE (G4). A registered and an unregistered address return
 *     the SAME `{ ok: true }` body and the same status, so this endpoint can't
 *     be used to probe which emails have accounts — the property
 *     signup-errors.ts and login-errors.ts establish on the other two auth
 *     surfaces. Every internal failure is logged server-side only (G3).
 *  3. NOT AN EMAIL CANNON. A public, unauthenticated endpoint that sends mail
 *     to an attacker-supplied address is an abuse vector, so it carries the
 *     same per-IP limit + Turnstile as the other public forms (G1/G5), with a
 *     tighter budget than signup: reset is a rare action.
 *
 *     The per-IP limit alone does not deliver this — it bounds the SENDER, not
 *     the VICTIM'S INBOX. A second control keyed on the target address closes
 *     that, but only in a shape that cannot itself deny a user their recovery:
 *     see `emailBudget()` for why it is a cooldown and not a quota.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254;

// 3 reset requests per IP per 15 minutes — deliberately tighter than signup's 5.
// In-memory, like the sibling public routes; swap for Upstash if scaled out.
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT = 3;
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

/**
 * Absolute base URL the reset link points at.
 *
 * `req.nextUrl.origin` comes from the request's Host/X-Forwarded-Host headers,
 * which a caller controls. That is tolerable for the waitlist confirm link; it
 * is NOT tolerable here, because the link carries a one-time credential that
 * takes over an account — a spoofed Host would mail the victim a link pointing
 * at the attacker's domain. So production demands the configured site URL and
 * refuses to guess; the request-origin fallback exists only for local dev.
 */
function siteOrigin(req: NextRequest): string | null {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "");
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") return null;
  return req.nextUrl.origin;
}

/** The one neutral success body. Never varies on whether the account exists. */
const NEUTRAL_OK = { ok: true } as const;

/**
 * Is this ADDRESS due another reset email, or was one just sent to it?
 *
 * A COOLDOWN (one send per address per 2 minutes), deliberately NOT an hourly
 * quota — the distinction is the whole design, because the obvious version of
 * this control is worse than the problem it solves.
 *
 * A quota ("3 per address per hour") looks right and creates a
 * DENIAL-OF-RECOVERY weapon. The per-IP limit is 3 per 15 minutes, so a quota
 * of 3/hour is exhaustible by ONE address from ONE IP with three requests, and
 * `verifyTurnstile` fails OPEN while TURNSTILE_SECRET_KEY is unset. Any
 * anonymous caller could therefore spend three POSTs and stop a real user
 * receiving ANY reset mail for the rest of the hour. Before such a control,
 * bombing was possible but recovery always worked; after it, recovery can be
 * switched off on demand. That trade is not worth making.
 *
 * A cooldown has no such state. Every window's FIRST request still sends, so
 * the victim of a flood always holds a link at most two minutes old — the
 * attacker's own requests keep delivering it — and the flood is capped at 30
 * mails an hour instead of unbounded. Suppression never denies recovery; it
 * only declines to send a second copy of a link that is already in the inbox.
 *
 * The caller must treat `false` as "skip the send, return the SAME neutral
 * body" — never as an error to report. A 429 here would signal that this
 * address was recently the target of a reset request, which is exactly the
 * probe the identical-response design exists to close.
 *
 * Keyed on a hash of the address: the limiter's `store` is a long-lived
 * in-process Map and does not need plaintext addresses to count them. (The hash
 * is unsalted and email is a guessable space, so this is hygiene, not secrecy.)
 *
 * SCOPE, honestly: `checkRateLimit` is per-process. On a multi-instance
 * deployment the real ceiling is one send per window PER INSTANCE, so this
 * throttles a flood rather than hard-capping it — the same pre-existing
 * limitation the per-IP bucket above already carries.
 */
function emailBudget(email: string): boolean {
  const key = `pwreset-email:${createHash("sha256").update(email).digest("hex")}`;
  return checkRateLimit(key, RATE_LIMITS.passwordResetPerEmail).allowed;
}

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";

  if (isRateLimited(ip)) {
    return NextResponse.json(
      { error: "Too many reset requests. Please wait a few minutes and try again." },
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
  if (!email || email.length > MAX_EMAIL_LENGTH || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
  }

  // Bot protection (G5). No-op until TURNSTILE_SECRET_KEY is set.
  const captchaToken = typeof rec.turnstileToken === "string" ? rec.turnstileToken : null;
  const captcha = await verifyTurnstile(captchaToken, ip);
  if (captcha.reason === "unreachable") {
    console.warn("[auth/forgot-password] turnstile verification unreachable; allowed");
  }
  if (!captcha.success) {
    return NextResponse.json(
      { error: "Couldn't verify you're human. Please try again." },
      { status: 400 },
    );
  }

  // (1) NO FAKE SUCCESS. Checked before anything is minted: with no live
  // provider there is no honest "check your email" to render, so say so and let
  // the page route the user to support. This is also why the check lives here
  // and not after the send — sendEmail's dry-run provider returns a *successful*
  // result (delivered:false, dryRun:true), which is easy to mistake for a send.
  if (isEmailDryRun()) {
    return NextResponse.json({ ...NEUTRAL_OK, emailUnavailable: true }, { status: 200 });
  }

  const admin = getAdminClient();
  if (!admin) {
    // Deploy-time misconfiguration, not a user error. Distinct from the dry-run
    // case above: email IS live, so silently doing nothing would be a fake
    // success. Fail visibly.
    console.error("[auth/forgot-password] no admin client; cannot mint a recovery link");
    return NextResponse.json(
      { error: "Password reset is temporarily unavailable. Please try again later." },
      { status: 503 },
    );
  }

  const origin = siteOrigin(req);
  if (!origin) {
    console.error(
      "[auth/forgot-password] NEXT_PUBLIC_SITE_URL is unset in production; refusing to " +
        "build a recovery link from a request-supplied Host header",
    );
    return NextResponse.json(
      { error: "Password reset is temporarily unavailable. Please try again later." },
      { status: 503 },
    );
  }

  // (3) NOT AN EMAIL CANNON, second half: throttle the VICTIM's inbox, not just
  // the sender's rate. Evaluated here — after validation and Turnstile, so it
  // cannot be probed for free — but it gates ONLY the send, NOT the
  // generateLink call below.
  //
  // That separation is load-bearing. generateLink is an awaited network
  // round-trip; skipping it on the suppressed path would make those responses
  // measurably faster and leak, by latency, the very fact the identical body
  // and status exist to hide — the same timing oracle the `waitUntil` on the
  // send (see below) was written to avoid. So both paths pay the same call and
  // only the mail differs.
  const sendDue = emailBudget(email);
  if (!sendDue) {
    console.warn("[auth/forgot-password] address in cooldown; suppressing duplicate send");
  }

  // (2) ENUMERATION-SAFE. generateLink errors for an address with no account.
  // That error is logged and swallowed — the caller gets the same body either
  // way. Everything below this point returns NEUTRAL_OK.
  //
  // We take `hashed_token` and build our OWN link rather than mailing the
  // provider's `action_link`. That is not a preference — it is required by the
  // client this app ships. `action_link` points at Supabase's /auth/v1/verify,
  // which redirects back with the session in the URL *fragment* (the implicit
  // flow), because an admin-minted link has no PKCE code_verifier to pair with.
  // But `createBrowserClient` (@supabase/ssr) hardcodes `flowType: "pkce"`
  // AFTER spreading caller options, and auth-js's _getSessionFromURL throws
  // AuthPKCEGrantCodeExchangeError ("Not a valid PKCE flow url") the moment a
  // pkce-configured client meets an implicit callback. Every valid reset link
  // would have died on arrival and shown "that link has expired". Handing the
  // page a token_hash it redeems explicitly with verifyOtp sidesteps the flow
  // mismatch entirely.
  let resetUrl: string | null = null;
  try {
      const { data, error } = await admin.auth.admin.generateLink({
        type: "recovery",
        email,
        options: { redirectTo: `${origin}/reset-password` },
      });
      if (error) {
        console.warn("[auth/forgot-password] generateLink declined:", error.message);
      } else {
        const tokenHash = data?.properties?.hashed_token;
        if (tokenHash) {
          resetUrl = `${origin}/reset-password?token_hash=${encodeURIComponent(tokenHash)}&type=recovery`;
        } else {
          // Provider-contract violation: success with nothing to redeem. Silent
          // here would be a fake success — the user is told a link was sent.
          console.error(
            "[auth/forgot-password] generateLink succeeded but returned no hashed_token; " +
              "no reset email sent",
          );
        }
      }
  } catch (err) {
    console.error("[auth/forgot-password] generateLink threw:", err);
  }

  if (resetUrl && sendDue) {
    const { subject, html, text } = buildPasswordResetEmail(resetUrl);
    // The send must NOT be awaited before responding. Awaiting an outbound
    // provider round-trip only on the registered-address branch makes the
    // response measurably slower for addresses that have accounts — a timing
    // oracle that gives back exactly what the identical response body is
    // there to hide. waitUntil keeps the serverless instance alive until the
    // send settles (the same primitive lib/observability/margin-meter.ts uses),
    // so the effect is still real and its failure still logged; it simply
    // stops happening on the clock the caller can measure.
    const send = sendEmail({ to: email, subject, html, text, stage: "password_reset" }).then(
      (result) => {
        if (!result.delivered) {
          console.error(
            "[auth/forgot-password] reset email not delivered:",
            result.error ?? (result.dryRun ? "dry-run" : "unknown"),
          );
        }
      },
      (err) => {
        console.error("[auth/forgot-password] reset email threw:", err);
      },
    );
    waitUntil(send);
  }

  return NextResponse.json(NEUTRAL_OK, { status: 200 });
}
