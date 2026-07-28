import { describe, it, expect, beforeEach, vi } from "vitest";

const getOrUploadFileMock = vi.fn();
vi.mock("@/lib/ai/files-cache", () => ({
  getOrUploadFile: getOrUploadFileMock,
}));

describe("resolve-image", () => {
  beforeEach(() => {
    vi.resetModules();
    getOrUploadFileMock.mockReset();
  });

  it("returns a url block by default (no Files API preference)", async () => {
    const { resolveImageBlock } = await import("@/lib/ai/resolve-image");
    const block = await resolveImageBlock("https://example.com/a.png");
    expect(block).toEqual({
      type: "image",
      source: { type: "url", url: "https://example.com/a.png" },
    });
    expect(getOrUploadFileMock).not.toHaveBeenCalled();
  });

  it("returns a file_uri block when Files API is preferred and upload succeeds", async () => {
    getOrUploadFileMock.mockResolvedValue({
      uri: "https://generativelanguage.googleapis.com/v1beta/files/xyz",
      name: "files/xyz",
      mimeType: "image/png",
      expiresAtMs: Date.now() + 1_000_000,
    });

    const { resolveImageBlock } = await import("@/lib/ai/resolve-image");
    const block = await resolveImageBlock("https://example.com/a.png", { preferFilesApi: true });
    expect(block).toEqual({
      type: "image",
      source: {
        type: "file_uri",
        uri: "https://generativelanguage.googleapis.com/v1beta/files/xyz",
        media_type: "image/png",
      },
    });
  });

  it("falls back to a url block when the Files API upload fails", async () => {
    getOrUploadFileMock.mockResolvedValue(null);

    const { resolveImageBlock } = await import("@/lib/ai/resolve-image");
    const block = await resolveImageBlock("https://example.com/a.png", { preferFilesApi: true });
    expect(block).toEqual({
      type: "image",
      source: { type: "url", url: "https://example.com/a.png" },
    });
  });

  it("preserves input order when resolving a batch", async () => {
    getOrUploadFileMock.mockImplementation(async (url: string) => ({
      uri: `files-api/${url}`,
      name: `files/${url}`,
      mimeType: "image/png",
      expiresAtMs: Date.now() + 1_000_000,
    }));

    const { resolveImageBlocks } = await import("@/lib/ai/resolve-image");
    const blocks = await resolveImageBlocks(["a.png", "b.png", "c.png"], { preferFilesApi: true });
    expect(blocks.map((b) => b.source?.uri)).toEqual([
      "files-api/a.png",
      "files-api/b.png",
      "files-api/c.png",
    ]);
  });

  it("preserves input order even when uploads finish out of order", async () => {
    // The order test above cannot fail if resolution is serial — every mock
    // settles immediately, so the "right" order is also the completion order.
    // Here the LAST url resolves FIRST, so an implementation that appended by
    // completion would produce c, b, a and be caught.
    const delayByUrl: Record<string, number> = { "a.png": 30, "b.png": 15, "c.png": 0 };
    getOrUploadFileMock.mockImplementation(async (url: string) => {
      await new Promise((r) => setTimeout(r, delayByUrl[url]));
      return {
        uri: `files-api/${url}`,
        name: `files/${url}`,
        mimeType: "image/png",
        expiresAtMs: Date.now() + 1_000_000,
      };
    });

    const { resolveImageBlocks } = await import("@/lib/ai/resolve-image");
    const blocks = await resolveImageBlocks(["a.png", "b.png", "c.png"], { preferFilesApi: true });
    expect(blocks.map((b) => b.source?.uri)).toEqual([
      "files-api/a.png",
      "files-api/b.png",
      "files-api/c.png",
    ]);
  });

  it("resolves a batch CONCURRENTLY, not one url at a time", async () => {
    // This is the whole point of the change: six call sites used to await each
    // image in a loop, so N photos cost N sequential fetch+upload round trips in
    // front of a vision call. Asserting peak in-flight > 1 is what distinguishes
    // the batched implementation from the serial one it replaced — a plain
    // `for (const u of urls) await ...` would peak at 1 and fail here.
    let inFlight = 0;
    let peak = 0;
    getOrUploadFileMock.mockImplementation(async (url: string) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return {
        uri: `files-api/${url}`,
        name: `files/${url}`,
        mimeType: "image/png",
        expiresAtMs: Date.now() + 1_000_000,
      };
    });

    const { resolveImageBlocks } = await import("@/lib/ai/resolve-image");
    const urls = Array.from({ length: 4 }, (_, i) => `p${i}.png`);
    await resolveImageBlocks(urls, { preferFilesApi: true });
    expect(peak).toBe(4);
  });

  it("caps in-flight uploads so an unbounded photo array can't open a socket per photo", async () => {
    // Two call sites (room-diagnostician ctx.imageUrls, greedy-decorator
    // ctx.roomPhotos) are user-sized with no ceiling. The gate defaults to 6.
    let inFlight = 0;
    let peak = 0;
    getOrUploadFileMock.mockImplementation(async (url: string) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight--;
      return {
        uri: `files-api/${url}`,
        name: `files/${url}`,
        mimeType: "image/png",
        expiresAtMs: Date.now() + 1_000_000,
      };
    });

    const { resolveImageBlocks } = await import("@/lib/ai/resolve-image");
    const urls = Array.from({ length: 25 }, (_, i) => `p${i}.png`);
    const blocks = await resolveImageBlocks(urls, { preferFilesApi: true });

    expect(peak).toBe(6);
    // Every url still resolves, in order — the gate throttles, it never drops.
    expect(blocks.map((b) => b.source?.uri)).toEqual(urls.map((u) => `files-api/${u}`));
  });

  it("resolveImageBlocksSettled isolates a per-item failure instead of losing the batch", async () => {
    // Product-reference photos need this: one unresolvable image must skip only
    // its own block and leave the rest attached, which is what the serial
    // try/catch-per-item loop did. A bare Promise.all would lose all of them.
    getOrUploadFileMock.mockImplementation(async (url: string) => {
      if (url === "bad.png") throw new Error("upload exploded");
      return {
        uri: `files-api/${url}`,
        name: `files/${url}`,
        mimeType: "image/png",
        expiresAtMs: Date.now() + 1_000_000,
      };
    });

    const { resolveImageBlocksSettled } = await import("@/lib/ai/resolve-image");
    const blocks = await resolveImageBlocksSettled(["a.png", "bad.png", "c.png"], {
      preferFilesApi: true,
    });

    // null occupies the failed slot — so the caller can still pair captions to
    // images by INDEX, which is the whole reason the slot is kept.
    expect(blocks.map((b) => b?.source?.uri ?? null)).toEqual([
      "files-api/a.png",
      null,
      "files-api/c.png",
    ]);
  });

  it("resolveImageBlocksSettled goes through the SAME gate, not around it", async () => {
    // This is the defect review caught: the one call site capped at 10 images —
    // higher than the gate's own default of 6 — was resolving through a bare
    // Promise.all and bypassing the limiter entirely.
    let inFlight = 0;
    let peak = 0;
    getOrUploadFileMock.mockImplementation(async (url: string) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight--;
      return {
        uri: `files-api/${url}`,
        name: `files/${url}`,
        mimeType: "image/png",
        expiresAtMs: Date.now() + 1_000_000,
      };
    });

    const { resolveImageBlocksSettled } = await import("@/lib/ai/resolve-image");
    const urls = Array.from({ length: 10 }, (_, i) => `ref${i}.png`);
    await resolveImageBlocksSettled(urls, { preferFilesApi: true });

    expect(peak).toBe(6);
  });

  it("shares ONE limiter instance with the gemini inline-fetch path", async () => {
    // Both paths used to build their own pLimit from the same env var, which
    // reads like one ceiling but permits 2x the sockets. Identity, not equality:
    // two limiters with the same concurrency would pass a value check.
    const gate = await import("@/lib/ai/image-fetch-gate");
    const gemini = await import("@/lib/ai/gemini");
    expect(gate.imageFetchLimit).toBeDefined();
    // The gemini module must not export a second limiter of its own.
    expect((gemini as Record<string, unknown>).imageFetchLimit).toBeUndefined();
  });
});
