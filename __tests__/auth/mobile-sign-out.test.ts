import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

/**
 * Bounded native sign-out (issue #698).
 *
 * Two layers, because they catch different regressions:
 *  1. BEHAVIOURAL tests of the helper — it has to collapse four distinct
 *     outcomes (resolve-clean, resolve-with-in-band-error, throw, and never
 *     answer) into one branchable value. Only executing it catches an inverted
 *     condition or a missed `catch`.
 *  2. A SOURCE ratchet over settings.tsx, where the actual bug lived and where
 *     there is no importable unit: the screen must not go back to an unbounded
 *     `supabase.auth.signOut()`, and the delete path must not put the sign-out
 *     back inside the try whose catch claims the DELETE failed.
 *
 * This imports mobile/ source directly, which works in CI only because
 * `mobile/src/tsconfig.json` exists — see that file's header.
 *
 * WHAT THE RATCHET CANNOT DO, stated so nobody mistakes it for a proof: it
 * matches SOURCE TEXT, so it pins the literal `clearPendingSession()` spelling
 * in each handler. A reviewer defeated it by aliasing the import
 * (`clearPendingSession as wipeSession`) and calling the alias — the regression
 * returns and every test still passes. That is inherent to text scanning, not a
 * fixable hole (the same conclusion this repo reached about the G4 call-site
 * ratchet in `mobile-auth-errors.test.ts`): chasing spellings loses, and a
 * destructure or parameter shadow defeats any static scan by construction. The
 * real guard would be a render test (issue #706). What this DOES catch is the
 * regression that actually happened twice in review — an extra or reordered
 * call written the ordinary way.
 */
import {
  SIGN_OUT_TIMEOUT_MS,
  signOutWithTimeout,
  type SignOutCapableAuth,
} from "../../mobile/src/lib/auth/sign-out";

const SETTINGS_SRC = readFileSync(
  path.join(process.cwd(), "mobile/src/app/settings.tsx"),
  "utf8",
);

describe("signOutWithTimeout — collapses every failure shape", () => {
  it("reports success when supabase resolves with no error", async () => {
    const auth: SignOutCapableAuth = { signOut: vi.fn().mockResolvedValue({ error: null }) };
    await expect(signOutWithTimeout(auth)).resolves.toEqual({ ok: true });
  });

  it("reports failure on an IN-BAND error (the promise still resolves)", async () => {
    // supabase-js reports most sign-out failures this way. Reading only the
    // resolved/rejected status would call this a success and leave the user
    // signed in while the UI says otherwise.
    const auth: SignOutCapableAuth = {
      signOut: vi.fn().mockResolvedValue({ error: { message: "network error" } }),
    };
    await expect(signOutWithTimeout(auth)).resolves.toEqual({ ok: false, reason: "error" });
  });

  it("reports failure when the call THROWS instead of resolving", async () => {
    // …and reports transport failures by rejecting. Both must be caught.
    const auth: SignOutCapableAuth = {
      signOut: vi.fn().mockRejectedValue(new Error("Network request failed")),
    };
    await expect(signOutWithTimeout(auth)).resolves.toEqual({ ok: false, reason: "error" });
  });

  it("never rejects, so a caller can branch instead of wrapping it in a try", async () => {
    const auth: SignOutCapableAuth = {
      signOut: vi.fn().mockRejectedValue(new Error("boom")),
    };
    // The delete path depends on this: a throw escaping here would land in the
    // catch that reports a DELETE failure for an already-deleted account.
    const result = await signOutWithTimeout(auth);
    expect(result.ok).toBe(false);
  });
});

