import { describe, it, expect } from "vitest";

// The Expo app cannot import from the web `lib/` (mobile/tsconfig.json maps only
// `@/* -> ./src/*`, and Metro does not resolve outside mobile/), so the auth
// error classification is a DELIBERATE duplicate. Vitest, however, CAN reach
// both trees — so this suite both exercises the mobile module's branches and
// pins the two copies together, which is the only thing stopping the duplicate
// from silently drifting back into a leak on one surface.
import {
  AUTH_ERROR_CREDENTIALS,
  AUTH_ERROR_NETWORK,
  AUTH_ERROR_RATE_LIMITED,
  AUTH_ERROR_SIGN_IN_GENERIC,
  AUTH_ERROR_SIGN_UP_GENERIC,
  CREDENTIAL_CODES,
  CREDENTIAL_PATTERNS,
  isAlreadyRegisteredError,
  signInErrorMessage,
  signUpErrorMessage,
} from "../../mobile/src/lib/auth-errors";

describe("mobile signInErrorMessage — enumeration safety", () => {
  // THE core property. Every one of these outcomes can fire ONLY for an address
  // that already has an account, so if any of them got its own message an
  // attacker could separate "registered" from "unknown" without ever guessing a
  // password. They must all be indistinguishable from a plain wrong password.
  const EXISTENCE_REVEALING = [
    { code: "invalid_credentials", message: "Invalid login credentials" },
    { code: "email_not_confirmed", message: "Email not confirmed" },
    { code: "user_not_found", message: "User not found" },
    { code: "phone_not_confirmed", message: "Phone not confirmed" },
    { code: "user_banned", message: "User is banned" },
    {
      code: "user_sso_managed",
      message: "Only a SSO authentication method is allowed for this user",
    },
  ];

  for (const err of EXISTENCE_REVEALING) {
    it(`collapses ${err.code} into the single credential message`, () => {
      expect(signInErrorMessage(err)).toBe(AUTH_ERROR_CREDENTIALS);
    });
  }

  it("gives every existence-revealing code the SAME message (no oracle)", () => {
    const distinct = new Set(EXISTENCE_REVEALING.map((e) => signInErrorMessage(e)));
    expect(distinct.size).toBe(1);
  });

  it("classifies by message text when the provider sends no code", () => {
    // Older / self-hosted GoTrue returns no `code`. The leak must stay closed.
    expect(signInErrorMessage({ message: "Invalid login credentials" })).toBe(
      AUTH_ERROR_CREDENTIALS,
    );
    expect(signInErrorMessage({ message: "Email not confirmed" })).toBe(AUTH_ERROR_CREDENTIALS);
  });

  it("never returns raw provider text", () => {
    const leaky = signInErrorMessage({ message: "Database error querying schema", status: 500 });
    expect(leaky).not.toContain("Database");
    expect(leaky).toBe(AUTH_ERROR_NETWORK);
  });
});

describe("mobile signInErrorMessage — actionable non-leaking buckets", () => {
  it("surfaces rate limiting (does not depend on whether the address exists)", () => {
    expect(signInErrorMessage({ status: 429 })).toBe(AUTH_ERROR_RATE_LIMITED);
    expect(signInErrorMessage({ code: "over_request_rate_limit" })).toBe(AUTH_ERROR_RATE_LIMITED);
    expect(
      signInErrorMessage({
        message: "For security purposes, you can only request this after 33 seconds",
      }),
    ).toBe(AUTH_ERROR_RATE_LIMITED);
  });

  it("surfaces network failure, including the screens' own timeout Error", () => {
    expect(signInErrorMessage({ name: "AuthRetryableFetchError" })).toBe(AUTH_ERROR_NETWORK);
    expect(signInErrorMessage({ status: 0 })).toBe(AUTH_ERROR_NETWORK);
    expect(signInErrorMessage({ status: 503 })).toBe(AUTH_ERROR_NETWORK);
    // login-screen.tsx rejects with exactly this on AUTH_TIMEOUT_MS.
    expect(
      signInErrorMessage(new Error("Sign-in timed out. Check your connection and try again.")),
    ).toBe(AUTH_ERROR_NETWORK);
  });

  it("falls back to the generic message for an unclassifiable error", () => {
    expect(signInErrorMessage({ message: "something unexpected", status: 400 })).toBe(
      AUTH_ERROR_SIGN_IN_GENERIC,
    );
    expect(signInErrorMessage(null)).toBe(AUTH_ERROR_SIGN_IN_GENERIC);
    expect(signInErrorMessage(undefined)).toBe(AUTH_ERROR_SIGN_IN_GENERIC);
  });

  it("checks the credential bucket FIRST so a 429-tagged credential error still masks", () => {
    // Ordering matters: if rate-limit won, an attacker could tag probes to get a
    // different message for a registered address.
    expect(signInErrorMessage({ code: "email_not_confirmed", status: 429 })).toBe(
      AUTH_ERROR_CREDENTIALS,
    );
  });
});

