// Auth error classification for the native app (G4 — user-enumeration
// hardening + error hygiene on the client surface).
//
// The login and signup screens used to render Supabase's raw `error.message`.
// Two problems, identical to the ones closed on web:
//
//  1. ENUMERATION. GoTrue distinguishes "Invalid login credentials" (wrong
//     password OR no such account) from "Email not confirmed" (the account
//     EXISTS but is unverified), and signUp can answer "User already
//     registered" outright. Rendering those verbatim tells an attacker which
//     addresses have accounts — without ever guessing a password.
//  2. HYGIENE. Provider phrasing ("For security purposes, you can only request
//     this after 33 seconds", "Database error querying schema") is internal
//     detail, not something a user can act on.
//
// This is a deliberate PORT of `lib/auth/login-errors.ts` +
// `lib/auth/signup-errors.ts`, not an import: the Expo app has its own
// tsconfig/bundler and cannot resolve the Next.js `lib/` tree. Kept dependency-
// free so it stays a plain data transform that both toolchains compile
// identically. If the web classification changes, change this too — the shared
// regression tests in `__tests__/auth/mobile-auth-errors.test.ts` assert the
// two surfaces agree on the enumeration-sensitive codes.

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
// Erring INTO this bucket is safe (the cost is a slightly less precise
// message); erring out of it reopens the leak. When in doubt, add the code here.
const CREDENTIAL_CODES = new Set([
  'invalid_credentials',
  'email_not_confirmed',
  'user_not_found',
  'phone_not_confirmed',
  'user_banned',
  'user_sso_managed',
]);
// Fallback for a codeless response (older/self-hosted GoTrue). Bare 'sso' is
// deliberate and not redundant with 'single sign-on': GoTrue's actual text is
// "Only a SSO authentication method is allowed for this user", which contains
// neither the spelled-out phrase nor 'sso-managed'. A loose match here can only
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

// Codes/messages GoTrue uses for an already-registered address. Matched loosely
// so a wording change doesn't reopen the leak; a false positive only means a
// genuine new signup with an unrelated error sees the neutral confirm screen.
const ALREADY_REGISTERED_CODES = new Set(['user_already_exists', 'email_exists']);
const ALREADY_REGISTERED_PATTERNS = [
  'already registered',
  'already exists',
  'already been registered',
];

export const AUTH_ERROR_CREDENTIALS = "That email and password don't match an account.";
export const AUTH_ERROR_RATE_LIMITED =
  'Too many attempts. Please wait a moment and try again.';
export const AUTH_ERROR_NETWORK =
  "We couldn't reach the server. Check your connection and try again.";
export const AUTH_ERROR_SIGN_IN_GENERIC =
  'Something went wrong signing you in. Please try again.';
export const AUTH_ERROR_SIGN_UP_GENERIC =
  'Something went wrong creating your account. Please try again.';

function matches(error: AuthErrorLike, codes: Set<string>, patterns: string[]): boolean {
  if (error.code && codes.has(error.code.toLowerCase())) return true;
  const msg = (error.message ?? '').toLowerCase();
  return patterns.some((p) => msg.includes(p));
}

function isRateLimited(error: AuthErrorLike): boolean {
  return error.status === 429 || matches(error, RATE_LIMIT_CODES, RATE_LIMIT_PATTERNS);
}

// AuthRetryableFetchError is what supabase-js returns for an unreachable or
// 502/503/504 auth endpoint; status 0 is its "never got a response" marker.
function isNetworkFailure(error: AuthErrorLike): boolean {
  return (
    error.name === 'AuthRetryableFetchError' ||
    error.status === 0 ||
    (typeof error.status === 'number' && error.status >= 500) ||
    matches(error, new Set<string>(), NETWORK_PATTERNS)
  );
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
  if (isNetworkFailure(error)) return AUTH_ERROR_NETWORK;
  return AUTH_ERROR_SIGN_IN_GENERIC;
}

/**
 * True when a signUp failure indicates the email already has an account.
 * Callers MUST treat a true result as "show the same neutral confirmation state
 * a brand-new signup shows", never as a distinct message — that equivalence is
 * what makes "this email is taken" and "this email is new" indistinguishable.
 * Mirrors the server route's enumeration-safe behaviour
 * (app/api/auth/signup/route.ts).
 */
export function isAlreadyRegisteredError(error: AuthErrorLike | null | undefined): boolean {
  if (!error) return false;
  if (error.code && ALREADY_REGISTERED_CODES.has(error.code.toLowerCase())) return true;
  const msg = (error.message ?? '').toLowerCase();
  return ALREADY_REGISTERED_PATTERNS.some((p) => msg.includes(p));
}

/**
 * Map a sign-up failure to a safe user-facing message. Only call this once
 * `isAlreadyRegisteredError` has returned false — an already-registered address
 * must reach the neutral confirmation screen, not any message at all.
 *
 * Password-strength ("weak_password") and malformed-address feedback stay
 * specific because neither reveals whether the address is registered: GoTrue
 * validates the submitted password/email before it ever looks the address up.
 */
export function signUpErrorMessage(error: AuthErrorLike | null | undefined): string {
  if (!error) return AUTH_ERROR_SIGN_UP_GENERIC;
  const code = error.code?.toLowerCase() ?? '';
  const msg = (error.message ?? '').toLowerCase();
  if (code === 'weak_password' || msg.includes('password should be at least')) {
    return 'Choose a stronger password — at least 8 characters.';
  }
  // GoTrue's real text is "Unable to validate email address: invalid format".
  // This is a FORMAT check on the submitted string, made before the address is
  // ever looked up, so it cannot reveal whether an account exists.
  if (
    code === 'email_address_invalid' ||
    msg.includes('invalid email') ||
    msg.includes('unable to validate email')
  ) {
    return 'Enter a valid email address.';
  }
  if (isRateLimited(error)) return AUTH_ERROR_RATE_LIMITED;
  if (isNetworkFailure(error)) return AUTH_ERROR_NETWORK;
  return AUTH_ERROR_SIGN_UP_GENERIC;
}
