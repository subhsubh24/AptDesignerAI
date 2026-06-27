import { describe, expect, it } from "vitest";
import { isAlreadyRegisteredError, isNewUserSignup } from "@/lib/auth/signup-errors";

describe("isAlreadyRegisteredError", () => {
  it("matches Supabase already-registered codes", () => {
    expect(isAlreadyRegisteredError({ code: "user_already_exists" })).toBe(true);
    expect(isAlreadyRegisteredError({ code: "email_exists" })).toBe(true);
    expect(isAlreadyRegisteredError({ code: "USER_ALREADY_EXISTS" })).toBe(true);
  });

  it("matches already-registered messages case-insensitively", () => {
    expect(isAlreadyRegisteredError({ message: "User already registered" })).toBe(true);
    expect(isAlreadyRegisteredError({ message: "A user with this email already exists" })).toBe(true);
    expect(isAlreadyRegisteredError({ message: "Email has already been registered" })).toBe(true);
  });

  it("does NOT match unrelated errors (so real failures still surface)", () => {
    expect(isAlreadyRegisteredError({ message: "Password should be at least 6 characters" })).toBe(false);
    expect(isAlreadyRegisteredError({ message: "Email rate limit exceeded" })).toBe(false);
    expect(isAlreadyRegisteredError({ code: "weak_password" })).toBe(false);
  });

  it("is safe on null/empty input", () => {
    expect(isAlreadyRegisteredError(null)).toBe(false);
    expect(isAlreadyRegisteredError(undefined)).toBe(false);
    expect(isAlreadyRegisteredError({})).toBe(false);
  });
});

describe("isNewUserSignup", () => {
  it("treats a non-empty identities array as a new user", () => {
    expect(isNewUserSignup(1)).toBe(true);
    expect(isNewUserSignup(2)).toBe(true);
  });

  it("treats an empty/absent identities array as NOT a new user (obscured existing email)", () => {
    expect(isNewUserSignup(0)).toBe(false);
    expect(isNewUserSignup(undefined)).toBe(false);
  });
});
