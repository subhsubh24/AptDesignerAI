import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  isAlreadyExistsError,
  mockupStoragePath,
  uploadMockupImage,
} from "@/lib/storage/mockup-upload";

/**
 * Regression guard for the mockup re-render defect.
 *
 * Mockup storage paths are DETERMINISTIC — `mockups/<cacheKey>.png`, or a
 * sha256 of the bytes when no cache key is supplied. So re-rendering the same
 * mockup targets a path that already holds that exact image, and the upload
 * (`upsert: false`) is rejected as a duplicate. The route used to answer that
 * by returning `data:image/png;base64,<the whole image>`, which is then
 * persisted into `mockups.result_image_url` and handed to the client where a
 * URL belongs.
 *
 * This is the COMMON production path, not an edge case: the only short-circuit
 * ahead of the upload (`findCachedMockup` in app/api/mockups/route.ts) reads
 * the LOCAL filesystem, which is empty on serverless. It stayed invisible
 * because the memory-store storage mock overwrites rather than rejecting
 * (lib/store/memory-store.ts), so no test or local run ever produced the error.
 */

const PNG_BASE64 = Buffer.from("fake-png-bytes").toString("base64");

/** supabase.storage stub whose upload returns `uploadError` (null = success). */
function storageStub(uploadError: unknown, publicUrl = "https://cdn.example.com/signed.png") {
  const getPublicUrl = vi.fn((p: string) => ({ data: { publicUrl: `${publicUrl}?p=${p}` } }));
  const upload = vi.fn(async () => ({
    data: uploadError ? null : { path: "mockups/deadbeef.png" },
    error: uploadError,
  }));
  return {
    storage: { from: vi.fn(() => ({ upload, getPublicUrl })) },
    _upload: upload,
    _getPublicUrl: getPublicUrl,
  };
}

describe("isAlreadyExistsError", () => {
  // A StorageApiError's `statusCode` carries the BODY's statusCode/code, not the
  // numeric HTTP status. These are the shapes Supabase actually returns for a
  // duplicate upload — matching "409" instead would miss both of them.
  it("matches the CURRENT documented duplicate shape (KeyAlreadyExists)", () => {
    expect(
      isAlreadyExistsError({
        statusCode: "KeyAlreadyExists",
        error: "Duplicate",
        message: "The resource already exists",
      }),
    ).toBe(true);
    expect(isAlreadyExistsError({ code: "KeyAlreadyExists" })).toBe(true);
  });

  it("matches the LEGACY documented duplicate shape (already_exists)", () => {
    expect(
      isAlreadyExistsError({
        statusCode: "already_exists",
        message: "Indicates that the resource already exists.",
      }),
    ).toBe(true);
  });

  it("matches on message text as a last-resort fallback", () => {
    expect(isAlreadyExistsError({ message: "The resource already exists" })).toBe(true);
    expect(isAlreadyExistsError({ error: "Duplicate", message: "" })).toBe(true);
  });

  it("does NOT match genuine failures — those must keep the data-URI fallback", () => {
    expect(isAlreadyExistsError({ statusCode: "500", message: "Internal error" })).toBe(false);
    expect(isAlreadyExistsError({ statusCode: "403", message: "new row violates policy" })).toBe(false);
    expect(isAlreadyExistsError({ message: "fetch failed" })).toBe(false);
    expect(isAlreadyExistsError(null)).toBe(false);
    expect(isAlreadyExistsError("KeyAlreadyExists")).toBe(false);
  });

  it("does NOT match a bare 409 — an unrelated conflict must not fabricate a URL", () => {
    // getPublicUrl never verifies the object exists, so a false positive would
    // hand back a link to nothing. A 409 that is not a documented duplicate code
    // must fall through to the data URI.
    expect(isAlreadyExistsError({ statusCode: "409", message: "Conflict" })).toBe(false);
    expect(isAlreadyExistsError({ statusCode: 409, message: "Conflict" })).toBe(false);
  });
});

describe("mockupStoragePath", () => {
  it("is stable for a given cache key — which is what makes the 409 reachable", () => {
    const a = mockupStoragePath(Buffer.from("one"), "image/png", "abc123");
    const b = mockupStoragePath(Buffer.from("totally different bytes"), "image/png", "abc123");
    expect(a).toBe("mockups/abc123.png");
    expect(b).toBe(a);
  });

  it("falls back to a content hash when no cache key is given", () => {
    const a = mockupStoragePath(Buffer.from("one"), "image/png");
    const b = mockupStoragePath(Buffer.from("one"), "image/png");
    const c = mockupStoragePath(Buffer.from("two"), "image/png");
    expect(a).toBe(b);
    expect(c).not.toBe(a);
  });

  it("uses the jpg extension for jpeg mime types", () => {
    expect(mockupStoragePath(Buffer.from("x"), "image/jpeg", "k")).toBe("mockups/k.jpg");
  });
});

describe("uploadMockupImage", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the public URL on a successful upload", async () => {
    const sb = storageStub(null);
    const url = await uploadMockupImage(sb, PNG_BASE64, "image/png", "abc123");
    expect(url).toContain("https://cdn.example.com/signed.png");
    expect(url.startsWith("data:")).toBe(false);
  });

  it("re-renders resolve to the STORED image's URL, not an inline data URI", async () => {
    // This is the assertion the fix exists for. Pre-fix this returned
    // `data:image/png;base64,...`.
    const sb = storageStub({ statusCode: "KeyAlreadyExists", message: "The resource already exists" });
    const url = await uploadMockupImage(sb, PNG_BASE64, "image/png", "abc123");

    expect(url.startsWith("data:")).toBe(false);
    expect(url).toContain("https://cdn.example.com/signed.png");
    // and it must resolve the URL for the DETERMINISTIC path, since the upload
    // returned no `data.path` to read it from.
    expect(sb._getPublicUrl).toHaveBeenCalledWith("mockups/abc123.png");
  });

  it("resolves the content-hashed path when a duplicate lands with no cache key", async () => {
    const sb = storageStub({ statusCode: "already_exists", message: "Duplicate" });
    const expected = mockupStoragePath(Buffer.from(PNG_BASE64, "base64"), "image/png");
    const url = await uploadMockupImage(sb, PNG_BASE64, "image/png");
    expect(url.startsWith("data:")).toBe(false);
    expect(sb._getPublicUrl).toHaveBeenCalledWith(expected);
  });

  it("STILL falls back to a data URI on a genuine upload failure", async () => {
    // The fallback is deliberately preserved — returning something the client
    // can render beats failing the render outright when storage is really down.
    const sb = storageStub({ statusCode: "500", message: "storage unavailable" });
    const url = await uploadMockupImage(sb, PNG_BASE64, "image/png", "abc123");
    expect(url).toBe(`data:image/png;base64,${PNG_BASE64}`);
  });

  it("falls back to a data URI if a duplicate somehow yields no public URL", async () => {
    const getPublicUrl = vi.fn(() => ({ data: { publicUrl: "" } }));
    const sb = {
      storage: {
        from: vi.fn(() => ({
          upload: vi.fn(async () => ({ data: null, error: { statusCode: "KeyAlreadyExists", message: "Duplicate" } })),
          getPublicUrl,
        })),
      },
    };
    const url = await uploadMockupImage(sb, PNG_BASE64, "image/png", "abc123");
    expect(url).toBe(`data:image/png;base64,${PNG_BASE64}`);
  });
});
