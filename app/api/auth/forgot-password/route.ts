import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { getAdminClient } from "@/lib/supabase/admin";
import { verifyTurnstile } from "@/lib/security/turnstile";
import { sendEmail, isEmailDryRun } from "@/lib/email";
import { buildPasswordResetEmail } from "@/lib/email/templates/password-reset";
import { rateLimitBypassedForTest } from "@/lib/utils/rate-limiter";

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

// ─── Per-RECIPIENT quota ─────────────────────────────────────────────────────
//
// The per-IP limit above stops one host spamming; it does nothing about the
// abuse case it is most often mistaken for. An attacker with a botnet, a proxy
// pool, or plain IPv6 rotation gets a FRESH 3-request budget per address they
// come from, all aimed at ONE victim's inbox. Nobody's account is compromised —
// the harm is that the victim's mailbox is buried and, worse, that a real reset
// link arrives amid dozens of identical ones, which is how reset-flood phishing
// gets its cover.
//
// So the outbound side is capped too: at most MAX_SENDS_PER_EMAIL reset mails
// per address per window, no matter how many hosts ask.
//
// ENUMERATION SAFETY — the property this must not break. Being over quota
// returns the SAME `{ ok: true }` 200 as any other request; it never 429s. A
// 429 here would be an oracle in itself (it would confirm someone else recently
// requested a reset for that address, which is a signal about the address). The
// suppressed request simply mints and sends nothing.
//
// The key is a SHA-256 of the normalised address, not the address: this Map
// outlives the request, and a long-lived in-memory list of everyone who forgot
// their password is not something to keep in plaintext for no benefit. It is
// obfuscation, NOT secrecy — the input space is small enough that a known
// address is trivially confirmed against a hash. The point is only that the
// process does not sit on a plaintext list.
//
// SCOPE — the caveat that matters, stated because it undercuts the headline.
// This is per-INSTANCE memory, exactly like the `ipBucket` above ("In-memory,
// like the sibling public routes; swap for Upstash if scaled out"). A genuinely
// distributed attacker is also the load pattern that makes Vercel spin up more
// function instances, each with an empty Map — so the real ceiling is
// MAX_SENDS_PER_EMAIL x (warm instances), not 3. That means this closes the
// single/low-concurrency case fully and the fully-distributed case only
// PARTIALLY. It still cuts the flood by orders of magnitude versus no
// per-recipient cap at all, and a shared store (PENDING_OPS `rate-limit-redis`)
// is what would close it outright.
//
// WHY THIS IS NOT A DENIAL OF SERVICE ON THE ACCOUNT OWNER — the objection two
// reviewers raised, and the constraint that shapes the implementation.
//
// The fear is real in the obvious design: an attacker who knows a victim's
// address burns the quota, and the victim's own reset is then silently
// swallowed while the UI says "check your inbox" — breaking priority (1) at the
// top of this file for the one user who actually needs the link.
//
// What makes it not a denial is that a claim is RELEASED whenever no mail
// actually went out. So the quota only ever counts messages genuinely delivered
// to that address, which means being over quota carries a real guarantee: three
// recovery links for this address were ACCEPTED BY THE PROVIDER in the last 15
// minutes, addressed to the owner's own inbox regardless of who asked for them.
// So "check your email" is not a fake success.
//
// TWO LIMITS ON THAT GUARANTEE, stated rather than glossed. (1) `delivered`
// means Resend returned 200, not that the message cleared the recipient's spam
// filter. (2) Whether an earlier link is still VALID when the owner asks depends
// on the Supabase project's OTP expiry — an owner-controlled dashboard setting
// this codebase never reads, so no claim is made about it here. If that expiry
// is ever configured at or below 15 minutes, MAX_SENDS_PER_EMAIL should move
// below it; PENDING_OPS carries that as an owner verification step.
//
// Without the release this would be exactly the DoS described: three failed
// `generateLink` calls would burn the quota having delivered nothing, and the
// owner's fourth request would be suppressed with an empty inbox.
//
// The residual is small and bounded: an owner who deleted the earlier mails as
// suspicious waits out the window. `EXPIRES the per-recipient lockout` pins that
// bound so nobody can quietly widen it.
const MAX_SENDS_PER_EMAIL = 3;
const emailBucket = new Map<string, { count: number; resetAt: number }>();

function emailQuotaKey(email: string): string {
  return crypto.createHash("sha256").update(email).digest("hex");
}

/**
 * Claim one send for this address. Returns false when the address is already at
 * its quota for the current window — the caller must then do nothing and still
 * return the neutral body.
 */
function claimEmailSend(email: string): boolean {
  if (rateLimitBypassedForTest()) return true; // CI journey suite only
  const now = Date.now();
  const key = emailQuotaKey(email);
  const entry = emailBucket.get(key);
  if (!entry || now >= entry.resetAt) {
    emailBucket.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= MAX_SENDS_PER_EMAIL) return false;
  entry.count++;
  return true;
}

/**
 * Give a claim back. Called on every path where the claim did NOT result in a
 * delivered message, so the quota counts real mail rather than attempts — see
 * the note above for why that is what keeps this from denying the account
 * owner their own recovery.
 */
function releaseEmailSend(email: string): void {
  const entry = emailBucket.get(emailQuotaKey(email));
  if (entry && entry.count > 0) entry.count--;
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

  // Per-recipient quota. Placed AFTER the neutral-body point and BEFORE any
  // mint/send, so an over-quota request costs nothing upstream and is
  // indistinguishable from a delivered one to the caller. Deliberately not a
  // 429 — see the emailBucket note above.
  if (!claimEmailSend(email)) {
    console.warn(
      "[auth/forgot-password] per-recipient reset quota reached; suppressing send " +
        "(the caller still gets the neutral body)",
    );
    return NextResponse.json(NEUTRAL_OK, { status: 200 });
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

  if (!resetUrl) {
    // Nothing will be mailed — unknown address, provider declined, no token, or
    // a throw. Give the claim back so a run of failures cannot burn the quota
    // and leave the real owner suppressed with an empty inbox.
    releaseEmailSend(email);
  }

  if (resetUrl) {
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
          // The claim bought a message that never arrived — hand it back, or the
          // owner's next attempt is suppressed against an inbox with nothing in
          // it. This is the same claim-then-release shape the lifecycle crons use.
          releaseEmailSend(email);
          console.error(
            "[auth/forgot-password] reset email not delivered:",
            result.error ?? (result.dryRun ? "dry-run" : "unknown"),
          );
        }
      },
      (err) => {
        releaseEmailSend(email);
        console.error("[auth/forgot-password] reset email threw:", err);
      },
    );
    waitUntil(send);
  }

  return NextResponse.json(NEUTRAL_OK, { status: 200 });
}
