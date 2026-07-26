import { describe, it, expect } from "vitest";

import {
  AUTH_ERROR_CREDENTIALS,
  AUTH_ERROR_NETWORK,
  AUTH_ERROR_RATE_LIMITED,
  AUTH_ERROR_SIGN_IN_GENERIC,
  AUTH_ERROR_SIGN_UP_GENERIC,
  isAlreadyRegisteredError,
  signInErrorMessage,
  signUpErrorMessage,
} from "@/mobile/src/lib/auth-errors";
import { LOGIN_ERROR_CREDENTIALS, loginErrorMessage } from "@/lib/auth/login-errors";
import { isAlreadyRegisteredError as isAlreadyRegisteredWeb } from "@/lib/auth/signup-errors";

// The Expo app cannot import the Next.js `lib/` tree (separate tsconfig +
// bundler), so mobile/src/lib/auth-errors.ts is a deliberate PORT of
// lib/auth/login-errors.ts + lib/auth/signup-errors.ts. These tests do two
// things: pin the mobile module's own behaviour, and assert the two surfaces
// still AGREE — a port that silently drifts is exactly how one platform
// reopens an enumeration leak the other one closed.

// Every GoTrue outcome that can fire ONLY for an address that already has an
// account. If any of these gets its own distinguishable message, an attacker
// separates "registered" from "unknown" without guessing a password.
const EXISTENCE_ORACLE_CODES = [
  "invalid_credentials",
  "email_not_confirmed",
  "user_not_found",
  "phone_not_confirmed",
  "user_banned",
  "user_sso_managed",
];

describe("mobile signInErrorMessage — enumeration hardening", () => {
  it("collapses EVERY existence-oracle code onto one identical message", () => {
    const messages = EXISTENCE_ORACLE_CODES.map((code) =>
      signInErrorMessage({ code, message: `raw provider text for ${code}`, status: 400 }),
    );
    expect(new Set(messages).size).toBe(1);
    expect(messages[0]).toBe(AUTH_ERROR_CREDENTIALS);
  });

  it("agrees with the web classifier on every existence-oracle code", () => {
    for (const code of EXISTENCE_ORACLE_CODES) {
      const error = { code, message: "Invalid login credentials", status: 400 };
      // Both surfaces must put the code in the CREDENTIALS bucket. The literal
      // strings differ per platform only if someone edits one — assert the
      // bucket, then assert the buckets' text matches too.
      expect(signInErrorMessage(error)).toBe(AUTH_ERROR_CREDENTIALS);
      expect(loginErrorMessage(error)).toBe(LOGIN_ERROR_CREDENTIALS);
    }
    expect(AUTH_ERROR_CREDENTIALS).toBe(LOGIN_ERROR_CREDENTIALS);
  });

  it("classifies a codeless response by message text (older/self-hosted GoTrue)", () => {
    expect(signInErrorMessage({ message: "Email not confirmed" })).toBe(AUTH_ERROR_CREDENTIALS);
    expect(signInErrorMessage({ message: "Invalid login credentials" })).toBe(
      AUTH_ERROR_CREDENTIALS,
    );
    expect(
      signInErrorMessage({
        message: "Only a SSO authentication method is allowed for this user",
      }),
    ).toBe(AUTH_ERROR_CREDENTIALS);
  });

  it("puts the credential bucket FIRST so a rate-limit-ish phrasing can't reclassify it", () => {
    // A hypothetical provider message carrying BOTH signals must still land in
    // the neutral bucket — ordering is the guard, not the message wording.
    expect(
      signInErrorMessage({
        code: "user_banned",
        message: "For security purposes, this account is banned",
        status: 429,
      }),
    ).toBe(AUTH_ERROR_CREDENTIALS);
  });

  it("reports rate limiting, which is actionable and reveals nothing", () => {
    expect(signInErrorMessage({ status: 429, message: "slow down" })).toBe(
      AUTH_ERROR_RATE_LIMITED,
    );
    expect(signInErrorMessage({ code: "over_request_rate_limit" })).toBe(AUTH_ERROR_RATE_LIMITED);
    expect(
      signInErrorMessage({
        message: "For security purposes, you can only request this after 33 seconds",
      }),
    ).toBe(AUTH_ERROR_RATE_LIMITED);
  });

  it("reports transport failures as network errors (no verdict was reached)", () => {
    expect(signInErrorMessage({ name: "AuthRetryableFetchError" })).toBe(AUTH_ERROR_NETWORK);
    expect(signInErrorMessage({ status: 0 })).toBe(AUTH_ERROR_NETWORK);
    expect(signInErrorMessage({ status: 503, message: "Service Unavailable" })).toBe(
      AUTH_ERROR_NETWORK,
    );
    // The screens' own 15s timeout rejects with this text.
    expect(
      signInErrorMessage(new Error("Sign-in timed out. Check your connection and try again.")),
    ).toBe(AUTH_ERROR_NETWORK);
  });

  it("falls back to a generic message and NEVER echoes provider text", () => {
    expect(signInErrorMessage({ message: "Database error querying schema" })).toBe(
      AUTH_ERROR_SIGN_IN_GENERIC,
    );
    expect(signInErrorMessage(null)).toBe(AUTH_ERROR_SIGN_IN_GENERIC);
    expect(signInErrorMessage(undefined)).toBe(AUTH_ERROR_SIGN_IN_GENERIC);
  });

  it("never returns provider text for ANY classified input", () => {
    const provider = "Database error querying schema: relation auth.users does not exist";
    const outputs = [
      signInErrorMessage({ message: provider }),
      signInErrorMessage({ code: "invalid_credentials", message: provider }),
      signInErrorMessage({ status: 429, message: provider }),
      signInErrorMessage({ status: 500, message: provider }),
    ];
    for (const out of outputs) {
      expect(out).not.toContain("Database error");
      expect(out).not.toContain("auth.users");
    }
  });
});

