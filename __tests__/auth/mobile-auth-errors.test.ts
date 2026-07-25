/**
 * Mobile auth error classification (G4) — and the guard that keeps it in step
 * with the web module it deliberately duplicates.
 *
 * The Expo app cannot import `lib/auth/login-errors.ts` (its module graph stops
 * at mobile/src), so the sign-in rules exist twice. The PARITY block below
 * feeds identical fixtures to both and asserts they land in the same bucket, so
 * a future change to one that is not mirrored in the other fails here rather
 * than quietly reopening the enumeration leak on whichever surface was missed.
 */

import { describe, it, expect } from "vitest";

import {
  signInErrorMessage,
  signUpErrorMessage,
  isAccountExistsError,
  CREDENTIAL_CODES as MOBILE_CREDENTIAL_CODES,
  AUTH_ERROR_CREDENTIALS,
  AUTH_ERROR_RATE_LIMITED,
  AUTH_ERROR_NETWORK,
  AUTH_ERROR_SIGN_IN_GENERIC,
  AUTH_ERROR_SIGN_UP_GENERIC,
  AUTH_ERROR_WEAK_PASSWORD,
} from "@/mobile/src/lib/auth/auth-errors";
import {
  loginErrorMessage,
  CREDENTIAL_CODES as WEB_CREDENTIAL_CODES,
  LOGIN_ERROR_CREDENTIALS,
  LOGIN_ERROR_RATE_LIMITED,
  LOGIN_ERROR_NETWORK,
} from "@/lib/auth/login-errors";

/** Bucket label, so the two modules' differing copy can still be compared. */
type Bucket = "credentials" | "rate_limit" | "network" | "generic";

function mobileBucket(error: unknown): Bucket {
  const m = signInErrorMessage(error as { message?: string });
  if (m === AUTH_ERROR_CREDENTIALS) return "credentials";
  if (m === AUTH_ERROR_RATE_LIMITED) return "rate_limit";
  if (m === AUTH_ERROR_NETWORK) return "network";
  return "generic";
}

function webBucket(error: unknown): Bucket {
  const m = loginErrorMessage(error as { message?: string });
  if (m === LOGIN_ERROR_CREDENTIALS) return "credentials";
  if (m === LOGIN_ERROR_RATE_LIMITED) return "rate_limit";
  if (m === LOGIN_ERROR_NETWORK) return "network";
  return "generic";
}

// Every fixture is a real GoTrue / supabase-js shape.
const FIXTURES: { name: string; error: unknown; bucket: Bucket }[] = [
  { name: "wrong password", error: { code: "invalid_credentials" }, bucket: "credentials" },
  {
    name: "unconfirmed account (exists!)",
    error: { code: "email_not_confirmed" },
    bucket: "credentials",
  },
  { name: "no such user", error: { code: "user_not_found" }, bucket: "credentials" },
  { name: "banned account (exists!)", error: { code: "user_banned" }, bucket: "credentials" },
  {
    name: "SSO-managed account (exists!)",
    error: { code: "user_sso_managed" },
    bucket: "credentials",
  },
  {
    name: "codeless legacy GoTrue text",
    error: { message: "Invalid login credentials" },
    bucket: "credentials",
  },
  {
    name: "codeless SSO text",
    error: { message: "Only a SSO authentication method is allowed for this user" },
    bucket: "credentials",
  },
  { name: "rate limited by code", error: { code: "over_request_rate_limit" }, bucket: "rate_limit" },
  { name: "rate limited by status", error: { status: 429 }, bucket: "rate_limit" },
  {
    name: "unreachable endpoint",
    error: { name: "AuthRetryableFetchError", status: 0 },
    bucket: "network",
  },
  { name: "gateway error", error: { status: 503 }, bucket: "network" },
  { name: "our own timeout", error: { message: "Sign-in timed out" }, bucket: "network" },
  { name: "unknown provider failure", error: { message: "schema query failed" }, bucket: "generic" },
  { name: "null error", error: null, bucket: "generic" },
];

