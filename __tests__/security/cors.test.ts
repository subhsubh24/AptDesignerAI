import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextResponse } from "next/server";
import {
  applyCorsHeaders,
  corsHeadersFor,
  getAllowedOrigins,
  isAllowedOrigin,
} from "@/lib/security/cors";

describe("lib/security/cors", () => {
  const orig = process.env.NEXT_PUBLIC_SITE_URL;
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://aptdesignerai.com";
  });
  afterEach(() => {
    if (orig === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = orig;
  });

  it("includes the env site origin and localhost in the allowlist", () => {
    const allowed = getAllowedOrigins();
    expect(allowed.has("https://aptdesignerai.com")).toBe(true);
    expect(allowed.has("http://localhost:3000")).toBe(true);
  });

  it("normalizes a trailing slash when matching", () => {
    expect(isAllowedOrigin("https://aptdesignerai.com/")).toBe(true);
    expect(isAllowedOrigin("https://aptdesignerai.com")).toBe(true);
  });

  it("rejects an unknown origin and a null origin", () => {
    expect(isAllowedOrigin("https://evil.example.com")).toBe(false);
    expect(isAllowedOrigin(null)).toBe(false);
    expect(isAllowedOrigin(undefined)).toBe(false);
  });

  it("reflects the exact origin for an allowlisted request and never uses a wildcard", () => {
    const headers = corsHeadersFor("https://aptdesignerai.com");
    expect(headers["Access-Control-Allow-Origin"]).toBe("https://aptdesignerai.com");
    expect(headers["Access-Control-Allow-Origin"]).not.toBe("*");
    expect(headers["Access-Control-Allow-Credentials"]).toBe("true");
    expect(headers.Vary).toBe("Origin");
  });

  it("emits NO Access-Control-Allow-Origin for a disallowed origin (browser blocks the read)", () => {
    const headers = corsHeadersFor("https://evil.example.com");
    expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
    // Vary is still set so caches don't leak an allowlisted response cross-origin.
    expect(headers.Vary).toBe("Origin");
  });

  it("applyCorsHeaders mutates the response headers for an allowlisted origin", () => {
    const res = NextResponse.json({ ok: true });
    applyCorsHeaders(res, "https://aptdesignerai.com");
    expect(res.headers.get("access-control-allow-origin")).toBe("https://aptdesignerai.com");
  });

  it("applyCorsHeaders sets no ACAO for a disallowed origin", () => {
    const res = NextResponse.json({ ok: true });
    applyCorsHeaders(res, "https://evil.example.com");
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});
