import { describe, it, expect } from "vitest";
import { validateExternalUrl } from "@/lib/utils/url-validator";

/**
 * Unit coverage for the SSRF guard that fronts every server-side fetch of a
 * user-supplied URL (e.g. app/api/products/ingest). The security value is in the
 * BOUNDARIES: a one-character regression (172.16–31 range slipping, an "fc"/"fd"
 * ULA prefix missed, a non-http scheme allowed) reopens the SSRF hole this
 * function exists to close. These tests pin the exact allow/deny edges so such a
 * regression fails loudly rather than silently.
 */
describe("validateExternalUrl", () => {
  describe("malformed input + scheme", () => {
    it("rejects a non-URL string", () => {
      const r = validateExternalUrl("not a url");
      expect(r.valid).toBe(false);
      expect(r.error).toMatch(/invalid url/i);
    });

    it.each(["ftp://example.com/x", "file:///etc/passwd", "gopher://example.com"])(
      "rejects the non-HTTP(S) scheme %s",
      (u) => {
        const r = validateExternalUrl(u);
        expect(r.valid).toBe(false);
        expect(r.error).toMatch(/http/i);
      },
    );

    it("accepts both http: and https:", () => {
      expect(validateExternalUrl("http://example.com").valid).toBe(true);
      expect(validateExternalUrl("https://example.com").valid).toBe(true);
    });
  });

  describe("named internal hosts (deny)", () => {
    it.each([
      "http://localhost/",
      "http://localhost:8080/admin",
      "https://metadata.google.internal/computeMetadata/v1/",
      "http://169.254.169.254/latest/meta-data/",
      "http://0.0.0.0/",
      "http://127.0.0.1/",
    ])("blocks %s", (u) => {
      const r = validateExternalUrl(u);
      expect(r.valid).toBe(false);
      expect(r.error).toMatch(/internal\/private/i);
    });
  });

  describe("IPv4 private ranges (deny)", () => {
    it.each([
      "http://10.0.0.1/",
      "http://10.255.255.255/",
      "http://172.16.0.1/",
      "http://172.31.255.255/",
      "http://192.168.1.1/",
      "http://127.5.5.5/",
      "http://169.254.1.1/",
      "http://0.1.2.3/",
    ])("blocks the private/internal address %s", (u) => {
      expect(validateExternalUrl(u).valid).toBe(false);
    });
  });

  describe("IPv4 boundary addresses that are PUBLIC (allow)", () => {
    // The exact edges of the private ranges — a mutation that widens the check
    // (e.g. `b >= 15` instead of `>= 16`, or `a === 192` without `b === 168`)
    // would wrongly block these real public addresses.
    it.each([
      "http://172.15.0.1/", // just below the 172.16–31 block
      "http://172.32.0.1/", // just above it
      "http://192.167.1.1/", // 192.x but not 192.168
      "http://192.169.1.1/",
      "http://11.0.0.1/", // adjacent to the 10.x block
      "http://9.255.255.255/",
      "http://8.8.8.8/", // public DNS
      "http://126.0.0.1/", // adjacent to 127.x loopback
      "http://128.0.0.1/",
      "http://1.2.3.4/",
    ])("allows the public address %s", (u) => {
      expect(validateExternalUrl(u).valid).toBe(true);
    });
  });

  describe("IPv6 (deny private, allow public)", () => {
    it.each([
      "http://[::1]/", // loopback
      "http://[fc00::1]/", // ULA
      "http://[fd12:3456::1]/", // ULA
      "http://[fe80::1]/", // link-local
    ])("blocks the private IPv6 %s", (u) => {
      expect(validateExternalUrl(u).valid).toBe(false);
    });

    it("allows a public IPv6 address", () => {
      // A global-unicast address must not be caught by the fc/fd/fe80 prefixes.
      expect(validateExternalUrl("http://[2606:4700:4700::1111]/").valid).toBe(true);
    });
  });

  describe("credentials in the URL (deny)", () => {
    it("blocks a URL carrying a username/password on an otherwise-public host", () => {
      const r = validateExternalUrl("https://user:pass@example.com/");
      expect(r.valid).toBe(false);
      expect(r.error).toMatch(/credentials/i);
    });

    it("blocks a URL with only a username", () => {
      expect(validateExternalUrl("https://user@example.com/").valid).toBe(false);
    });
  });

  describe("happy path", () => {
    it("returns the parsed URL for a plain public https link", () => {
      const r = validateExternalUrl("https://shop.example.com/products/123?ref=abc");
      expect(r.valid).toBe(true);
      expect(r.error).toBeUndefined();
      expect(r.url).toBeInstanceOf(URL);
      expect(r.url?.hostname).toBe("shop.example.com");
    });
  });
});
