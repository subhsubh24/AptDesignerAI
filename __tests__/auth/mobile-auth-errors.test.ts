import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The NATIVE auth-error enumeration boundary (G4).
 *
 * Both Expo auth screens used to render Supabase's raw `error.message`, which
 * leaks which email addresses have accounts: GoTrue's "Email not confirmed" /
 * `user_banned` / `user_sso_managed` responses can only fire for an address that
 * ALREADY exists, and signUp's "User already registered" says so outright. The
 * fix routes both screens through `mobile/src/lib/auth/auth-errors.ts`, a
 * deliberate native mirror of the web modules (see that file's header for why it
 * is a copy and not an import).
 *
 * Two layers here, because they catch different regressions:
 *  1. BEHAVIOURAL tests of the classifier itself — an inverted condition inside
 *     `matches()` would leave every source literal intact, so only executing the
 *     functions catches it. These import mobile/ source directly, which works in
 *     CI only because `mobile/src/lib/auth/tsconfig.json` exists — see that file.
 *  2. A SOURCE ratchet over the two screens + the web modules — catches the
 *     leak being reintroduced at the CALL SITE (where there is no importable
 *     unit to assert on) and catches the mirror drifting from the web copies.
 */
import {
  AUTH_ERROR_CREDENTIALS,
  AUTH_ERROR_GENERIC,
  AUTH_ERROR_NETWORK,
  AUTH_ERROR_RATE_LIMITED,
  AUTH_ERROR_SIGNUP_GENERIC,
  isAlreadyRegisteredError,
  signInErrorMessage,
  signUpErrorMessage,
} from "../../mobile/src/lib/auth/auth-errors";

// Every outcome that can fire ONLY for an address that already has an account.
// If any of these gets its own message, an attacker can separate "registered"
// from "unknown" without ever guessing a password.
const EXISTENCE_ORACLES = [
  { label: "unconfirmed account", code: "email_not_confirmed", message: "Email not confirmed" },
  { label: "banned account", code: "user_banned", message: "User is banned" },
  {
    label: "SSO-provisioned account",
    code: "user_sso_managed",
    message: "Only a SSO authentication method is allowed for this user",
  },
];

const ALL_SIGNIN_MESSAGES = [
  AUTH_ERROR_CREDENTIALS,
  AUTH_ERROR_RATE_LIMITED,
  AUTH_ERROR_NETWORK,
  AUTH_ERROR_GENERIC,
];

