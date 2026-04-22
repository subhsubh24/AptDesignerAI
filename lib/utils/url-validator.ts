/**
 * URL validation utilities for SSRF prevention.
 *
 * Blocks requests to private/internal IPs, loopback, link-local,
 * and non-HTTP(S) schemes before any server-side fetch.
 */

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "0.0.0.0",
  "127.0.0.1",
  "[::1]",
  "metadata.google.internal",
  "169.254.169.254",
]);

function isPrivateIP(hostname: string): boolean {
  if (BLOCKED_HOSTNAMES.has(hostname)) return true;

  // IPv6 loopback
  if (hostname === "::1" || hostname === "[::1]") return true;

  // Strip brackets from IPv6
  const ip = hostname.replace(/^\[|\]$/g, "");

  // IPv4 private ranges
  const ipv4Match = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [, a, b] = ipv4Match.map(Number);
    // 10.x.x.x
    if (a === 10) return true;
    // 172.16.x.x – 172.31.x.x
    if (a === 172 && b >= 16 && b <= 31) return true;
    // 192.168.x.x
    if (a === 192 && b === 168) return true;
    // 127.x.x.x (loopback)
    if (a === 127) return true;
    // 169.254.x.x (link-local / cloud metadata)
    if (a === 169 && b === 254) return true;
    // 0.x.x.x
    if (a === 0) return true;
  }

  // IPv6 private ranges
  if (ip.startsWith("fc") || ip.startsWith("fd")) return true; // ULA
  if (ip.startsWith("fe80")) return true; // link-local

  return false;
}

export interface UrlValidationResult {
  valid: boolean;
  error?: string;
  url?: URL;
}

export function validateExternalUrl(urlString: string): UrlValidationResult {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    return { valid: false, error: "Invalid URL format" };
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { valid: false, error: "Only HTTP(S) URLs are allowed" };
  }

  if (!url.hostname || url.hostname.trim() === "") {
    return { valid: false, error: "URL must have a hostname" };
  }

  if (isPrivateIP(url.hostname)) {
    return { valid: false, error: "URLs pointing to internal/private networks are not allowed" };
  }

  // Block URLs with credentials
  if (url.username || url.password) {
    return { valid: false, error: "URLs with credentials are not allowed" };
  }

  return { valid: true, url };
}