describe("mobile isAlreadyRegisteredError", () => {
  it("detects the codes and the loose message patterns", () => {
    expect(isAlreadyRegisteredError({ code: "user_already_exists" })).toBe(true);
    expect(isAlreadyRegisteredError({ code: "EMAIL_EXISTS" })).toBe(true);
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

  it("agrees with the web classifier on the same inputs", () => {
    const cases = [
      { code: "user_already_exists" },
      { code: "email_exists" },
      { message: "User already registered" },
      { message: "A user with this email already exists" },
      { code: "weak_password" },
      { message: "Network request failed" },
    ];
    for (const c of cases) {
      expect(isAlreadyRegisteredError(c)).toBe(isAlreadyRegisteredWeb(c));
    }
  });
});

describe("mobile signUpErrorMessage", () => {
  it("keeps password-strength feedback specific — it reveals nothing about the address", () => {
    // GoTrue validates the SUBMITTED password before looking the address up, so
    // this outcome is reachable for a registered and an unknown address alike.
    expect(signUpErrorMessage({ code: "weak_password" })).toContain("stronger password");
    expect(
      signUpErrorMessage({ message: "Password should be at least 6 characters" }),
    ).toContain("stronger password");
  });

  it("keeps malformed-address feedback specific for the same reason", () => {
    expect(signUpErrorMessage({ code: "email_address_invalid" })).toContain(
      "valid email address",
    );
    expect(signUpErrorMessage({ message: "Unable to validate email address: invalid format" }))
      .toContain("valid email address");
  });

  it("classifies rate limiting and transport failures", () => {
    expect(signUpErrorMessage({ status: 429 })).toBe(AUTH_ERROR_RATE_LIMITED);
    expect(signUpErrorMessage({ name: "AuthRetryableFetchError" })).toBe(AUTH_ERROR_NETWORK);
    expect(
      signUpErrorMessage(new Error("Sign-up timed out. Check your connection and try again.")),
    ).toBe(AUTH_ERROR_NETWORK);
  });

  it("falls back to generic and never echoes provider text", () => {
    expect(signUpErrorMessage({ message: "Database error saving new user" })).toBe(
      AUTH_ERROR_SIGN_UP_GENERIC,
    );
    expect(signUpErrorMessage(null)).toBe(AUTH_ERROR_SIGN_UP_GENERIC);
  });

  it("has no already-registered branch of its own — that case must not reach it", () => {
    // The screen routes an already-registered error to the neutral SUCCESS
    // screen before calling this. If someone ever wires it straight through,
    // this asserts it still cannot produce a distinguishable message.
    const message = signUpErrorMessage({ message: "User already registered" });
    expect(message).toBe(AUTH_ERROR_SIGN_UP_GENERIC);
    expect(message).not.toContain("already");
  });
});
