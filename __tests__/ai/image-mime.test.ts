/**
 * Unit coverage for isGeminiCompatibleImageUrl — the cheap URL-based filter
 * that drops image formats Gemini rejects (TIFF/BMP/RAW/SVG/…) BEFORE they
 * reach the vision API. A false negative (letting an unsupported format
 * through) triggers a 400 that tanks the whole multimodal batch; a false
 * positive (rejecting a valid URL) wastes a retrieval hint.
 *
 * The load-bearing behaviours:
 *  - extension match is on the URL PATHNAME, so a query string can't fake or
 *    hide an extension (`a.jpg?x=.svg` passes; `a.tiff?x=1` is rejected).
 *  - matching is case-insensitive.
 *  - a URL with no clear extension (typical CDN url) is passed through.
 *  - a non-URL string falls back to a raw suffix check instead of throwing.
 */
import { describe, it, expect } from "vitest";
import { isGeminiCompatibleImageUrl } from "@/lib/ai/image-mime";

describe("isGeminiCompatibleImageUrl", () => {
  it.each([null, undefined, ""])("rejects empty input (%s)", (v) => {
    expect(isGeminiCompatibleImageUrl(v)).toBe(false);
  });

  it.each([
    "https://cdn.example.com/a.tif",
    "https://cdn.example.com/a.tiff",
    "https://cdn.example.com/a.bmp",
    "https://cdn.example.com/a.svg",
    "https://cdn.example.com/a.ico",
    "https://cdn.example.com/a.raw",
    "https://cdn.example.com/a.dng",
    "https://cdn.example.com/a.psd",
    "https://cdn.example.com/a.cr2",
    "https://cdn.example.com/a.nef",
    "https://cdn.example.com/a.arw",
  ])("rejects the unsupported format %s", (url) => {
    expect(isGeminiCompatibleImageUrl(url)).toBe(false);
  });

  it.each([
    "https://cdn.example.com/a.jpg",
    "https://cdn.example.com/a.jpeg",
    "https://cdn.example.com/a.png",
    "https://cdn.example.com/a.webp",
    "https://cdn.example.com/a.gif",
    "https://cdn.example.com/a.heic",
  ])("accepts the supported format %s", (url) => {
    expect(isGeminiCompatibleImageUrl(url)).toBe(true);
  });

  it("matches the extension case-insensitively", () => {
    expect(isGeminiCompatibleImageUrl("https://cdn.example.com/PHOTO.TIF")).toBe(false);
    expect(isGeminiCompatibleImageUrl("https://cdn.example.com/PHOTO.PNG")).toBe(true);
  });

  it("passes through a URL with no file extension (CDN-style)", () => {
    expect(isGeminiCompatibleImageUrl("https://cdn.example.com/images/abc123")).toBe(true);
  });

  it("ignores a query string when deciding the extension", () => {
    // real ext is .png; the query only *mentions* .svg
    expect(isGeminiCompatibleImageUrl("https://cdn.example.com/a.png?fallback=.svg")).toBe(true);
    // a query cannot rescue an unsupported real extension
    expect(isGeminiCompatibleImageUrl("https://cdn.example.com/a.tiff?w=100")).toBe(false);
  });

  it("falls back to a raw suffix check for a non-URL string (no throw)", () => {
    expect(isGeminiCompatibleImageUrl("photo.bmp")).toBe(false);
    expect(isGeminiCompatibleImageUrl("photo.jpg")).toBe(true);
  });
});
