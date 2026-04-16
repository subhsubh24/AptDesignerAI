// Resolve an image URL into an `AIContentBlock` the provider can send.
//
// When `preferFilesApi` is true and the Files API upload succeeds, we return
// a `file` block keyed by the Gemini `file_uri` — removing per-call I/O
// and base64 encoding for assets referenced across many calls (floor plan
// image during diagnosis, room photos across identification crops).
//
// Any failure falls back to the existing URL block; the provider fetches
// and inlines on demand. Callers never need to handle the error case.

import { getOrUploadFile } from "./files-cache";
import type { AIContentBlock } from "./provider";

export interface ResolveOptions {
  /**
   * When true, try the Files API path first. When false (default), we just
   * hand back a url block — suitable for one-shot agents where the upload
   * round-trip wouldn't pay off.
   */
  preferFilesApi?: boolean;
  /**
   * Optional mime-type override. Useful for PDFs where we already know
   * "application/pdf" and don't want to rely on Content-Type sniffing.
   */
  mimeType?: string;
}

/**
 * Resolve a single image URL to an AIContentBlock.
 *
 * - If `preferFilesApi` is false → returns `{ type: "image", source: { type: "url", url } }`.
 * - If `preferFilesApi` is true and cache/upload succeeds → returns a
 *   `file_uri` block. Otherwise falls back to the URL block.
 */
export async function resolveImageBlock(
  url: string,
  opts: ResolveOptions = {},
): Promise<AIContentBlock> {
  if (!opts.preferFilesApi) {
    return { type: "image", source: { type: "url", url } };
  }
  const cached = await getOrUploadFile(url);
  if (cached) {
    return {
      type: "image",
      source: {
        type: "file_uri",
        uri: cached.uri,
        media_type: opts.mimeType || cached.mimeType,
      },
    };
  }
  return { type: "image", source: { type: "url", url } };
}

/**
 * Resolve many image URLs in parallel. Order is preserved.
 */
export async function resolveImageBlocks(
  urls: string[],
  opts: ResolveOptions = {},
): Promise<AIContentBlock[]> {
  return Promise.all(urls.map((u) => resolveImageBlock(u, opts)));
}