describe("mobile signInErrorMessage — enumeration boundary", () => {
  it("gives a wrong password and an unknown email the SAME message", () => {
    // GoTrue returns invalid_credentials for BOTH, so the only way to keep them
    // indistinguishable is to never add a more specific message for either.
    expect(
      signInErrorMessage({ code: "invalid_credentials", message: "Invalid login credentials", status: 400 }),
    ).toBe(AUTH_ERROR_CREDENTIALS);
  });

  it.each(EXISTENCE_ORACLES)(
    "collapses the $label into the credential message (no existence oracle)",
    ({ code, message }) => {
      // Matched by code...
      expect(signInErrorMessage({ code, message, status: 400 })).toBe(AUTH_ERROR_CREDENTIALS);
      // ...and by message text alone, for a codeless/self-hosted GoTrue.
      expect(signInErrorMessage({ message })).toBe(AUTH_ERROR_CREDENTIALS);
    },
  );

  it("never lets an existence oracle reach the generic bucket", () => {
    // The regression this guards: on the web side `user_banned` once fell through
    // to GENERIC while wrong-password returned CREDENTIALS — a two-value oracle,
    // since a banned account must EXIST to be banned.
    for (const { code, message } of EXISTENCE_ORACLES) {
      expect(signInErrorMessage({ code, message, status: 400 })).not.toBe(AUTH_ERROR_GENERIC);
    }
  });

  it("never returns provider text for any input", () => {
    const provider = [
      { message: "Database error querying schema", status: 500 },
      { code: "invalid_credentials", message: "Invalid login credentials" },
      { message: "For security purposes, you can only request this after 33 seconds" },
      { name: "AuthRetryableFetchError", message: "Failed to fetch", status: 0 },
      { message: "Email not confirmed" },
      { message: "Only a SSO authentication method is allowed for this user" },
      {},
    ];
    for (const error of provider) {
      expect(ALL_SIGNIN_MESSAGES).toContain(signInErrorMessage(error));
    }
    expect(ALL_SIGNIN_MESSAGES).toContain(signInErrorMessage(null));
    expect(ALL_SIGNIN_MESSAGES).toContain(signInErrorMessage(undefined));
  });

  it("keeps rate-limit and network failures actionable", () => {
    expect(signInErrorMessage({ status: 429, message: "Too many requests" })).toBe(
      AUTH_ERROR_RATE_LIMITED,
    );
    expect(signInErrorMessage({ code: "over_request_rate_limit", message: "slow down" })).toBe(
      AUTH_ERROR_RATE_LIMITED,
    );
    // The screen's own 15s timeout throw lands in the catch and comes through here.
    expect(signInErrorMessage(new Error("Sign-in timed out. Check your connection."))).toBe(
      AUTH_ERROR_NETWORK,
    );
    expect(
      signInErrorMessage({ name: "AuthRetryableFetchError", message: "Failed to fetch", status: 0 }),
    ).toBe(AUTH_ERROR_NETWORK);
    expect(signInErrorMessage({ status: 503, message: "Service Unavailable" })).toBe(
      AUTH_ERROR_NETWORK,
    );
  });

  it("prefers the credential bucket over rate-limit/network classification", () => {
    // Ordering guard: a 5xx- or rate-limit-shaped response that ALSO carries an
    // enumeration-sensitive code must still read as credentials, so a provider
    // wording change can't reclassify a leak into a chattier bucket.
    expect(signInErrorMessage({ code: "email_not_confirmed", status: 503 })).toBe(
      AUTH_ERROR_CREDENTIALS,
    );
    expect(signInErrorMessage({ code: "user_banned", status: 429 })).toBe(AUTH_ERROR_CREDENTIALS);
  });

  it("matches codes case-insensitively", () => {
    expect(signInErrorMessage({ code: "USER_BANNED" })).toBe(AUTH_ERROR_CREDENTIALS);
    expect(signInErrorMessage({ message: "EMAIL NOT CONFIRMED" })).toBe(AUTH_ERROR_CREDENTIALS);
  });
});

describe("mobile isAlreadyRegisteredError — signup enumeration boundary", () => {
  it("detects an already-registered address by code and by message", () => {
    expect(isAlreadyRegisteredError({ code: "user_already_exists" })).toBe(true);
    expect(isAlreadyRegisteredError({ code: "email_exists" })).toBe(true);
    expect(isAlreadyRegisteredError({ message: "User already registered" })).toBe(true);
    expect(isAlreadyRegisteredError({ message: "A user with this email already exists" })).toBe(true);
    expect(isAlreadyRegisteredError({ code: "EMAIL_EXISTS" })).toBe(true);
  });

  it("does not fire for unrelated signup failures", () => {
    expect(isAlreadyRegisteredError({ message: "Password should be at least 6 characters" })).toBe(false);
    expect(isAlreadyRegisteredError({ status: 429, message: "Too many requests" })).toBe(false);
    expect(isAlreadyRegisteredError(null)).toBe(false);
    expect(isAlreadyRegisteredError(undefined)).toBe(false);
    expect(isAlreadyRegisteredError({})).toBe(false);
  });
});

