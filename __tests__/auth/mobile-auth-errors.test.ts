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
  it("classifies the same sign-in codes as the web module", async () => {
    const web = await import("@/lib/auth/login-errors");
    for (const code of CREDENTIAL_CODES) {
      // Both surfaces must treat the code as enumeration-sensitive. The message
      // WORDING is allowed to differ per platform; the CLASSIFICATION is not.
      expect(
        web.loginErrorMessage({ code }),
        `web module does not mask sign-in code "${code}" that mobile masks`,
      ).toBe(web.LOGIN_ERROR_CREDENTIALS);
      expect(signInErrorMessage({ code })).toBe(AUTH_ERROR_CREDENTIALS);
    }
  });

  it("classifies the same codeless sign-in messages as the web module", async () => {
    const web = await import("@/lib/auth/login-errors");
    for (const pattern of CREDENTIAL_PATTERNS) {
      expect(
        web.loginErrorMessage({ message: pattern }),
        `web module does not mask sign-in message "${pattern}" that mobile masks`,
      ).toBe(web.LOGIN_ERROR_CREDENTIALS);
      expect(signInErrorMessage({ message: pattern })).toBe(AUTH_ERROR_CREDENTIALS);
    }
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
