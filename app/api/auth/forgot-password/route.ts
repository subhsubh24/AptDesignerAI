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

// ─── Per-RECIPIENT MINT COOLDOWN ────────────────────────────────────────────
//
// GoTrue stores exactly ONE `recovery_token` per user (verified against the
// GoTrue source: `generateLink({type:"recovery"})` runs
// `user.RecoveryToken = hashedToken` unconditionally, and `CreateOneTimeToken`
// deletes the prior one-time-token row before inserting the new one). So EVERY
// successful mint invalidates whatever link is already sitting in the victim's
// inbox — a live denial-of-recovery bug this route must not let a caller
// trigger repeatedly (#712): mint once for an address, mail it, then refuse to
// mint again for that address until the window elapses.
//
// This used to be phrased as a "quota" (MAX_SENDS_PER_EMAIL = 3) — i.e. up to
// three successful mint+send cycles per address per window. That was the wrong
// shape: each of those three sends calls `generateLink` again and overwrites
// the token the previous send just mailed, so a caller making 2-3 requests in
// quick succession (attacker or otherwise) reliably kills their own most
// recent link. A COOLDOWN — at most ONE mint per address per window — is what
// actually protects the token: the first request in a window mints and mails a
// link that then stays valid (never overwritten) for the rest of the window,
// no matter how many further requests arrive for that address, from anyone.
// The link genuinely helps the account owner because generateLink always mails
// the real owner's inbox regardless of who triggered the request.
//
// A cooldown does NOT have the "quota is a denial-of-recovery weapon" failure
// mode an exhaustible-by-few-requests quota has: exhausting it here doesn't
// leave the owner without a link — it means a valid, un-overwritten link is
// already in their inbox. Requests beyond the first are a no-op, not a loss.
//
// ENUMERATION SAFETY — the property this must not break. Being on cooldown
// returns the SAME `{ ok: true }` 200 as any other request; it never 429s. A
// 429 here would be an oracle in itself (it would confirm someone else recently
// requested a reset for that address, which is a signal about the address). The
// suppressed request simply mints and sends nothing.
//
// THE SLOT IS CONSUMED ON THE MINT ATTEMPT, NOT ON DELIVERY — and this is
// deliberately different from an earlier revision of this file, which released
// the slot whenever nothing was delivered (unknown address, provider decline,
// no token, a throw, or an undelivered send). That release existed to protect
// the account owner from a run of failures burning the window — but it created
// an EXPLOITABLE TIMING ORACLE, caught in review: `generateLink` always runs
// (and costs a real network round-trip) on the FIRST request for any address,
// registered or not, so request 1 looks identical either way. But an
// unregistered address's `generateLink` call always ERRORS, which released the
// slot every time — so request 2+ for a nonexistent address kept taking the
// slow path forever, while request 2+ for a REAL, successfully-delivered
// address was suppressed and fast. Two requests, a stopwatch, no guessing:
// fast second response ⇒ the account exists. That is precisely the existence
// oracle property (2) at the top of this file exists to prevent, and it is a
// real, cheap, two-request probe — not a theoretical one.
//
// The fix is to make request 2+ behave IDENTICALLY (fast, no `generateLink`
// call) regardless of whether request 1 succeeded, errored, or the send later
// failed to deliver. So the slot is consumed the moment a mint is ATTEMPTED —
// see the single `claimEmailSend` call site below, before the `generateLink`
// try/catch — and nothing later ever gives it back. This closes the oracle
// completely: after request 1 (always slow, for any address), every later
// request in the window is fast, for any address, real or not.
//
// THE COST OF CLOSING IT, stated rather than hidden: a real user whose OWN
// mint attempt fails for a reason that isn't their fault (a transient
// `generateLink`/provider outage, not "no such account") cannot get a fresh
// mint for the rest of the window — up to 15 minutes — because there is no
// signal this route can use to distinguish "that failure was transient, give
// them another try" from "that address doesn't exist, don't leak it" without
// reopening the exact oracle above (the two cases would need to behave
// differently on request 2, and that difference IS the leak). This is a
// narrower, DIFFERENT tradeoff than the "quota burned by an attacker" fear
// the per-recipient control exists to avoid in the first place: it is not
// attacker-triggerable (an attacker cannot make Resend's API fail for an
// address they don't control), it requires an actual transient failure (rare),
// and it is bounded and self-healing (`EXPIRES the per-recipient cooldown`
// below pins that bound). Between "a rare, bounded, self-healing retry delay"
// and "a cheap, reliable way to learn which emails have accounts," the latter
// is the worse failure for this route to ship, so that is the tradeoff made
// here.
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
// like the sibling public routes; swap for Upstash if scaled out"). A
// distributed attacker is also the load pattern that makes Vercel spin up more
// function instances, each with an empty Map, so the cooldown is enforced
// per-instance rather than globally. A shared store (PENDING_OPS
// `rate-limit-redis`) is what would close that outright; until then this still
// closes the single/low-concurrency overwrite case fully, which is the live
// bug (#712) this exists to fix.
//
// WHAT "ON COOLDOWN" GUARANTEES NOW. Weaker than before, and stated precisely:
// being on cooldown means a mint was ATTEMPTED for this address in the last 15
// minutes — NOT that mail was necessarily delivered. For the common case
// (attempt succeeds, mail sends) this is the same real guarantee as before: a
// recovery link reached the owner's own inbox regardless of who asked for it.
// Whether that link is still VALID when the owner checks depends on the
// Supabase project's OTP expiry — an owner-controlled dashboard setting this
// codebase never reads (see PENDING_OPS `verify-otp-expiry-vs-reset-quota`).
// If that expiry is ever configured at or below 15 minutes, RATE_WINDOW_MS
// (the shared cooldown window below) must shrink to match.
const RESET_COOLDOWN_MAX_MINTS = 1;
const emailBucket = new Map<string, { count: number; resetAt: number }>();

function emailQuotaKey(email: string): string {
  return crypto.createHash("sha256").update(email).digest("hex");
}

/**
 * Claim the mint slot for this address. Returns false when the address is
 * already on cooldown for the current window — the caller must then mint
 * nothing (so the already-mailed token is never overwritten) and still return
 * the neutral body. The slot is never given back once claimed, regardless of
 * what happens next — see the ENUMERATION SAFETY note above for why.
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
  if (entry.count >= RESET_COOLDOWN_MAX_MINTS) return false;
  entry.count++;
  return true;
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

  // Per-recipient mint cooldown (#712). Placed AFTER the neutral-body point
  // and BEFORE any mint/send, so a request on cooldown costs no generateLink
  // round-trip and is indistinguishable from a delivered one to the caller
  // except for the known, accepted residual timing signal documented above.
  // Deliberately not a 429 — see the emailBucket note above.
  if (!claimEmailSend(email)) {
    console.warn(
      "[auth/forgot-password] address is on the reset mint cooldown; suppressing " +
        "this mint so the already-mailed token is not overwritten (the caller " +
        "still gets the neutral body)",
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

  // If resetUrl stayed null — unknown address, provider declined, no token, or
  // a throw — the mint slot claimed above is intentionally NOT given back: see
  // "THE SLOT IS CONSUMED ON THE MINT ATTEMPT, NOT ON DELIVERY" above
  // `claimEmailSend` for why releasing it here used to make this route a
  // two-request account-existence timing oracle.

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
    //
    // The mint slot is likewise NOT released if `delivered` comes back false
    // here — same reasoning as above, and the same call is the reason this
    // path used to look different (slow vs. fast on request 2) depending on
    // whether the address existed.
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