describe("mobile signUpErrorMessage", () => {
  const ALL_SIGNUP_MESSAGES = [AUTH_ERROR_RATE_LIMITED, AUTH_ERROR_NETWORK, AUTH_ERROR_SIGNUP_GENERIC];

  it("never returns provider text", () => {
    for (const error of [
      { message: "Database error saving new user", status: 500 },
      { message: "Password should be at least 6 characters" },
      { status: 429, message: "email rate limit exceeded" },
      {},
    ]) {
      expect(ALL_SIGNUP_MESSAGES).toContain(signUpErrorMessage(error));
    }
    expect(ALL_SIGNUP_MESSAGES).toContain(signUpErrorMessage(null));
  });

  it("keeps rate-limit and network failures actionable", () => {
    expect(signUpErrorMessage({ code: "over_email_send_rate_limit", message: "wait" })).toBe(
      AUTH_ERROR_RATE_LIMITED,
    );
    expect(signUpErrorMessage(new Error("Sign-up timed out. Check your connection."))).toBe(
      AUTH_ERROR_NETWORK,
    );
  });

  it("collapses everything else into one neutral message", () => {
    expect(signUpErrorMessage({ message: "Database error saving new user", status: 422 })).toBe(
      AUTH_ERROR_SIGNUP_GENERIC,
    );
  });
});

// ── Source ratchet: the CALL SITES, and mirror drift ─────────────────────────
// These cover what a unit test cannot reach — the screens have no importable
// classifier surface, and the web/native copies can only be compared as text.

const repoRoot = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(repoRoot, rel), "utf8");

const MOBILE_MODULE = "mobile/src/lib/auth/auth-errors.ts";
const WEB_LOGIN_MODULE = "lib/auth/login-errors.ts";
const WEB_SIGNUP_MODULE = "lib/auth/signup-errors.ts";
const LOGIN_SCREEN = "mobile/src/components/auth/login-screen.tsx";
const SIGNUP_SCREEN = "mobile/src/components/auth/signup-screen.tsx";

