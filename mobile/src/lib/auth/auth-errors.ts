// Auth error classification for the native app (G4 — user-enumeration hardening).
//
// Both native auth screens rendered Supabase's raw `error.message`, which leaks
// WHICH email addresses have accounts:
//
//  - SIGN IN: GoTrue distinguishes "Invalid login credentials" (wrong password
//    OR no such account) from "Email not confirmed" / `user_banned` /
//    `user_sso_managed` — each of which can only fire for an address that
//    ALREADY has an account. Showing them verbatim separates "registered" from
//    "unknown" without ever guessing a password.
//  - SIGN UP: "User already registered" says so outright.
//
// The web app closed exactly this leak in `lib/auth/login-errors.ts` and
// `lib/auth/signup-errors.ts`. This is a deliberate NATIVE MIRROR of those two
// modules rather than an import: /mobile is a separate Expo package whose
// tsconfig maps `@/*` to `./src/*`, so the web modules are outside Metro's
// resolution root — wiring a cross-package alias into the Metro resolver to
// share ~100 lines is a bundler change that cannot be verified from CI's
// typecheck alone, and a broken resolver breaks the whole app rather than one
// screen. The code lists below are kept IDENTICAL to the web modules on purpose;
// when either side gains a code, diff the two files and add it to both.

/** Shape of the relevant fields on a Supabase AuthError (kept minimal/local). */
export interface AuthErrorLike {
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
// GoTrue returns them only for a REGISTERED address.
//
// Erring INTO this bucket is safe (the cost is a slightly less precise message);
// erring out of it reopens the leak. When in doubt, add the code here.
const CREDENTIAL_CODES = new Set([
  'invalid_credentials',
  'email_not_confirmed',
  'user_not_found',
  'phone_not_confirmed',
  'user_banned',
  'user_sso_managed',
]);
// Fallback for a codeless response (older/self-hosted GoTrue). Bare "sso" is
// deliberate and not redundant with "single sign-on": GoTrue's actual text is
// "Only a SSO authentication method is allowed for this user", which contains
// neither the spelled-out phrase nor "sso-managed". A loose match here can only
// ever pull an error INTO the neutral bucket, never let one out of it.
const CREDENTIAL_PATTERNS = [
  'invalid login credentials',
  'email not confirmed',
  'invalid credentials',
  'user not found',
  'banned',
  'single sign-on',
  'sso',
];

/** Too many attempts — the one case where telling the user to wait is useful. */
const RATE_LIMIT_CODES = new Set(['over_request_rate_limit', 'over_email_send_rate_limit']);
const RATE_LIMIT_PATTERNS = ['rate limit', 'too many requests', 'for security purposes'];

/** The request never reached a verdict (offline, DNS, 5xx, our own timeout). */
const NETWORK_PATTERNS = ['failed to fetch', 'network', 'load failed', 'timed out', 'timeout'];

export const AUTH_ERROR_CREDENTIALS = "That email and password don't match an account.";
export const AUTH_ERROR_RATE_LIMITED =
  'Too many sign-in attempts. Please wait a moment and try again.';
export const AUTH_ERROR_NETWORK =
  "We couldn't reach the server. Check your connection and try again.";
export const AUTH_ERROR_GENERIC = 'Something went wrong signing you in. Please try again.';
export const AUTH_ERROR_SIGNUP_GENERIC =
  "We couldn't create your account. Please try again.";

function matches(error: AuthErrorLike, codes: Set<string>, patterns: string[]): boolean {
  if (error.code && codes.has(error.code.toLowerCase())) return true;
  const msg = (error.message ?? '').toLowerCase();
  return patterns.some((p) => msg.includes(p));
}

function isRateLimited(error: AuthErrorLike): boolean {
  return error.status === 429 || matches(error, RATE_LIMIT_CODES, RATE_LIMIT_PATTERNS);
}

function isNetworkFailure(error: AuthErrorLike): boolean {
  // AuthRetryableFetchError is what supabase-js returns for an unreachable or
  // 502/503/504 auth endpoint; status 0 is its "never got a response" marker.
  return (
    error.name === 'AuthRetryableFetchError' ||
    error.status === 0 ||
    (typeof error.status === 'number' && error.status >= 500) ||
    matches(error, new Set<string>(), NETWORK_PATTERNS)
  );
}

/**
 * Map a SIGN-IN failure to a safe user-facing message. NEVER returns provider
 * text, so no caller can leak it by accident. Ordered credentials → rate limit →
 * network → generic: the credential bucket wins first so a wording change on the
 * provider side can't reclassify an enumeration-sensitive error into a chattier
 * bucket.
 */
export function signInErrorMessage(error: AuthErrorLike | null | undefined): string {
  if (!error) return AUTH_ERROR_GENERIC;
  if (matches(error, CREDENTIAL_CODES, CREDENTIAL_PATTERNS)) return AUTH_ERROR_CREDENTIALS;
  if (isRateLimited(error)) return AUTH_ERROR_RATE_LIMITED;
  if (isNetworkFailure(error)) return AUTH_ERROR_NETWORK;
  return AUTH_ERROR_GENERIC;
}

// Codes/messages Supabase uses for an already-registered address. Matched
// loosely (case-insensitive substring) so a wording change doesn't reopen the
// leak; a false positive only shows a genuine new signup the neutral confirm
// screen — never a data leak.
const ALREADY_REGISTERED_CODES = new Set(['user_already_exists', 'email_exists']);
const ALREADY_REGISTERED_PATTERNS = [
  'already registered',
  'already exists',
  'already been registered',
];

/**
 * True when a signUp error indicates the email already has an account. Callers
 * MUST treat a true result as "show the neutral confirmation screen", never as a
 * distinct user-facing message — that is what makes "this email is taken" and
 * "this email is new" indistinguishable to an attacker.
 */
export function isAlreadyRegisteredError(error: AuthErrorLike | null | undefined): boolean {
  if (!error) return false;
  if (error.code && ALREADY_REGISTERED_CODES.has(error.code.toLowerCase())) return true;
  const msg = (error.message ?? '').toLowerCase();
  return ALREADY_REGISTERED_PATTERNS.some((p) => msg.includes(p));
}

/**
 * Map a SIGN-UP failure to a safe user-facing message. Only call this once
 * `isAlreadyRegisteredError` has been checked — an already-registered address
 * must reach the neutral confirmation screen, not any error message at all.
 * Rate-limit and network failures stay actionable; everything else collapses.
 */
export function signUpErrorMessage(error: AuthErrorLike | null | undefined): string {
  if (!error) return AUTH_ERROR_SIGNUP_GENERIC;
  if (isRateLimited(error)) return AUTH_ERROR_RATE_LIMITED;
  if (isNetworkFailure(error)) return AUTH_ERROR_NETWORK;
  return AUTH_ERROR_SIGNUP_GENERIC;
}
