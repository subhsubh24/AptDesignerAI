import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

const PUBLIC_PATHS = new Set([
  "/login",
  "/signup",
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
]);

// /guides has sub-routes (/guides/color-palette-guide, etc.) — use prefix match below.
const PUBLIC_PATH_PREFIXES = ["/guides"];

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
    if (PUBLIC_PATHS.has(request.nextUrl.pathname)) {
      const redir = request.nextUrl.clone();
      redir.pathname = "/dashboard";
      return NextResponse.redirect(redir);
    }
    return NextResponse.next({ request });
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
  const isApi = pathname.startsWith("/api/");

  if (!user && !isPublicPath && !isAuthCallback && !isPublicApi) {
    if (isApi) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    return NextResponse.redirect(loginUrl);
  }

  // Logged-in users hitting login/signup → redirect to dashboard
  if (user && isPublicPath) {
    const dashUrl = request.nextUrl.clone();
    dashUrl.pathname = "/dashboard";
    return NextResponse.redirect(dashUrl);
  }

  return supabaseResponse;
}
