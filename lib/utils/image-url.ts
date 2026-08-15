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

/**
 * Hosts next.config.ts's `images.remotePatterns` allows next/image to fetch
 * and optimize. Kept in sync BY HAND — next.config.ts is not importable from
 * client components, so this list must be updated alongside it. Anything not
 * matched here (e.g. an arbitrary retailer product-image host) must render as
 * a plain `<img>` instead: next/image throws a hard runtime error for an
 * unconfigured hostname unless `unoptimized` is set, and `unoptimized` would
 * silently defeat the point of using next/image at all.
 */
const OPTIMIZABLE_IMAGE_HOSTS = [
  /\.supabase\.co$/,
  /\.supabase\.in$/,
  /\.googleusercontent\.com$/,
  /^places\.googleapis\.com$/,
  /^generativelanguage\.googleapis\.com$/,
];

export function canOptimizeImageHost(url: string): boolean {
  if (url.startsWith("/")) return true; // internal storage path, same-origin
  try {
    const { hostname } = new URL(url);
    return OPTIMIZABLE_IMAGE_HOSTS.some((re) => re.test(hostname));
  } catch {
    return false;
  }
}
