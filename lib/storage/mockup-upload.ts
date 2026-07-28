/**
 * Storing a rendered mockup image and resolving its public URL.
 *
 * Extracted from `app/api/mockups/route.ts` so the duplicate-path behaviour
 * below can carry a real regression test — a route file cannot export helpers
 * for a unit test without breaking Next.js' route-module type contract.
 */

import crypto from "crypto";

const BUCKET = "room-images";

/**
 * Does this storage error mean "an object is already at that path"?
 *
 * Every mockup path is DETERMINISTIC (see `uploadMockupImage`), so a duplicate
 * is not a failure — it means the correct image is already stored and we should
 * hand back its URL rather than an inline copy of the bytes.
 *
 * Match the DOCUMENTED error codes, not the HTTP status. A `StorageApiError`'s
 * `statusCode` is populated from the response BODY's `statusCode`/`code` field,
 * not from the numeric HTTP status — for a duplicate upload Supabase returns
 * `KeyAlreadyExists` (current) or `already_exists` (legacy, alongside
 * `httpStatusCode: 409`). So checking for "409" would miss the real error
 * entirely and would also misfire on an unrelated 409. The message regex stays
 * as a last-resort fallback for older/odd shapes, but it is deliberately NOT
 * the primary signal: prose can be reworded or localised, an error code cannot.
 *
 * Precision matters here beyond tidiness. `getPublicUrl` is a pure string
 * builder — it never verifies the object exists and never errors — so a FALSE
 * POSITIVE would hand back a URL to nothing with no safety net. Better to fall
 * back to the (correct, if heavy) data URI than to invent a broken link.
 */
const ALREADY_EXISTS_CODES = new Set(["keyalreadyexists", "already_exists"]);

export function isAlreadyExistsError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as {
    statusCode?: string | number;
    code?: string;
    error?: string;
    message?: string;
  };
  const code = String(e.code ?? e.statusCode ?? "").toLowerCase();
  if (ALREADY_EXISTS_CODES.has(code)) return true;
  return /already exists|duplicate/i.test(`${e.error ?? ""} ${e.message ?? ""}`);
}

/** The deterministic storage path a given mockup renders to. */
export function mockupStoragePath(buffer: Buffer, mime: string, cacheKey?: string): string {
  const ext = mime.includes("jpeg") || mime.includes("jpg") ? "jpg" : "png";
  const stem = cacheKey ?? crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 32);
  return `mockups/${stem}.${ext}`;
}

/**
 * Upload base64 image data to storage and return the public URL.
 *
 * The filename is content-addressed when `cacheKey` is provided so that
 * identical inputs produce identical paths (enables the mockup cache). When
 * omitted, falls back to a sha256 of the bytes themselves.
 *
 * Because the path is deterministic either way, re-rendering the same mockup
 * targets a path that ALREADY holds that exact image, and `upsert: false` fails
 * with a 409. Returning a multi-megabyte `data:image/png;base64,...` string
 * there is wrong twice over: it is persisted into `mockups.result_image_url`
 * and handed to the client in place of a URL, and the correct image was sitting
 * at that path the whole time. It is also the COMMON path in production rather
 * than an edge case — the only short-circuit ahead of it (`findCachedMockup`)
 * reads the local filesystem, which is empty on serverless, so identical inputs
 * reach this upload every time. The data URI is kept only for a genuine failure
 * (quota, network, permissions), where returning something beats returning
 * nothing.
 */
export async function uploadMockupImage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  base64Data: string,
  mimeType?: string,
  cacheKey?: string,
): Promise<string> {
  const mime = mimeType || "image/png";
  const buffer = Buffer.from(base64Data, "base64");
  const fileName = mockupStoragePath(buffer, mime, cacheKey);

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .upload(fileName, buffer, { contentType: mime, upsert: false });

  if (error) {
    if (isAlreadyExistsError(error)) {
      // Already stored under this deterministic path — reuse it.
      const { data: existing } = supabase.storage.from(BUCKET).getPublicUrl(fileName);
      if (existing?.publicUrl) return existing.publicUrl;
    }
    console.error("[mockup] Failed to upload image to storage:", error.message);
    return `data:${mime};base64,${base64Data}`;
  }

  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(data.path);
  return urlData.publicUrl;
}
