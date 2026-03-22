import { NextResponse, type NextRequest } from "next/server";

/**
 * No-op middleware — auth is bypassed.
 * Always allows access. Redirects / to /dashboard.
 */
export async function updateSession(request: NextRequest) {
  // Redirect root to dashboard
  if (request.nextUrl.pathname === "/") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  // Redirect login/signup to dashboard (no auth needed)
  if (request.nextUrl.pathname === "/login" || request.nextUrl.pathname === "/signup") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return NextResponse.next({ request });
}
