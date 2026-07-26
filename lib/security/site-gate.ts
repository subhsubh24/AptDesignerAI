// Pre-launch SITE GATE (ROADMAP Track E8).
//
// Purpose: before public launch, keep the unfinished app behind a password so
// random visitors see only the "coming soon + join the waitlist" experience,
// while the owner (with the password) gets full access. This is a soft
// pre-launch curtain — NOT a security boundary (RLS + auth remain the real
// boundary). Its only job is to stop casual visitors from seeing a half-baked
// product before launch.
//
// Behaviour:
//   - The gate is ON whenever `SITE_GATE_PASSWORD` is set in env (and non-empty).
//     When unset (the default, incl. today's production) this module is a no-op,
//     so it can ship inert and the owner flips it on by setting the env var.
//   - The PUBLIC marketing/legal/waitlist routes stay reachable while gated, so
//     people can still join the waitlist. This exempt set is deliberately a
//     SUBSET of the app's PUBLIC_PATHS — /login and /signup stay BEHIND the gate
//     pre-launch (no random sign-ups before launch).
//   - Unlock: append `?gate=<password>` to any URL once. On a match we set an
//     httpOnly cookie holding a derived token (never the raw password) and
//     redirect to the clean URL; thereafter the visitor passes the gate.
//   - Locked browser requests are redirected to the coming-soon page (/waitlist);
//     locked API requests get a 503.
//
// The PASSWORD VALUE is human-applied (owner sets SITE_GATE_PASSWORD; recorded
// in PENDING_OPS.md) and is never committed.

import { NextResponse, type NextRequest } from "next/server";

const GATE_COOKIE = "apt_site_gate";
const GATE_QUERY = "gate";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

// Routes reachable while the gate is up. A SUBSET of PUBLIC_PATHS — marketing,
// legal, and the waitlist flow only. Keep in sync with the marketing surface.
const GATE_EXEMPT_PATHS = new Set<string>([
  "/waitlist",
  "/waitlist/confirmed",
  "/privacy",
  "/terms",
  "/support",
  "/faq",
  "/pricing",
  // Reached from the marketing footer that renders on /waitlist itself, so it
  // has to survive the gate or the coming-soon page serves a dead link.
  "/gallery",
]);

// Prefix-matched exempt routes (sub-pages + the public waitlist API).
const GATE_EXEMPT_PREFIXES = ["/guides", "/api/waitlist"];

/** The gate is enabled iff SITE_GATE_PASSWORD is set to a non-empty value. */
export function isSiteGateEnabled(): boolean {
  const pw = process.env.SITE_GATE_PASSWORD;
  return typeof pw === "string" && pw.trim().length > 0;
}

/** Is this path reachable while the gate is up (so visitors can still join the waitlist)? */
export function isGateExempt(pathname: string): boolean {
  if (GATE_EXEMPT_PATHS.has(pathname)) return true;
  return GATE_EXEMPT_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

/**
 * Derive a stable, non-reversible token from the password so the raw password
 * is never stored in the cookie. SHA-256 hex via Web Crypto (edge-compatible).
 */
export async function gateToken(password: string): Promise<string> {
  const data = new TextEncoder().encode(`apt-site-gate:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Apply the pre-launch site gate to a request.
 * Returns a NextResponse to short-circuit the request (redirect / unlock / 503),
 * or `null` to let the request continue through normal auth handling.
 */
export async function applySiteGate(request: NextRequest): Promise<NextResponse | null> {
  if (!isSiteGateEnabled()) return null; // gate off → no-op (default/production today)

  const password = (process.env.SITE_GATE_PASSWORD as string).trim();
  const expected = await gateToken(password);
  const { pathname } = request.nextUrl;

  // Unlock attempt: ?gate=<password> on any route.
  const provided = request.nextUrl.searchParams.get(GATE_QUERY);
  if (provided !== null) {
    if ((await gateToken(provided)) === expected) {
      const clean = request.nextUrl.clone();
      clean.searchParams.delete(GATE_QUERY);
      const res = NextResponse.redirect(clean);
      res.cookies.set(GATE_COOKIE, expected, {
        httpOnly: true,
        sameSite: "lax",
        secure: true,
        path: "/",
        maxAge: COOKIE_MAX_AGE,
      });
      return res;
    }
    // Wrong password → fall through and treat as locked.
  }

  // Already unlocked via a valid cookie → let the request continue.
  if (request.cookies.get(GATE_COOKIE)?.value === expected) return null;

  // Marketing / legal / waitlist routes stay open so visitors can join the waitlist.
  if (isGateExempt(pathname)) return null;

  // Locked: API callers get a 503; browsers go to the coming-soon page.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Coming soon" }, { status: 503 });
  }
  const comingSoon = request.nextUrl.clone();
  comingSoon.pathname = "/waitlist";
  comingSoon.search = "";
  return NextResponse.redirect(comingSoon);
}
