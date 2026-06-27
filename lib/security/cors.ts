// CORS allowlist for the API surface (Track G6).
//
// Posture: the app and its API are same-origin, so legitimate browser traffic
// never triggers CORS. We therefore DENY cross-origin browser reads by default
// — by never emitting a wildcard `Access-Control-Allow-Origin` — and reflect
// CORS headers back ONLY for an explicit allowlist (the production site + local
// dev). A request with no `Origin` header (server-to-server: the Stripe webhook,
// native mobile clients, the internal growth API) is unaffected: CORS is a
// browser mechanism and these carry no Origin, so nothing here blocks them.
//
// This is deliberately additive — it sets response headers; it never rejects a
// request — so it cannot break a same-origin or server-to-server caller.

const LOCAL_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
];

/** Normalize an origin string: trim, lowercase scheme/host, drop trailing slash. */
function normalize(origin: string): string {
  return origin.trim().replace(/\/+$/, "");
}

/**
 * The set of origins allowed to make credentialed cross-origin browser requests.
 * Production origin(s) come from env (NEXT_PUBLIC_SITE_URL / NEXT_PUBLIC_APP_URL);
 * localhost is always included so local dev tooling works. Empty/′undefined′ env
 * values are ignored.
 */
export function getAllowedOrigins(): Set<string> {
  const fromEnv = [process.env.NEXT_PUBLIC_SITE_URL, process.env.NEXT_PUBLIC_APP_URL]
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map(normalize);
  return new Set([...fromEnv, ...LOCAL_ORIGINS]);
}

export function isAllowedOrigin(origin: string | null | undefined): boolean {
  if (!origin) return false;
  return getAllowedOrigins().has(normalize(origin));
}

/**
 * CORS headers to attach to an API response for the given request Origin.
 * Returns headers ONLY when the origin is on the allowlist; otherwise returns an
 * empty object (no ACAO ⇒ the browser blocks the cross-origin read). Always
 * varies on Origin so caches don't serve an allowlisted response to a different
 * origin.
 */
export function corsHeadersFor(origin: string | null | undefined): Record<string, string> {
  if (!isAllowedOrigin(origin)) return { Vary: "Origin" };
  return {
    "Access-Control-Allow-Origin": normalize(origin as string),
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

/** Mutate a response's headers in place with the CORS headers for this origin. */
export function applyCorsHeaders<T extends { headers: Headers }>(
  response: T,
  origin: string | null | undefined,
): T {
  for (const [k, v] of Object.entries(corsHeadersFor(origin))) {
    response.headers.set(k, v);
  }
  return response;
}
