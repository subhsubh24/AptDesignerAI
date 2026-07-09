import { describe, it, expect } from "vitest";
import { isAcceptableStoredImageUrl } from "@/lib/utils/image-url";

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
