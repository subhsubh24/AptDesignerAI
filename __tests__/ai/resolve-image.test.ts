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
});
