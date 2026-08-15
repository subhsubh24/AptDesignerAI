import { describe, it, expect } from "vitest";
import { isAcceptableStoredImageUrl, canOptimizeImageHost } from "@/lib/utils/image-url";

describe("isAcceptableStoredImageUrl", () => {
  it("accepts the internal same-origin storage path from getPublicUrl", () => {
    // The memory-store data layer returns `/uploads/<bucket>/<path>`.
    expect(isAcceptableStoredImageUrl("/uploads/room-photos/user/photo.jpg")).toBe(true);
    expect(isAcceptableStoredImageUrl("/anything/else.png")).toBe(true);
  });

  it("accepts an absolute https URL (real Supabase Storage)", () => {
    expect(isAcceptableStoredImageUrl("https://abc.supabase.co/storage/v1/object/public/x.jpg")).toBe(true);
  });

  it("rejects protocol-relative //host paths (off-origin when rendered)", () => {
    expect(isAcceptableStoredImageUrl("//evil.com/x.jpg")).toBe(false);
  });

  it("rejects leading-slash values the URL parser normalizes off-origin (backslash / tab / newline)", () => {
    // Browsers + the WHATWG URL parser treat these as an off-origin host even
    // though they start with a single '/', so a naive !startsWith('//') check
    // would wrongly accept them.
    expect(isAcceptableStoredImageUrl("/\\evil.com/x.jpg")).toBe(false);
    expect(isAcceptableStoredImageUrl("/\t/evil.com/x.jpg")).toBe(false);
    expect(isAcceptableStoredImageUrl("/\n/evil.com/x.jpg")).toBe(false);
    expect(isAcceptableStoredImageUrl("/\r/evil.com/x.jpg")).toBe(false);
  });

  it("rejects non-https and active-content schemes", () => {
    expect(isAcceptableStoredImageUrl("http://example.com/x.jpg")).toBe(false);
    expect(isAcceptableStoredImageUrl("javascript:alert(1)")).toBe(false);
    expect(isAcceptableStoredImageUrl("data:image/png;base64,AAAA")).toBe(false);
    expect(isAcceptableStoredImageUrl("ftp://host/x.jpg")).toBe(false);
  });

  it("rejects empty / non-string / unparseable values", () => {
    expect(isAcceptableStoredImageUrl("")).toBe(false);
    // @ts-expect-error runtime guard against a non-string
    expect(isAcceptableStoredImageUrl(null)).toBe(false);
    expect(isAcceptableStoredImageUrl("not a url")).toBe(false);
  });
});

describe("canOptimizeImageHost", () => {
  it("accepts an internal same-origin storage path", () => {
    expect(canOptimizeImageHost("/uploads/room-photos/user/photo.jpg")).toBe(true);
  });

  it("rejects leading-slash values the URL parser normalizes off-origin — the exact class next/image would server-side-fetch if this were wrong", () => {
    // These must be rejected the same way isAcceptableStoredImageUrl rejects
    // them: a bare `startsWith("/")` check would wrongly send them through
    // next/image's server-side image-optimizer fetch instead of a plain <img>.
    expect(canOptimizeImageHost("//evil.com/x.jpg")).toBe(false);
    expect(canOptimizeImageHost("/\\evil.com/x.jpg")).toBe(false);
    expect(canOptimizeImageHost("/\t/evil.com/x.jpg")).toBe(false);
    expect(canOptimizeImageHost("/\n/evil.com/x.jpg")).toBe(false);
    expect(canOptimizeImageHost("/\r/evil.com/x.jpg")).toBe(false);
  });

  it("accepts an https URL on an allowlisted host", () => {
    expect(canOptimizeImageHost("https://abc.supabase.co/storage/v1/object/public/x.jpg")).toBe(true);
    expect(canOptimizeImageHost("https://lh3.googleusercontent.com/x.jpg")).toBe(true);
  });

  it("rejects an allowlisted host over http (next.config.ts's pattern is https-only)", () => {
    expect(canOptimizeImageHost("http://abc.supabase.co/x.jpg")).toBe(false);
  });

  it("rejects a non-allowlisted (e.g. arbitrary retailer) host", () => {
    expect(canOptimizeImageHost("https://images.somerandomretailer.com/x.jpg")).toBe(false);
  });

  it("is not fooled by a subdomain-suffix or subdomain-prefix trick", () => {
    expect(canOptimizeImageHost("https://evilsupabase.co/x.jpg")).toBe(false);
    expect(canOptimizeImageHost("https://supabase.co.evil.com/x.jpg")).toBe(false);
  });

  it("rejects empty / unparseable values", () => {
    expect(canOptimizeImageHost("")).toBe(false);
    expect(canOptimizeImageHost("not a url")).toBe(false);
  });
});
