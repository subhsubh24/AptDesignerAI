// Auth error classification for the Expo app (G4 — user-enumeration hardening,
// G3 — error-message hygiene).
//
// Both auth screens used to render Supabase's raw `error.message`. That leaks
// which addresses have accounts:
//
//   * SIGN-IN. GoTrue distinguishes "Invalid login credentials" (wrong password
//     OR no such account) from "Email not confirmed" (the account EXISTS but is
//     unverified). Rendered verbatim, the pair is an existence oracle.
//   * SIGN-UP. "User already registered" says outright that the address is
//     taken. The web signup route already masks this (see the enumeration-safe
//     branch in app/api/auth/signup/route.ts) — the mobile screen did not.
//
// Provider phrasing is also just bad copy ("Database error querying schema",
// "For security purposes, you can only request this after 33 seconds") — not
// something a user can act on.
//
// DELIBERATE DUPLICATE of lib/auth/login-errors.ts + lib/auth/signup-errors.ts.
// The Expo app is a separate TypeScript project (mobile/tsconfig.json maps only
// `@/* -> ./src/*`) and Metro does not resolve outside mobile/, so the web
// modules are not importable here. The classification is kept semantically
// identical on purpose; __tests__/auth/mobile-auth-errors.test.ts asserts the
// two code sets stay in sync so a future change to one surface cannot silently
// reopen the leak on the other.

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
// GoTrue returns them only for a REGISTERED address, so letting either fall
// through to the generic message would let an attacker separate "this email is
// registered" from "unknown or wrong password" without ever guessing a password.
//
// Erring INTO this bucket is safe (the cost is a slightly less precise message);
// erring out of it reopens the leak. When in doubt, add the code here.
export const CREDENTIAL_CODES = new Set([
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
export const CREDENTIAL_PATTERNS = [
  'invalid login credentials',
  'email not confirmed',
  'invalid credentials',
  'user not found',
  'banned',
  'single sign-on',
  'sso',
];

/** Too many attempts — the one case where telling the user to wait is useful. */
export const RATE_LIMIT_CODES = new Set(['over_request_rate_limit', 'over_email_send_rate_limit']);
export const RATE_LIMIT_PATTERNS = ['rate limit', 'too many requests', 'for security purposes'];

/** The request never reached a verdict (offline, DNS, 5xx, our own timeout). */
export const NETWORK_PATTERNS = ['failed to fetch', 'network', 'load failed', 'timed out', 'timeout'];

// An address that already has an account. Matched loosely (case-insensitive
// substring) so a wording change on the provider side doesn't reopen the leak;
// a false positive only routes a genuine new signup to the neutral confirmation
// screen, which is exactly where a real new signup goes anyway.
export const ALREADY_REGISTERED_CODES = new Set(['user_already_exists', 'email_exists']);
export const ALREADY_REGISTERED_PATTERNS = [
  'already registered',
  'already exists',
  'already been registered',
];

export const AUTH_ERROR_CREDENTIALS = "That email and password don't match an account.";
export const AUTH_ERROR_RATE_LIMITED = 'Too many attempts. Please wait a moment and try again.';
export const AUTH_ERROR_NETWORK =
  "We couldn't reach the server. Check your connection and try again.";
export const AUTH_ERROR_SIGN_IN_GENERIC = 'Something went wrong signing you in. Please try again.';
export const AUTH_ERROR_SIGN_UP_GENERIC =
  'Something went wrong creating your account. Please try again.';

function matches(error: AuthErrorLike, codes: Set<string>, patterns: string[]): boolean {
  const code = error.code;
  if (code && codes.has(code.toLowerCase())) return true;
  const msg = (error.message ?? '').toLowerCase();
  return patterns.some((p) => msg.includes(p));
}

function isNetwork(error: AuthErrorLike): boolean {
  // AuthRetryableFetchError is what supabase-js returns for an unreachable or
  // 502/503/504 auth endpoint; status 0 is its "never got a response" marker.
  return (
    error.name === 'AuthRetryableFetchError' ||
    error.status === 0 ||
    (typeof error.status === 'number' && error.status >= 500) ||
    matches(error, new Set<string>(), NETWORK_PATTERNS)
  );
}

function isRateLimited(error: AuthErrorLike): boolean {
  return error.status === 429 || matches(error, RATE_LIMIT_CODES, RATE_LIMIT_PATTERNS);
}

/**
 * True when a signUp failure means the address already has an account.
 *
 * Callers MUST treat a true result as "show the same neutral confirmation
 * screen a brand-new signup shows" — never as a distinct message, or the leak
 * is right back.
 */
export function isAlreadyRegisteredError(error: AuthErrorLike | null | undefined): boolean {
  if (!error) return false;
  return matches(error, ALREADY_REGISTERED_CODES, ALREADY_REGISTERED_PATTERNS);
}

/**
 * Map a sign-in failure to a safe user-facing message. NEVER returns provider
 * text, so no caller can leak it by accident. Ordered credentials → rate limit →
 * network → generic: the credential bucket wins first so a wording change on the
 * provider side can't reclassify an enumeration-sensitive error into a chattier
 * bucket.
 */
export function signInErrorMessage(error: AuthErrorLike | null | undefined): string {
  if (!error) return AUTH_ERROR_SIGN_IN_GENERIC;
  if (matches(error, CREDENTIAL_CODES, CREDENTIAL_PATTERNS)) return AUTH_ERROR_CREDENTIALS;
  if (isRateLimited(error)) return AUTH_ERROR_RATE_LIMITED;
  if (isNetwork(error)) return AUTH_ERROR_NETWORK;
  return AUTH_ERROR_SIGN_IN_GENERIC;
}

/**
 * Map a sign-up failure to a safe user-facing message.
 *
 * Only for errors the caller has ALREADY decided are not "already registered" —
 * check `isAlreadyRegisteredError` first and route that case to the neutral
 * confirmation screen. Rate-limit and network still get their own actionable
 * message: neither depends on whether the address exists, so neither leaks.
 */
export function signUpErrorMessage(error: AuthErrorLike | null | undefined): string {
  if (!error) return AUTH_ERROR_SIGN_UP_GENERIC;
  if (isRateLimited(error)) return AUTH_ERROR_RATE_LIMITED;
  if (isNetwork(error)) return AUTH_ERROR_NETWORK;
  return AUTH_ERROR_SIGN_UP_GENERIC;
}
