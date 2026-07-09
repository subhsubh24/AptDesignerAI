/**
 * Validate a client-supplied image URL before it is persisted and later
 * rendered back into an <img> tag.
 *
 * Two shapes are legitimate in this codebase:
 *   1. An internal, same-origin storage path — the memory-store data layer's
 *      `getPublicUrl()` returns `/uploads/<bucket>/<path>` (a relative path),
 *      which the upload UI posts back verbatim.
 *   2. An absolute `https:` URL — real Supabase Storage public URLs once the
 *      app runs on a migrated backend.
 *
 * Everything else is rejected: non-https schemes (`http:`, `javascript:`,
 * `data:`) that could inject active content when rendered, and any leading-slash
 * value that a browser would resolve OFF-origin — not just protocol-relative
 * `//host`, but also backslash (`/\host`) and embedded-tab/newline
 * (`/<TAB>/host`) variants that the WHATWG URL parser normalizes to an
 * off-origin host — and unparseable junk.
 */
const INTERNAL_BASE = "https://internal.invalid";

export function isAcceptableStoredImageUrl(url: string): boolean {
  if (typeof url !== "string" || url.length === 0) return false;

  // Internal same-origin storage path. Resolve against a fixed base with the
  // platform URL parser (the same normalization a browser applies at render
  // time) and require the resolved origin to stay on that base — this closes
  // the `//host`, `/\host`, and tab/newline bypasses that a hand-rolled prefix
  // check misses.
  if (url.startsWith("/")) {
    try {
      return new URL(url, INTERNAL_BASE).origin === INTERNAL_BASE;
    } catch {
      return false;
    }
  }

  // Otherwise it must be an absolute https URL.
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}
