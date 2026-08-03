// Password-reset link idempotency (G4 — double-click safety).
//
// A recovery token_hash is one-time-use: verifyOtp fails identically whether
// the link is genuinely expired/invalid OR was already redeemed a moment ago
// by this same browser (a double-tap, an email client's link-preview
// prefetch racing the user's own click, or the user reopening the email).
// The page needs to tell those apart without trusting ambient state.
//
// The unsafe version of this check is "does a session exist right now?" —
// that conflates "I personally just redeemed THIS token" with "there happens
// to be a session in this browser for any reason," which lets a dead/garbage
// link through whenever the browser is already signed in (a shared machine
// with another user's live session, or a user who is simply logged in
// already). The safe version requires a marker written ONLY by a prior
// successful verifyOtp for this EXACT token_hash, in THIS browser.

/**
 * Decide whether a failed verifyOtp should still be treated as "ready"
 * (already redeemed by this browser, not actually dead) or "invalid".
 *
 * @param alreadyRedeemedHere - a redemption marker scoped to THIS token_hash
 *   was set by an earlier successful verifyOtp call, in this browser.
 * @param hasActiveSession - a Supabase session currently exists. Required in
 *   addition to the marker as defense-in-depth: even a same-token marker
 *   should not grant "ready" if the session it created is somehow gone.
 */
export function resolveRedeemedStatus(params: {
  alreadyRedeemedHere: boolean;
  hasActiveSession: boolean;
}): "ready" | "invalid" {
  return params.alreadyRedeemedHere && params.hasActiveSession ? "ready" : "invalid";
}

/** localStorage key for the per-token redemption marker. Exported so the page and its test agree on the scheme. */
export function redeemedMarkerKey(tokenHash: string): string {
  return `reset-link-redeemed:${tokenHash}`;
}
