// Auth sign-in error classification (G4 — user-enumeration hardening + G3 error
// hygiene on the client surface).
//
// The login form used to render Supabase's raw `error.message`. Two problems:
//
//  1. ENUMERATION. Supabase distinguishes "Invalid login credentials" (wrong
//     password OR no such account) from "Email not confirmed" (the account
//     EXISTS but is unverified). Showing those two verbatim tells an attacker
//     which addresses are registered — the exact leak `signup-errors.ts` closes
//     on the signup side. Signup currently auto-confirms (no email pipeline),
//     but PENDING_OPS keeps re-enabling verification on the table, and an
//     admin-created or legacy unconfirmed user hits it today.
//  2. HYGIENE. Provider phrasing ("For security purposes, you can only request
//     this after 33 seconds", "Database error querying schema") is internal
//     detail, not a message a user can act on.
//
// So every failure collapses into one of four neutral, actionable messages, and
// everything that could betray whether an address is registered shares ONE of
// them — see the credential bucket's own note for the membership rule.

/** Shape of the relevant fields on a Supabase AuthError (kept minimal/local). */
export interface LoginErrorLike {
  message?: string;
  code?: string;
  status?: number;
  name?: string;
}

// Anything that means "those credentials don't get you in" — never split apart.
//
// The membership rule is NOT "is this about a password". It is: could this
// outcome fire ONLY for an address that already has an account? Every such code
// is an existence oracle if it gets its own message, so they all land in this
// one bucket. `user_banned` and `user_sso_managed` are the non-obvious members —
// GoTrue returns them only for a REGISTERED address, so letting either fall
// through to the generic message would let an attacker separate "this email is
// registered" from "unknown or wrong password" without ever guessing a password.
//
// Erring INTO this bucket is safe (the cost is a slightly less precise message);
// erring out of it reopens the leak. When in doubt, add the code here.
// Exported so the mobile duplicate (mobile/src/lib/auth/auth-errors.ts) can be
// asserted set-equal to this one. Behavioural fixtures only catch drift on
// codes someone thought to add a fixture for; a new code added to one module
// and not the other is exactly the case that needs catching, and only direct
// set comparison catches it.
export const CREDENTIAL_CODES = new Set([
  "invalid_credentials",
  "email_not_confirmed",
  "user_not_found",
  "phone_not_confirmed",
  "user_banned",
  "user_sso_managed",
]);
// Fallback for a codeless response (older/self-hosted GoTrue). Bare "sso" is
// deliberate and not redundant with "single sign-on": GoTrue's actual text is
// "Only a SSO authentication method is allowed for this user", which contains
// neither the spelled-out phrase nor "sso-managed". A loose match here can only
// ever pull an error INTO the neutral bucket, never let one out of it.
const CREDENTIAL_PATTERNS = [
  "invalid login credentials",
  "email not confirmed",
  "invalid credentials",
  "user not found",
  "banned",
  "single sign-on",
  "sso",
];

/** Too many attempts — the one case where telling the user to wait is useful. */
const RATE_LIMIT_CODES = new Set(["over_request_rate_limit", "over_email_send_rate_limit"]);
const RATE_LIMIT_PATTERNS = ["rate limit", "too many requests", "for security purposes"];

/** The request never reached a verdict (offline, DNS, 5xx, our own timeout). */
const NETWORK_PATTERNS = ["failed to fetch", "network", "load failed", "timed out", "timeout"];

export const LOGIN_ERROR_CREDENTIALS =
  "That email and password don't match an account.";
export const LOGIN_ERROR_RATE_LIMITED =
  "Too many sign-in attempts. Please wait a moment and try again.";
export const LOGIN_ERROR_NETWORK =
  "We couldn't reach the server. Check your connection and try again.";
export const LOGIN_ERROR_GENERIC =
  "Something went wrong signing you in. Please try again.";

function matches(error: LoginErrorLike, codes: Set<string>, patterns: string[]): boolean {
  if (error.code && codes.has(error.code.toLowerCase())) return true;
  const msg = (error.message ?? "").toLowerCase();
  return patterns.some((p) => msg.includes(p));
}

/**
 * Map a sign-in failure to a safe user-facing message. NEVER returns provider
 * text, so no caller can leak it by accident. Ordered credentials → rate limit →
 * network → generic: the credential bucket wins first so a wording change on the
 * provider side can't reclassify an enumeration-sensitive error into a chattier
 * bucket.
 */
export function loginErrorMessage(error: LoginErrorLike | null | undefined): string {
  if (!error) return LOGIN_ERROR_GENERIC;
  if (matches(error, CREDENTIAL_CODES, CREDENTIAL_PATTERNS)) return LOGIN_ERROR_CREDENTIALS;
  if (error.status === 429 || matches(error, RATE_LIMIT_CODES, RATE_LIMIT_PATTERNS)) {
    return LOGIN_ERROR_RATE_LIMITED;
  }
  // AuthRetryableFetchError is what supabase-js returns for an unreachable or
  // 502/503/504 auth endpoint; status 0 is its "never got a response" marker.
  if (
    error.name === "AuthRetryableFetchError" ||
    error.status === 0 ||
    (typeof error.status === "number" && error.status >= 500) ||
    matches(error, new Set<string>(), NETWORK_PATTERNS)
  ) {
    return LOGIN_ERROR_NETWORK;
  }
  return LOGIN_ERROR_GENERIC;
}
