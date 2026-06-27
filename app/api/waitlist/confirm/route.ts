// Waitlist double opt-in confirmation endpoint (E7.1).
//
// The subscriber lands here from the link in their confirmation email. We look
// up the (pending) row by its single-use token, stamp confirmed_at, and clear
// the token so the link can't be replayed, then redirect to a friendly page.
//
// Public route: an unauthenticated person clicks this from their inbox, so it is
// allowlisted in lib/supabase/middleware.ts. Auth here is the unguessable token
// itself, verified against the service-role-only waitlist_emails table.

import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";

// Tokens are exactly 64 hex chars (randomBytes(32)). Match that exactly so a
// junk query string can't trigger a wide scan or odd Postgres behaviour.
const TOKEN_RE = /^[a-f0-9]{64}$/;

function redirectTo(req: NextRequest, status: "confirmed" | "invalid"): NextResponse {
  const url = req.nextUrl.clone();
  url.pathname = "/waitlist/confirmed";
  url.search = status === "confirmed" ? "" : "?status=invalid";
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  if (!TOKEN_RE.test(token)) {
    return redirectTo(req, "invalid");
  }

  const admin = getAdminClient();
  if (!admin) {
    // Datastore unavailable — can't confirm right now. Treat as invalid so the
    // user sees a retry-able message rather than a false success.
    return redirectTo(req, "invalid");
  }

  // Only match a still-pending row; a used (confirmed) link has its token cleared
  // and therefore won't be found. select() lets us detect whether a row changed.
  const { data, error } = await admin
    .from("waitlist_emails")
    .update({ confirmed_at: new Date().toISOString(), confirmation_token: null })
    .eq("confirmation_token", token)
    .is("confirmed_at", null)
    .select("id");

  if (error || !data || data.length === 0) {
    return redirectTo(req, "invalid");
  }

  return redirectTo(req, "confirmed");
}