describe("signOutWithTimeout — the timeout is the actual fix", () => {
  it("gives up on a call that never answers", async () => {
    vi.useFakeTimers();
    try {
      // A sign-out that hangs forever is exactly the dead-network case: before
      // the timeout the settings row simply stopped responding.
      const auth: SignOutCapableAuth = {
        signOut: vi.fn(() => new Promise<{ error: unknown | null }>(() => {})),
      };
      const pending = signOutWithTimeout(auth, 5_000);
      await vi.advanceTimersByTimeAsync(5_000);
      await expect(pending).resolves.toEqual({ ok: false, reason: "timeout" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("distinguishes a timeout from an error — they mean different things to the user", async () => {
    vi.useFakeTimers();
    try {
      const hanging: SignOutCapableAuth = {
        signOut: vi.fn(() => new Promise<{ error: unknown | null }>(() => {})),
      };
      const failing: SignOutCapableAuth = {
        signOut: vi.fn().mockResolvedValue({ error: { message: "nope" } }),
      };
      const timedOut = signOutWithTimeout(hanging, 1_000);
      await vi.advanceTimersByTimeAsync(1_000);
      // A timeout means "abandoned, may still be processing"; an error means
      // "answered, and said no". The screen words them differently.
      await expect(timedOut).resolves.toEqual({ ok: false, reason: "timeout" });
      await expect(signOutWithTimeout(failing, 1_000)).resolves.toEqual({
        ok: false,
        reason: "error",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("still succeeds when the call answers just inside the budget", async () => {
    vi.useFakeTimers();
    try {
      const auth: SignOutCapableAuth = {
        signOut: vi.fn(
          () =>
            new Promise<{ error: null }>((resolve) =>
              setTimeout(() => resolve({ error: null }), 900),
            ),
        ),
      };
      const pending = signOutWithTimeout(auth, 1_000);
      await vi.advanceTimersByTimeAsync(900);
      // The bound must not be so eager that an ordinary slow network reads as
      // a failure and pushes a scary alert at a user who IS signed out.
      await expect(pending).resolves.toEqual({ ok: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it("defaults to a bound that is actually finite", () => {
    expect(SIGN_OUT_TIMEOUT_MS).toBeGreaterThan(0);
    expect(Number.isFinite(SIGN_OUT_TIMEOUT_MS)).toBe(true);
  });
});

/** Source with `//` line comments removed, so a ratchet asserts on code only. */
function stripComments(src: string): string {
  return src.replace(/^\s*\/\/.*$/gm, "");
}

/**
 * The source text of the block opened by `marker`, brace-matched to its close.
 *
 * A naive `indexOf("} else {")` overshoots into the ELSE branch — which
 * legitimately contains the failure copy this test asserts is absent from the
 * success branch — so the assertion would pass or fail for the wrong reason.
 */
function braceBlockAfter(src: string, marker: string): string {
  const open = src.indexOf(marker);
  if (open === -1) throw new Error(`marker not found in settings.tsx: ${marker}`);
  let depth = 0;
  for (let i = open + marker.length - 1; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  throw new Error(`unbalanced braces after marker: ${marker}`);
}

describe("settings screen — the call sites that carried the bug", () => {
  it("never calls supabase.auth.signOut() directly (that call is unbounded)", () => {
    // The whole defect was an unbounded await. Reintroducing a bare call at
    // either site would silently restore it, and no unit test would see it.
    expect(SETTINGS_SRC).not.toMatch(/supabase\.auth\.signOut\s*\(/);
    expect(SETTINGS_SRC).toMatch(/signOutWithTimeout\s*\(\s*supabase\.auth/);
  });

  it("clears the pending photo session BEFORE signing out on the delete path", () => {
    // Once the server has destroyed the account the identity boundary has moved
    // whatever the sign-out does, so this must not sit behind a call that can
    // fail — that is precisely how the original bug skipped it.
    const okBranch = braceBlockAfter(SETTINGS_SRC, "if (resp.ok) {");
    const clear = okBranch.indexOf("clearPendingSession()");
    const signOut = okBranch.indexOf("signOutWithTimeout(");
    expect(clear).toBeGreaterThan(-1);
    expect(signOut).toBeGreaterThan(-1);
    expect(clear).toBeLessThan(signOut);

    // …and ONLY on the confirmed-delete branch. A failed delete leaves the same
    // user signed in on the same device, so clearing there would destroy their
    // in-progress room for nothing — the same harm as on the sign-out path.
    const handler = braceBlockAfter(
      SETTINGS_SRC,
      "const performDelete = useCallback(async () => {",
    );
    expect((handler.match(/clearPendingSession\(\)/g) ?? []).length).toBe(1);
  });

  it("clears it only AFTER a SUCCESSFUL sign-out on the sign-out path", () => {
    // The opposite ordering to the delete path, and deliberately so: a failed
    // sign-out leaves the SAME user signed in on the same device, so there is no
    // next user to protect from and clearing would just destroy their
    // in-progress room. Scoped to handleSignOut — asserting on the whole file
    // would only ever re-test performDelete, whose clear comes first in source
    // order and would satisfy any file-wide ordering check.
    const handler = braceBlockAfter(SETTINGS_SRC, "const handleSignOut = useCallback(async () => {");
    const signOut = handler.indexOf("signOutWithTimeout(");
    const clear = handler.indexOf("clearPendingSession()");
    expect(signOut).toBeGreaterThan(-1);
    expect(clear).toBeGreaterThan(-1);
    expect(signOut).toBeLessThan(clear);

    // …and it must be inside the success branch, not merely after the call.
    const successBranch = braceBlockAfter(handler, "if (result.ok) {");
    expect(successBranch).toContain("clearPendingSession()");

    // EXCLUSIVITY, not just ordering. A reviewer defeated an earlier version of
    // this ratchet by ADDING a second unconditional call in the failure branch:
    // the ordering assertions above still passed while the rejected data-loss
    // regression was fully reintroduced. Exactly one call in this handler.
    expect((handler.match(/clearPendingSession\(\)/g) ?? []).length).toBe(1);
  });

  it("does not tell a user their delete failed once the server confirmed it", () => {
    // After `resp.ok` the account is gone. The old code let a sign-out failure
    // fall into the delete catch, which said "Unable to delete account" about
    // an account that no longer existed.
    const okBranch = braceBlockAfter(SETTINGS_SRC, "if (resp.ok) {");
    expect(okBranch).toContain("signOutWithTimeout");
    // Assert on CODE, not prose: the branch's own comments discuss the old
    // "Unable to delete account" message by name, and a ratchet that a comment
    // can satisfy (or break) is measuring the wrong thing.
    expect(stripComments(okBranch)).not.toContain("Unable to delete account");
    // …and the post-delete message states the delete SUCCEEDED.
    expect(okBranch).toMatch(/Account deleted/);
  });
});
