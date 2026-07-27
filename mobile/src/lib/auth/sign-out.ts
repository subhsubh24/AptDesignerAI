/**
 * Bounded sign-out (issue #698).
 *
 * `supabase.auth.signOut()` is a NETWORK call with no timeout of its own, and it
 * reports failure two different ways: an in-band `{ error }` and, on a transport
 * failure, a thrown rejection. Both of those were mishandled on the settings
 * screen:
 *
 *  - "Sign out" awaited it unbounded, so on a dead network the row stayed dead
 *    with no feedback until the platform's own socket timeout eventually fired.
 *  - "Delete account" awaited it INSIDE the delete `try`, AFTER the server had
 *    already confirmed the account was destroyed. A network drop in that window
 *    threw into the delete `catch`, which told the user "Unable to delete
 *    account… please try again" about an account that no longer existed, and
 *    skipped the `clearPendingSession()` that wipes the previous user's pending
 *    room photo on a shared device.
 *
 * One dead end worth recording, because it is the obvious thing to reach for:
 * `signOut({ scope: 'local' })` does NOT avoid the network. auth-js calls
 * `admin.signOut(accessToken, scope)` first whatever the scope, and on anything
 * other than a 401/403/404 it returns early without reaching `_removeSession()`
 * — so a local-scope sign-out on a broken network leaves the stored session
 * exactly where it was. A bound is the only control available here.
 *
 * This helper does one thing: turn all three outcomes (success, in-band error,
 * thrown rejection) plus a hung call into one value the caller can branch on.
 * It deliberately does not decide what the UI says — the two call sites need
 * different messages, because a failed sign-out and a failed-sign-out-after-a-
 * successful-delete are different facts about the user's account.
 */

/** A sign-out call that hasn't answered in this long is treated as failed. */
export const SIGN_OUT_TIMEOUT_MS = 8_000;

export type SignOutResult =
  | { ok: true }
  | { ok: false; reason: 'timeout' | 'error' };

/** The one method this helper needs — keeps it testable without a real client. */
export type SignOutCapableAuth = {
  signOut: () => Promise<{ error: unknown | null }>;
};

/**
 * Signs out, giving up after `timeoutMs`.
 *
 * Resolves — never rejects — so a caller can branch on the outcome instead of
 * wrapping it in a `try` that also covers unrelated work.
 *
 * A `timeout` result means the request was abandoned, NOT that it failed: the
 * server may still process it. Callers must treat the local session as
 * possibly-live and say so, rather than claiming either outcome.
 */
export async function signOutWithTimeout(
  auth: SignOutCapableAuth,
  timeoutMs: number = SIGN_OUT_TIMEOUT_MS,
): Promise<SignOutResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<SignOutResult>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, reason: 'timeout' }), timeoutMs);
  });

  const attempt = (async (): Promise<SignOutResult> => {
    try {
      const { error } = await auth.signOut();
      // supabase-js reports most failures in-band; a truthy error is a failure
      // even though the promise resolved.
      return error ? { ok: false, reason: 'error' } : { ok: true };
    } catch {
      // …and reports transport failures by throwing. Same outcome to the caller.
      return { ok: false, reason: 'error' };
    }
  })();

  try {
    return await Promise.race([attempt, timeout]);
  } finally {
    // Always clear the timer, including on the race the timer won, so a pending
    // handle can't keep a background task alive after the screen unmounts.
    if (timer !== undefined) clearTimeout(timer);
  }
}
