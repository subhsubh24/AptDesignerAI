// Resolve an image URL into an `AIContentBlock` the provider can send.
//
// When `preferFilesApi` is true and the Files API upload succeeds, we return
// a `file` block keyed by the Gemini `file_uri` — removing per-call I/O
// and base64 encoding for assets referenced across many calls (floor plan
// image during diagnosis, room photos across identification crops).
//
// Any failure falls back to the existing URL block; the provider fetches
// and inlines on demand. Callers never need to handle the error case.

import { imageFetchLimit } from "./image-fetch-gate";
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
 * Resolve many image URLs concurrently.
 *
 * ORDER IS PRESERVED and is load-bearing: the returned blocks are interleaved
 * with numbered caption text ("Photo 3:", "IMAGE 0 is the AUTHORITATIVE FLOOR
 * PLAN"), so a block landing in the wrong slot would silently mislabel the
 * model's inputs. `Promise.all` resolves by INDEX, never by completion order,
 * so the gate above changes throughput only — the determinism rule on map
 * ordering is satisfied structurally, not by convention.
 */
export async function resolveImageBlocks(
  urls: string[],
  opts: ResolveOptions = {},
): Promise<AIContentBlock[]> {
  return Promise.all(urls.map((u) => imageFetchLimit(() => resolveImageBlock(u, opts))));
}

/**
 * Resolve many image URLs concurrently, ISOLATING per-item failure.
 *
 * Same gate and the same index-preserving contract as `resolveImageBlocks`, but
 * an entry that throws yields `null` in its slot instead of rejecting the whole
 * batch. That is the semantics product-reference photos need: one unresolvable
 * image must skip only its own block and leave the rest attached, which is what
 * the serial `try`/`catch`-per-item loop did before batching.
 *
 * It exists as its own export because doing this inline with a bare
 * `Promise.all(refs.map(r => resolveImageBlock(r).catch(...)))` is precisely how
 * a call site ends up OUTSIDE the gate — which is the bug review caught: the one
 * site capped at 10 images, higher than the gate's own default of 6, was the one
 * site bypassing it.
 */
export async function resolveImageBlocksSettled(
  urls: string[],
  opts: ResolveOptions = {},
): Promise<(AIContentBlock | null)[]> {
  return Promise.all(
    urls.map((u) => imageFetchLimit(() => resolveImageBlock(u, opts).catch(() => null))),
  );
}
