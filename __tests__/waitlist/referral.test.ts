import { describe, it, expect } from "vitest";
import {
  generateReferralCode,
  sanitizeReferralCode,
  buildReferralShareUrl,
} from "@/lib/waitlist/referral";

describe("generateReferralCode", () => {
  it("produces an 8-char code from the unambiguous alphabet", () => {
    const code = generateReferralCode();
    expect(code).toHaveLength(8);
    // No ambiguous glyphs (I/L/O/0/1) and only the allowed alphabet.
    expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
  });

  it("honours a custom length", () => {
    expect(generateReferralCode(12)).toHaveLength(12);
  });

  it("is overwhelmingly unique across many draws", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) seen.add(generateReferralCode());
    // Collisions in 2000 draws over a ~6.5e11 space should not happen.
    expect(seen.size).toBe(2000);
  });
});

describe("sanitizeReferralCode", () => {
  it("normalises a valid code to upper case", () => {
    expect(sanitizeReferralCode("ab23cd45")).toBe("AB23CD45");
    expect(sanitizeReferralCode("  XY9Z  ")).toBe("XY9Z");
  });

  it("rejects non-strings, empty, too-short, too-long, and junk input", () => {
    expect(sanitizeReferralCode(null)).toBeNull();
    expect(sanitizeReferralCode(undefined)).toBeNull();
    expect(sanitizeReferralCode(12345)).toBeNull();
    expect(sanitizeReferralCode("")).toBeNull();
    expect(sanitizeReferralCode("abc")).toBeNull(); // < 4
    expect(sanitizeReferralCode("A".repeat(17))).toBeNull(); // > 16
    expect(sanitizeReferralCode("bad code!")).toBeNull(); // space + punctuation
    expect(sanitizeReferralCode("../../etc")).toBeNull(); // injection-shaped
  });
});

describe("buildReferralShareUrl", () => {
  it("builds an absolute /waitlist link and trims a trailing slash on the origin", () => {
    expect(buildReferralShareUrl("https://aptdesignerai.com", "ABCD1234")).toBe(
      "https://aptdesignerai.com/waitlist?ref=ABCD1234",
    );
    expect(buildReferralShareUrl("https://aptdesignerai.com/", "ABCD1234")).toBe(
      "https://aptdesignerai.com/waitlist?ref=ABCD1234",
    );
  });
});
