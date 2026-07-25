// Auth error classification for the native app (G4 — user-enumeration
// hardening + error hygiene), the mobile half of `lib/auth/login-errors.ts`.
//
// Both auth screens used to render Supabase's raw `error.message`. Supabase
// distinguishes "Invalid login credentials" (wrong password OR no such account)
// from "Email not confirmed" (the account EXISTS but is unverified), and
// answers a sign-up on a taken address with "User already registered" — each of
// those tells an attacker which addresses have accounts, using nothing but the
// public UI.
//
// DELIBERATE DUPLICATE, not an oversight: the web module lives outside the Expo
// app's module graph (mobile/tsconfig.json maps `@/*` to ./src/* only, and
// Metro does not resolve out of the app root into the Next.js tree), so it
// cannot be imported here. `__tests__/auth/mobile-auth-errors.test.ts` feeds the
// SAME fixtures to both modules and asserts they bucket identically, so the two
// cannot drift apart silently — change one, that test fails until you change
// the other.

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
export const CREDENTIAL_CODES = new Set([
  'invalid_credentials',
  'email_not_confirmed',
  'user_not_found',
  'phone_not_confirmed',
  'user_banned',
  'user_sso_managed',
]);

// Fallback for a codeless response (older/self-hosted GoTrue). Bare "sso" is
// deliberate: GoTrue's actual text is "Only a SSO authentication method is
// allowed for this user", which contains neither "single sign-on" nor
// "sso-managed". A loose match can only pull an error INTO the neutral bucket.
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

// An address that already has an account. Callers must NOT render a distinct
// message for this: it is the signup-side existence oracle. The screens use it
// to take the same path a brand-new signup takes (attempt sign-in), so a taken
// address with the right password is indistinguishable from a new one — the
// contract lib/auth/signup-errors.ts states on the web side.
const ACCOUNT_EXISTS_CODES = new Set(['user_already_exists', 'email_exists']);
const ACCOUNT_EXISTS_PATTERNS = ['already registered', 'already exists', 'already been registered'];

/** A password the provider itself refuses — safe to say, reveals nothing. */
const WEAK_PASSWORD_CODES = new Set(['weak_password']);
const WEAK_PASSWORD_PATTERNS = ['password should be', 'password is too weak', 'weak password'];

export const AUTH_ERROR_CREDENTIALS = "That email and password don't match an account.";
export const AUTH_ERROR_RATE_LIMITED =
  'Too many attempts. Please wait a moment and try again.';
export const AUTH_ERROR_NETWORK =
  "We couldn't reach the server. Check your connection and try again.";
export const AUTH_ERROR_SIGN_IN_GENERIC =
  'Something went wrong signing you in. Please try again.';
export const AUTH_ERROR_WEAK_PASSWORD = 'Please choose a longer, less common password.';
// Shown for EVERY sign-up failure that is not weak-password / rate-limit /
// network — including an address that is already registered. The sign-in hint
// is generic advice offered on every failure, so it never asserts anything
// about the address that was typed.
export const AUTH_ERROR_SIGN_UP_GENERIC =
  "We couldn't create that account. If you already have one, try signing in instead.";

function matches(error: AuthErrorLike, codes: Set<string>, patterns: string[]): boolean {
  if (error.code && codes.has(error.code.toLowerCase())) return true;
  const msg = (error.message ?? '').toLowerCase();
  return patterns.some((p) => msg.includes(p));
}

function isRateLimited(error: AuthErrorLike): boolean {
  return error.status === 429 || matches(error, RATE_LIMIT_CODES, RATE_LIMIT_PATTERNS);
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

/**
 * Map a SIGN-IN failure to a safe user-facing message. Never returns provider
 * text. Ordered credentials → rate limit → network → generic: the credential
 * bucket wins first so a wording change upstream can't reclassify an
 * enumeration-sensitive error into a chattier bucket.
 */
export function signInErrorMessage(error: AuthErrorLike | null | undefined): string {
  if (!error) return AUTH_ERROR_SIGN_IN_GENERIC;
  if (matches(error, CREDENTIAL_CODES, CREDENTIAL_PATTERNS)) return AUTH_ERROR_CREDENTIALS;
  if (isRateLimited(error)) return AUTH_ERROR_RATE_LIMITED;
  if (isNetwork(error)) return AUTH_ERROR_NETWORK;
  return AUTH_ERROR_SIGN_IN_GENERIC;
}

/**
 * True when a signUp failure means the address already has an account.
 *
 * Never use this to pick a MESSAGE — that would rebuild the oracle this module
 * removes. Its only legitimate use is to route the flow down the same path a
 * new signup takes, so the two are indistinguishable on screen as well as in
 * text (an error box appearing at all is itself a signal).
 */
export function isAccountExistsError(error: AuthErrorLike | null | undefined): boolean {
  if (!error) return false;
  return matches(error, ACCOUNT_EXISTS_CODES, ACCOUNT_EXISTS_PATTERNS);
}

/**
 * Map a SIGN-UP failure to a safe user-facing message.
 *
 * "User already registered" deliberately has NO message of its own — it falls
 * to the generic bucket, so a taken address and a rejected-for-any-other-reason
 * address are indistinguishable. Weak-password is split out because the
 * provider is describing the password the user just typed, not the account.
 */
export function signUpErrorMessage(error: AuthErrorLike | null | undefined): string {
  if (!error) return AUTH_ERROR_SIGN_UP_GENERIC;
  if (matches(error, WEAK_PASSWORD_CODES, WEAK_PASSWORD_PATTERNS)) {
    return AUTH_ERROR_WEAK_PASSWORD;
  }
  if (isRateLimited(error)) return AUTH_ERROR_RATE_LIMITED;
  if (isNetwork(error)) return AUTH_ERROR_NETWORK;
  return AUTH_ERROR_SIGN_UP_GENERIC;
}
