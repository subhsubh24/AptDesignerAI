import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { applyCorsHeaders } from "@/lib/security/cors";
import { applySiteGate } from "@/lib/security/site-gate";

const PUBLIC_PATHS = new Set([
  "/login",
  "/signup",
  // Account recovery. A locked-out user is by definition signed OUT, so these
  // must be reachable without a session or the whole flow is unreachable by the
  // only people it exists for.
  "/forgot-password",
  "/reset-password",
  "/waitlist",
  // Double opt-in landing page, reached from an emailed link by an
  // unauthenticated visitor. Listed explicitly (not as a /waitlist prefix) so a
  // future /waitlist/* sub-route can't become public by accident.
  "/waitlist/confirmed",
  "/pricing",
  "/faq",
  "/privacy",
  "/terms",
  "/support",
  // Linked from the "Product" column of components/marketing/marketing-footer.tsx,
  // which renders on every marketing page including /waitlist — so while it was
  // missing here, an anonymous visitor clicking "Gallery" from the pre-launch
  // landing page was redirected to /login.
  "/gallery",
]);

// The subset of PUBLIC_PATHS that a signed-in user should be bounced away from.
// Only the auth FORMS are pointless once you already have a session; the
// pricing, legal, support and guide pages are not, and bouncing them to the
// dashboard makes them unreachable for everyone who is signed in:
//   - /terms and /privacy are linked from /billing/upgrade, where Apple 3.1.2
//     and Play both require them to be reachable AT the point of purchase —
//     and every visitor to a checkout page is signed in.
//   - /pricing is the target of the "See all plans" upgrade CTA, so bouncing it
//     dead-ends the free→paid path.
// The recovery routes are deliberately NOT here: /reset-password mints a
// session as it redeems the emailed token, so bouncing on a session would
// break the flow at the exact moment it starts working.
const SIGNED_IN_REDIRECT_PATHS = new Set([
  "/login",
  "/signup",
  "/waitlist",
  "/waitlist/confirmed",
]);

// Prefix-matched public routes.
// /guides has sub-routes (/guides/color-palette-guide, etc.).
// /shared/<token> is a public design share link whose whole audience is people
// who are NOT signed in — a friend or client sent the URL. The matching
// /api/shared/* prefix was already public below, but the PAGE was not, so every
// share link 307'd its recipient to /login.
//
// The token is enforced at the app layer: both the page and the API filter on
// `.eq("share_token", token).eq("is_public", true)` and notFound()/404 otherwise
// (app/shared/[token]/page.tsx:56-60, app/api/shared/[token]/route.ts:42-43).
// That is the control here — deliberately NOT the RLS policy. The live policy is
// migration 020 (which superseded 019's JWT-claim version), and its
// `USING (is_public = true AND share_token IS NOT NULL)` cannot require the
// caller's filter: a Postgres USING clause is evaluated per row against row
// data, not against the client's WHERE predicate, so 020's comment claiming
// "a SELECT without the share_token filter matches 0 rows" is wrong. Opening
// this route widens nothing — NEXT_PUBLIC_SUPABASE_ANON_KEY already ships to
// every browser, so that PostgREST path is equally reachable with or without
// this change. Tracked separately; do not treat 020 as a token guard.
//
// Left OUT of the site-gate exempt set on purpose: pre-launch there is nothing
// worth sharing, so a share link correctly meets the coming-soon curtain.
const PUBLIC_PATH_PREFIXES = ["/guides", "/shared"];

// API routes that must accept unauthenticated requests.
// /api/billing/webhook — Stripe POSTs here with its own signature verification.
// /api/shared/*       — public design share links; each route MUST enforce
//                       share_token + is_public via RLS. Do not add auth-gated
//                       routes under this prefix.
// /api/mobile/*       — mobile clients authenticate via Bearer token in the
//                       Authorization header (no session cookie); each route
//                       calls supabase.auth.getUser(token) directly.
// /api/internal/*     — internal tooling (e.g. growth-metrics) authenticates
//                       via the INTERNAL_METRICS_TOKEN shared secret in the
//                       Authorization header; each route MUST verify it.
const PUBLIC_API_PATHS = new Set([
  "/api/waitlist",
  "/api/waitlist/confirm",
  "/api/billing/webhook",
]);

export async function updateSession(request: NextRequest) {
  // CORS (G6): answer the preflight for API routes before any other logic. CORS
  // headers are reflected ONLY for allowlisted origins (no wildcard), so a
  // disallowed cross-origin browser request gets no ACAO and is blocked by the
  // browser. Server-to-server callers send no Origin and are unaffected. The
  // preflight is harmless (carries no credentials) so it is answered even when
  // the pre-launch site gate is up.
  const origin = request.headers.get("origin");
  const isApiRoute = request.nextUrl.pathname.startsWith("/api/");
  if (isApiRoute && request.method === "OPTIONS") {
    return applyCorsHeaders(new NextResponse(null, { status: 204 }), origin);
  }

  // Pre-launch SITE GATE (E8): when SITE_GATE_PASSWORD is set, hold the app
  // behind a password (exempting the public marketing/waitlist routes) so
  // visitors see "coming soon + join the waitlist" until launch. No-op when the
  // env var is unset (today's default), so this ships inert.
  const gated = await applySiteGate(request);
  if (gated) return gated;

  // Redirect root to dashboard always
  if (request.nextUrl.pathname === "/") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // No Supabase configured — bypass auth entirely (local dev mode)
  if (!url || !key) {
    // In dev mode, redirect login/signup to dashboard
    if (SIGNED_IN_REDIRECT_PATHS.has(request.nextUrl.pathname)) {
      const redir = request.nextUrl.clone();
      redir.pathname = "/dashboard";
      return NextResponse.redirect(redir);
    }
    const devRes = NextResponse.next({ request });
    return isApiRoute ? applyCorsHeaders(devRes, origin) : devRes;
  }

  // Real Supabase auth — refresh session via cookies
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  let user = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch {
    // Supabase unreachable — treat as unauthenticated but don't crash
  }

  const { pathname } = request.nextUrl;
  const isPublicPath =
    PUBLIC_PATHS.has(pathname) ||
    PUBLIC_PATH_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
  const isAuthCallback = pathname.startsWith("/api/auth");
  const isPublicApi =
    PUBLIC_API_PATHS.has(pathname) ||
    pathname.startsWith("/api/shared/") ||
    pathname.startsWith("/api/mobile/") ||
    pathname.startsWith("/api/internal/");

  if (!user && !isPublicPath && !isAuthCallback && !isPublicApi) {
    if (isApiRoute) {
      return applyCorsHeaders(
        NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
        origin,
      );
    }
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    return NextResponse.redirect(loginUrl);
  }

  // Logged-in users hitting login/signup → redirect to dashboard
  if (user && SIGNED_IN_REDIRECT_PATHS.has(pathname)) {
    const dashUrl = request.nextUrl.clone();
    dashUrl.pathname = "/dashboard";
    return NextResponse.redirect(dashUrl);
  }

  return isApiRoute ? applyCorsHeaders(supabaseResponse, origin) : supabaseResponse;
}
