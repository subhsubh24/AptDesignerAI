import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const ALLOWED_REDIRECTS = new Set(["/dashboard", "/projects", "/settings"]);

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const rawNext = searchParams.get("next") ?? "/dashboard";

  // Prevent open redirect: only allow known internal paths
  const next = ALLOWED_REDIRECTS.has(rawNext) ? rawNext : "/dashboard";

  if (code) {
    // createClient() stays OUTSIDE the try: it fails LOUD by design when
    // DATA_BACKEND=supabase is set without credentials, and that
    // misconfiguration must surface as an error, not be silently swallowed
    // into a generic auth redirect.
    const supabase = await createClient();
    try {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) {
        return NextResponse.redirect(`${origin}${next}`);
      }
    } catch {
      // A transient Supabase/network failure while exchanging the OAuth code
      // must not surface as an uncaught 500 mid-login — fall through to the
      // graceful "try again" redirect below so the user lands on /login.
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