/** Pull the string literals out of a `const NAME = new Set([...])` declaration. */
function setLiterals(source: string, name: string): string[] {
  const match = new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\)`).exec(source);
  if (!match) throw new Error(`${name} not found — the ratchet needs updating, not deleting`);
  return [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]).sort();
}

/** Pull the string literals out of a `const NAME = [...]` array declaration. */
function arrayLiterals(source: string, name: string): string[] {
  const match = new RegExp(`const ${name} = \\[([\\s\\S]*?)\\]`).exec(source);
  if (!match) throw new Error(`${name} not found — the ratchet needs updating, not deleting`);
  return [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]).sort();
}

describe("native auth-error classifier — no drift from the web modules", () => {
  const mobile = read(MOBILE_MODULE);

  // The credential bucket IS the enumeration boundary: every code in it is an
  // outcome that can fire only for an address that already has an account. A
  // code present on the web and missing here is a leak the web app has closed
  // and the native app has not.
  it("carries every credential code the web sign-in module carries", () => {
    expect(setLiterals(mobile, "CREDENTIAL_CODES")).toEqual(
      setLiterals(read(WEB_LOGIN_MODULE), "CREDENTIAL_CODES"),
    );
  });

  it("carries every codeless-fallback credential pattern the web module carries", () => {
    expect(arrayLiterals(mobile, "CREDENTIAL_PATTERNS")).toEqual(
      arrayLiterals(read(WEB_LOGIN_MODULE), "CREDENTIAL_PATTERNS"),
    );
  });

  it("carries every already-registered code/pattern the web signup module carries", () => {
    const web = read(WEB_SIGNUP_MODULE);
    expect(setLiterals(mobile, "ALREADY_REGISTERED_CODES")).toEqual(
      setLiterals(web, "ALREADY_REGISTERED_CODES"),
    );
    expect(arrayLiterals(mobile, "ALREADY_REGISTERED_PATTERNS")).toEqual(
      arrayLiterals(web, "ALREADY_REGISTERED_PATTERNS"),
    );
  });
});

describe("native auth screens — no raw provider text reaches the user", () => {
  it.each([
    ["sign-in", LOGIN_SCREEN],
    ["sign-up", SIGNUP_SCREEN],
  ])("the %s screen never renders a raw error message", (_label, file) => {
    const source = read(file);
    // An ALLOWLIST, not a denylist — every `setError(...)` argument must be one
    // of three safe shapes: our own literal copy, `null` (clearing the box), or a
    // call to the classifier.
    //
    // Deliberately not a search for leaky patterns. A denylist has to enumerate
    // every way provider text can reach the call, and the ways are open-ended:
    // `authError.message`, a renamed local, `(authError as {...}).message` (whose
    // inner paren defeats a `[^)]*` class), `authError['message']`,
    // `JSON.stringify(authError)`, `String(authError)`, or any indirection
    // through a variable assigned earlier. The set of SAFE shapes is finite, so
    // that is the invariant asserted here: a new legitimate shape has to be added
    // to this list deliberately, which is the point.
    // The argument is bounded to its OWN matching close-paren and matched
    // WHOLE (^…$). A start-anchored search over the rest of the file would only
    // prove the argument BEGINS with something safe, which
    // `setError(signInErrorMessage(authError) + authError.message)` and
    // `setError("Sign-in failed: " + authError.message)` both satisfy while
    // leaking the full provider string.
    //
    // A template literal counts as a literal only if it INTERPOLATES NOTHING
    // (`$` not followed by `{`) — otherwise `` `${authError.message}` `` reads as
    // plain copy to any matcher.
    const LITERAL = /^\s*(?:'[^']*'|"[^"]*"|`(?:[^`$]|\$(?!\{))*`|null)\s*$/;
    const CLASSIFIER = /^\s*(?:signInErrorMessage|signUpErrorMessage)\(/;

    /** Text between `(` at `open` and its matching `)`, quote-aware. */
    function argAt(src: string, open: number): string {
      let depth = 0;
      let quote: string | null = null;
      for (let i = open; i < src.length; i++) {
        const c = src[i];
        if (quote) {
          if (c === "\\") i++;
          else if (c === quote) quote = null;
          continue;
        }
        if (c === "'" || c === '"' || c === "`") quote = c;
        else if (c === "(") depth++;
        else if (c === ")" && --depth === 0) return src.slice(open + 1, i);
      }
      throw new Error(`unbalanced setError( in ${file}`);
    }

    const calls = [...source.matchAll(/setError\(/g)];
    // Guard the guard: if setError is renamed away this must fail loudly rather
    // than vacuously pass over an empty match list.
    expect(calls.length, `no setError( calls found in ${file} — update this guard`).toBeGreaterThan(1);
    for (const match of calls) {
      const arg = argAt(source, match.index + "setError".length);
      const why = `unsafe setError argument in ${file}: ${arg.slice(0, 90)}`;
      if (LITERAL.test(arg)) continue;
      // Otherwise it must be EXACTLY one classifier call — nothing appended.
      expect(arg, why).toMatch(CLASSIFIER);
      const callOpen = arg.indexOf("(");
      expect(arg.slice(callOpen + argAt(arg, callOpen).length + 2).trim(), why).toBe("");
    }
  });

  it("the sign-in screen classifies through the shared module", () => {
    const source = read(LOGIN_SCREEN);
    expect(source).toContain("signInErrorMessage");
    expect(source).toContain("@/lib/auth/auth-errors");
  });

  it("the sign-up screen shows an already-registered address the NEUTRAL success screen", () => {
    const source = read(SIGNUP_SCREEN);
    expect(source).toContain("isAlreadyRegisteredError");
    expect(source).toContain("@/lib/auth/auth-errors");
    // The masking must set the same success state a brand-new signup reaches —
    // an already-registered address must be INDISTINGUISHABLE, so it must never
    // be routed into setError at all.
    expect(source).toMatch(
      /if \(isAlreadyRegisteredError\(authError\)\) \{\s*(?:\/\/[^\n]*\n\s*)*setSuccess\(true\);/,
    );
  });
});