describe("mobile isAlreadyRegisteredError", () => {
  it("detects an existing account by code", () => {
    expect(isAlreadyRegisteredError({ code: "user_already_exists" })).toBe(true);
    expect(isAlreadyRegisteredError({ code: "email_exists" })).toBe(true);
  });

  it("detects an existing account by message when no code is sent", () => {
    expect(isAlreadyRegisteredError({ message: "User already registered" })).toBe(true);
    expect(isAlreadyRegisteredError({ message: "A user with this email already exists" })).toBe(
      true,
    );
  });

  it("does not fire on unrelated failures", () => {
    expect(isAlreadyRegisteredError({ code: "weak_password" })).toBe(false);
    expect(isAlreadyRegisteredError({ message: "Network request failed" })).toBe(false);
    expect(isAlreadyRegisteredError(null)).toBe(false);
    expect(isAlreadyRegisteredError(undefined)).toBe(false);
  });
});

describe("mobile signUpErrorMessage", () => {
  it("never returns raw provider text", () => {
    expect(signUpErrorMessage({ message: "Database error saving new user", status: 500 })).toBe(
      AUTH_ERROR_NETWORK,
    );
    expect(signUpErrorMessage({ code: "weak_password", message: "Password is too weak" })).toBe(
      AUTH_ERROR_SIGN_UP_GENERIC,
    );
  });

  it("keeps rate limit and network actionable (neither reveals existence)", () => {
    expect(signUpErrorMessage({ status: 429 })).toBe(AUTH_ERROR_RATE_LIMITED);
    expect(
      signUpErrorMessage(new Error("Sign-up timed out. Check your connection and try again.")),
    ).toBe(AUTH_ERROR_NETWORK);
  });

  it("falls back to the sign-up generic, not the sign-in one", () => {
    expect(signUpErrorMessage(null)).toBe(AUTH_ERROR_SIGN_UP_GENERIC);
    expect(signUpErrorMessage({ message: "something unexpected", status: 400 })).toBe(
      AUTH_ERROR_SIGN_UP_GENERIC,
    );
  });
});

describe("mobile/web parity — the duplicate must not drift", () => {
  // HARD-CODED on purpose. Iterating over the imported CREDENTIAL_CODES /
  // CREDENTIAL_PATTERNS arrays would be tautological: deleting an entry from the
  // source would also delete its own test case, so the suite would stay green
  // while the leak reopened. (Verified — dropping the bare "sso" pattern passed
  // all 22 tests under the loop version.) These literals are an INDEPENDENT
  // statement of what must be masked; the web suite is hard-coded for the same
  // reason. Adding a code to the source means adding it here too.
  const MUST_MASK_CODES = [
    "invalid_credentials",
    "email_not_confirmed",
    "user_not_found",
    "phone_not_confirmed",
    "user_banned",
    "user_sso_managed",
  ];
  const MUST_MASK_MESSAGES = [
    "invalid login credentials",
    "email not confirmed",
    "invalid credentials",
    "user not found",
    "banned",
    "single sign-on",
    // GoTrue's real codeless text for an SSO-provisioned (therefore REGISTERED)
    // address is "Only a SSO authentication method is allowed for this user" —
    // it contains neither "single sign-on" nor "sso-managed", so the bare "sso"
    // substring is load-bearing, not redundant. Asserted with the REAL sentence
    // rather than the bare token so the test fails if that pattern is dropped.
    "Only a SSO authentication method is allowed for this user",
  ];

  it("masks every enumeration-sensitive sign-in code on BOTH surfaces", async () => {
    const web = await import("@/lib/auth/login-errors");
    for (const code of MUST_MASK_CODES) {
      expect(signInErrorMessage({ code }), `mobile stopped masking code "${code}"`).toBe(
        AUTH_ERROR_CREDENTIALS,
      );
      expect(web.loginErrorMessage({ code }), `web stopped masking code "${code}"`).toBe(
        web.LOGIN_ERROR_CREDENTIALS,
      );
    }
  });

  it("masks every enumeration-sensitive codeless sign-in message on BOTH surfaces", async () => {
    const web = await import("@/lib/auth/login-errors");
    for (const message of MUST_MASK_MESSAGES) {
      expect(signInErrorMessage({ message }), `mobile stopped masking "${message}"`).toBe(
        AUTH_ERROR_CREDENTIALS,
      );
      expect(web.loginErrorMessage({ message }), `web stopped masking "${message}"`).toBe(
        web.LOGIN_ERROR_CREDENTIALS,
      );
    }
  });

  it("keeps the exported code/pattern sets exactly as wide as the hard-coded lists", () => {
    // Catches the other direction: a code SILENTLY REMOVED from the source set
    // (the mutation that survived the loop-based version), and equally a code
    // added to the source without anyone extending the assertions above.
    expect([...CREDENTIAL_CODES].sort()).toEqual([...MUST_MASK_CODES].sort());
    expect([...CREDENTIAL_PATTERNS].sort()).toEqual(
      ["invalid login credentials", "email not confirmed", "invalid credentials", "user not found", "banned", "single sign-on", "sso"].sort(),
    );
  });

  it("agrees with the web module on what 'already registered' means", async () => {
    const web = await import("@/lib/auth/signup-errors");
    const cases = [
      { code: "user_already_exists" },
      { code: "email_exists" },
      { message: "User already registered" },
      { message: "already been registered" },
      { code: "weak_password" },
      { message: "Network request failed" },
    ];
    for (const c of cases) {
      expect(
        isAlreadyRegisteredError(c),
        `mobile/web disagree on ${JSON.stringify(c)}`,
      ).toBe(web.isAlreadyRegisteredError(c));
    }
  });
});
