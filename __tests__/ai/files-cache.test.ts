import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Files API cache tests. We don't exercise the real Gemini upload — we stub
// the GoogleGenAI client so tests stay offline and deterministic.

const uploadMock = vi.fn();
const fetchMock = vi.fn();

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    files = { upload: (...args: unknown[]) => uploadMock(...args) };
  },
}));

describe("files-cache", () => {
  const ORIGINAL_FETCH = globalThis.fetch;

  beforeEach(async () => {
    vi.resetModules();
    uploadMock.mockReset();
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
  });

  function okResponse(mime = "image/png") {
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({ "content-type": mime }),
      arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
    } as unknown as Response;
  }

  it("uploads once and returns a cached handle on subsequent calls", async () => {
    fetchMock.mockResolvedValue(okResponse());
    uploadMock.mockResolvedValue({
      uri: "https://generativelanguage.googleapis.com/v1beta/files/abc",
      name: "files/abc",
      mimeType: "image/png",
    });

    const { getOrUploadFile, __resetFilesCacheForTests } = await import("@/lib/ai/files-cache");
    __resetFilesCacheForTests();

    const first = await getOrUploadFile("https://example.com/floor-plan.png");
    const second = await getOrUploadFile("https://example.com/floor-plan.png");

    expect(first?.uri).toBe("https://generativelanguage.googleapis.com/v1beta/files/abc");
    expect(second).toEqual(first);
    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("dedupes concurrent in-flight uploads for the same URL", async () => {
    fetchMock.mockResolvedValue(okResponse());
    uploadMock.mockResolvedValue({
      uri: "https://generativelanguage.googleapis.com/v1beta/files/abc",
      name: "files/abc",
      mimeType: "image/png",
    });

    const { getOrUploadFile, __resetFilesCacheForTests } = await import("@/lib/ai/files-cache");
    __resetFilesCacheForTests();

    const [a, b, c] = await Promise.all([
      getOrUploadFile("https://example.com/same.png"),
      getOrUploadFile("https://example.com/same.png"),
      getOrUploadFile("https://example.com/same.png"),
    ]);

    expect(a?.uri).toBe("https://generativelanguage.googleapis.com/v1beta/files/abc");
    expect(b).toEqual(a);
    expect(c).toEqual(a);
    expect(uploadMock).toHaveBeenCalledTimes(1);
  });

  it("returns null on upload failure and evicts so the next call retries", async () => {
    fetchMock.mockResolvedValue(okResponse());
    uploadMock
      .mockRejectedValueOnce(new Error("quota exceeded"))
      .mockResolvedValueOnce({
        uri: "https://generativelanguage.googleapis.com/v1beta/files/recovered",
        name: "files/recovered",
        mimeType: "image/png",
      });

    const { getOrUploadFile, __resetFilesCacheForTests } = await import("@/lib/ai/files-cache");
    __resetFilesCacheForTests();

    const first = await getOrUploadFile("https://example.com/flaky.png");
    expect(first).toBeNull();

    const second = await getOrUploadFile("https://example.com/flaky.png");
    expect(second?.uri).toBe("https://generativelanguage.googleapis.com/v1beta/files/recovered");
    expect(uploadMock).toHaveBeenCalledTimes(2);
  });

  it("returns null when fetch fails (HTTP error)", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      headers: new Headers(),
      arrayBuffer: async () => new ArrayBuffer(0),
    } as unknown as Response);

    const { getOrUploadFile, __resetFilesCacheForTests } = await import("@/lib/ai/files-cache");
    __resetFilesCacheForTests();

    const result = await getOrUploadFile("https://example.com/missing.png");
    expect(result).toBeNull();
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("handles empty source URLs gracefully", async () => {
    const { getOrUploadFile, __resetFilesCacheForTests } = await import("@/lib/ai/files-cache");
    __resetFilesCacheForTests();

    const result = await getOrUploadFile("");
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(uploadMock).not.toHaveBeenCalled();
  });
});