describe("mobile signInErrorMessage", () => {
  it.each(FIXTURES)("buckets $name correctly", ({ error, bucket }) => {
    expect(mobileBucket(error)).toBe(bucket);
  });

  it("never returns provider text", () => {
    const leaky = { code: "email_not_confirmed", message: "Email not confirmed" };
    expect(signInErrorMessage(leaky)).toBe(AUTH_ERROR_CREDENTIALS);
    expect(signInErrorMessage(leaky)).not.toContain("not confirmed");
  });

  it("gives an unconfirmed account the SAME message as a wrong password", () => {
    // The whole point: these two must be indistinguishable, because only a
    // REGISTERED address can be unconfirmed.
    expect(signInErrorMessage({ code: "email_not_confirmed" })).toBe(
      signInErrorMessage({ code: "invalid_credentials" }),
    );
  });
});

describe("web/mobile parity (the two copies must not drift)", () => {
  it.each(FIXTURES)("classifies $name identically on both platforms", ({ error }) => {
    expect(mobileBucket(error)).toBe(webBucket(error));
  });

  it("has IDENTICAL credential-bucket code sets on both platforms", () => {
    // The fixture comparison above only proves agreement on codes someone
    // remembered to add a fixture for. The dangerous case is the opposite: a
    // NEW GoTrue exists-only code added to one module and forgotten in the
    // other — every existing fixture would still agree while one platform
    // quietly leaks. Comparing the sets directly is what catches that.
    expect([...MOBILE_CREDENTIAL_CODES].sort()).toEqual([...WEB_CREDENTIAL_CODES].sort());
  });
});

describe("mobile signUpErrorMessage", () => {
  it("gives an already-registered address no message of its own", () => {
    for (const taken of [
      { code: "user_already_exists" },
      { code: "email_exists" },
      { message: "User already registered" },
    ]) {
      expect(signUpErrorMessage(taken)).toBe(AUTH_ERROR_SIGN_UP_GENERIC);
      expect(signUpErrorMessage(taken)).not.toMatch(/registered|exists/i);
    }
    // ...and it is the same message an unrelated failure produces, so the two
    // cases cannot be told apart.
    expect(signUpErrorMessage({ message: "something else broke" })).toBe(
      AUTH_ERROR_SIGN_UP_GENERIC,
    );
  });

  it("still tells the user when the PASSWORD they typed was rejected", () => {
    // Safe to be specific: this describes the input, not the account.
    expect(signUpErrorMessage({ code: "weak_password" })).toBe(AUTH_ERROR_WEAK_PASSWORD);
    expect(signUpErrorMessage({ message: "Password should be at least 6 characters" })).toBe(
      AUTH_ERROR_WEAK_PASSWORD,
    );
  });

  it("keeps the actionable rate-limit and network buckets", () => {
    expect(signUpErrorMessage({ status: 429 })).toBe(AUTH_ERROR_RATE_LIMITED);
    expect(signUpErrorMessage({ name: "AuthRetryableFetchError", status: 0 })).toBe(
      AUTH_ERROR_NETWORK,
    );
  });

  it("does not reuse the sign-in copy on the sign-up surface", () => {
    expect(AUTH_ERROR_SIGN_UP_GENERIC).not.toBe(AUTH_ERROR_SIGN_IN_GENERIC);
  });
});

describe("isAccountExistsError — routes the flow, never the message", () => {
  it("recognises every shape GoTrue reports a taken address with", () => {
    // The signup screen uses this to attempt sign-in instead of stopping at an
    // error box, so a taken address and a new one reach the app the same way.
    // Missing a shape here reopens a screen-level oracle that no message
    // mapping can close.
    expect(isAccountExistsError({ code: "user_already_exists" })).toBe(true);
    expect(isAccountExistsError({ code: "email_exists" })).toBe(true);
    expect(isAccountExistsError({ message: "User already registered" })).toBe(true);
  });

  it("does not fire for unrelated failures", () => {
    expect(isAccountExistsError({ code: "weak_password" })).toBe(false);
    expect(isAccountExistsError({ message: "Network request failed" })).toBe(false);
    expect(isAccountExistsError(null)).toBe(false);
  });
});
