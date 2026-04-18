/**
 * Cheap URL-based filter for image formats Gemini doesn't accept.
 *
 * Gemini supports JPEG, PNG, WebP, GIF, HEIC/HEIF. Sending TIFF/BMP/RAW/SVG
 * causes a 400 ("Request contains an invalid argument") that tanks the whole
 * batch. We only have the URL at send-time (no HEAD fetch), so match by
 * extension — URLs without a clear extension (most CDN query-string URLs) are
 * passed through and validated server-side.
 */

const UNSUPPORTED_EXTENSIONS = [
  ".tif",
  ".tiff",
  ".bmp",
  ".svg",
  ".ico",
  ".raw",
  ".dng",
  ".psd",
  ".cr2",
  ".nef",
  ".arw",
];

export function isGeminiCompatibleImageUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  let pathname: string;
  try {
    pathname = new URL(url).pathname.toLowerCase();
  } catch {
    pathname = url.toLowerCase();
  }
  for (const ext of UNSUPPORTED_EXTENSIONS) {
    if (pathname.endsWith(ext)) return false;
  }
  return true;
}
