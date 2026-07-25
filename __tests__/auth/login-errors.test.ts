import { describe, expect, it } from "vitest";
import {
  LOGIN_ERROR_CREDENTIALS,
  LOGIN_ERROR_GENERIC,
  LOGIN_ERROR_NETWORK,
  LOGIN_ERROR_RATE_LIMITED,
  loginErrorMessage,
} from "@/lib/auth/login-errors";

/**
 * G4 — user-enumeration hardening on the sign-in path. The load-bearing property
 * is NOT "a nice message": it is that a wrong password, an unknown address and a
 * registered-but-unconfirmed address are INDISTINGUISHABLE in the response, and
 * that provider text never reaches the browser.
 */
describe("loginErrorMessage", () => {
  it("gives the SAME message for a wrong password and an unconfirmed account", () => {
    // Supabase distinguishes these two; the UI must not. "Email not confirmed"
    // leaking through would confirm the address is registered.
    const wrongPassword = loginErrorMessage({
      message: "Invalid login credentials",
      code: "invalid_credentials",
      status: 400,
    });
    const unconfirmed = loginErrorMessage({
      message: "Email not confirmed",
      code: "email_not_confirmed",
      status: 400,
    });
    expect(wrongPassword).toBe(LOGIN_ERROR_CREDENTIALS);
    expect(unconfirmed).toBe(LOGIN_ERROR_CREDENTIALS);
    expect(unconfirmed).toBe(wrongPassword);
  });

  it("hides the outcomes that can ONLY happen to a registered address", () => {
    // GoTrue returns `user_banned` and `user_sso_managed` exclusively for an
    // address that already has an account. If either got its own message, an
    // attacker could separate "registered" from "unknown" without ever guessing
    // a password — the same oracle "Email not confirmed" would have been.
    const banned = loginErrorMessage({ message: "User is banned", code: "user_banned", status: 400 });
    const ssoManaged = loginErrorMessage({
      message: "Only a SSO authentication method is allowed for this user",
      code: "user_sso_managed",
      status: 422,
    });
    const unknownAddress = loginErrorMessage({ code: "invalid_credentials", status: 400 });
    expect(banned).toBe(unknownAddress);
    expect(ssoManaged).toBe(unknownAddress);
    expect(banned).toBe(LOGIN_ERROR_CREDENTIALS);
  });

  it("classifies on the message alone when the provider sends no code", () => {
    // Older/self-hosted GoTrue omits `code`; the substring match is what keeps
    // the leak closed there.
    expect(loginErrorMessage({ message: "Email not confirmed" })).toBe(LOGIN_ERROR_CREDENTIALS);
    expect(loginErrorMessage({ message: "User not found", status: 400 })).toBe(
      LOGIN_ERROR_CREDENTIALS,
    );
  });

  it("never echoes provider text to the user", () => {
    const leaky = {
      message: "Database error querying schema: relation auth.users does not exist",
      status: 500,
    };
    const out = loginErrorMessage(leaky);
    expect(out).not.toContain("auth.users");
    expect(out).not.toContain("Database error");
    // A 500 is "we never got a verdict", not "your password is wrong".
    expect(out).toBe(LOGIN_ERROR_NETWORK);
  });

  it("tells the user to wait ONLY when actually rate limited", () => {
    expect(loginErrorMessage({ message: "Request rate limit reached", status: 429 })).toBe(
      LOGIN_ERROR_RATE_LIMITED,
    );
    expect(
      loginErrorMessage({
        message: "For security purposes, you can only request this after 33 seconds",
      }),
    ).toBe(LOGIN_ERROR_RATE_LIMITED);
    // ...and a plain credential failure is NOT relabelled as a rate limit.
    expect(loginErrorMessage({ code: "invalid_credentials" })).toBe(LOGIN_ERROR_CREDENTIALS);
  });

  it("maps an unreachable auth endpoint and our own timeout to the network message", () => {
    // What supabase-js returns when the fetch never completed.
    expect(
      loginErrorMessage({ name: "AuthRetryableFetchError", message: "Failed to fetch", status: 0 }),
    ).toBe(LOGIN_ERROR_NETWORK);
    // What the login form's own 15s Promise.race rejects with.
    expect(loginErrorMessage(new Error("Sign-in timed out"))).toBe(LOGIN_ERROR_NETWORK);
  });

  it("falls back to the generic message for an unrecognised or absent error", () => {
    expect(loginErrorMessage({ message: "something entirely new", status: 418 })).toBe(
      LOGIN_ERROR_GENERIC,
    );
    expect(loginErrorMessage(null)).toBe(LOGIN_ERROR_GENERIC);
    expect(loginErrorMessage(undefined)).toBe(LOGIN_ERROR_GENERIC);
  });

  it("keeps every message actionable and free of provider jargon", () => {
    for (const m of [
      LOGIN_ERROR_CREDENTIALS,
      LOGIN_ERROR_RATE_LIMITED,
      LOGIN_ERROR_NETWORK,
      LOGIN_ERROR_GENERIC,
    ]) {
      expect(m).not.toMatch(/supabase|gotrue|auth\.|jwt|schema/i);
    }
  });
});
