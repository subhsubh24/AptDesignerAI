// Auth signup error classification (G4 — user-enumeration hardening).
//
// Supabase's signUp can, depending on project config, return an explicit
// "user already registered" error. Surfacing that verbatim lets an attacker
// enumerate which emails have accounts. We classify it here so the UI can mask
// it to the same neutral "check your email" state a brand-new signup shows —
// making "this email is taken" and "this email is new" indistinguishable.

/** Shape of the relevant fields on a Supabase AuthError (kept minimal/local). */
export interface SignupErrorLike {
  message?: string;
  code?: string;
  status?: number;
}

// Codes/messages Supabase uses for an already-registered address. Matched
// loosely (case-insensitive substring) so a wording change doesn't reopen the
// leak; the cost of a false positive is only that a genuine new signup with an
// unrelated error is shown the neutral confirm screen — never a data leak.
const ALREADY_REGISTERED_CODES = new Set(["user_already_exists", "email_exists"]);
const ALREADY_REGISTERED_PATTERNS = [
  "already registered",
  "already exists",
  "already been registered",
];

/**
 * True when a signUp error indicates the email already has an account.
 * Callers should treat a true result as "show the neutral confirmation screen",
 * never as a distinct user-facing message.
 */
export function isAlreadyRegisteredError(error: SignupErrorLike | null | undefined): boolean {
  if (!error) return false;
  if (error.code && ALREADY_REGISTERED_CODES.has(error.code.toLowerCase())) return true;
  const msg = (error.message ?? "").toLowerCase();
  return ALREADY_REGISTERED_PATTERNS.some((p) => msg.includes(p));
}

/**
 * Whether a successful signUp response represents a genuinely NEW user.
 * Supabase obscures an existing (confirmed) address by returning no error and a
 * user with an empty `identities` array; only fire the signup funnel event when
 * a real new identity was created.
 */
export function isNewUserSignup(identitiesLength: number | undefined): boolean {
  return (identitiesLength ?? 0) > 0;
}
