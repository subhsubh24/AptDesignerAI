/**
 * The single read path for a PUBLIC design share link (`/shared/<token>`).
 *
 * WHY THIS MODULE EXISTS — the token has to be enforced somewhere that can
 * actually enforce it.
 *
 * Both public surfaces (the page and the API route) look a row up by
 * `share_token`. Until now both went through `createClient()`, i.e. the
 * **anon-key** client, and the safety argument was migration 020's policy:
 *
 *     USING (is_public = true AND share_token IS NOT NULL)
 *
 * That policy cannot do the job. A Postgres `USING` clause is evaluated per row
 * against ROW DATA — it has no visibility of the caller's `WHERE` predicate, so
 * it cannot require anyone to send `?share_token=eq.<token>`. Migration 020's
 * own header comment ("a SELECT without the share_token filter matches 0 rows")
 * is simply wrong. Since `NEXT_PUBLIC_SUPABASE_ANON_KEY` ships to every browser,
 * anyone could call PostgREST directly —
 *
 *     GET /rest/v1/saved_designs?is_public=eq.true&select=*
 *
 * — and receive EVERY shared design, `share_token`, `user_id` and full snapshot
 * included: exactly the enumeration migrations 015→019 were written to close.
 * (Dormant only because `DATA_BACKEND` still defaults to the memory store; it
 * goes live on the owner's cutover. Tracked as issue #708.)
 *
 * THE FIX, in two halves that must land together:
 *  1. Migration 030 DROPS that permissive anon policy, so `saved_designs` is
 *     readable by anon through PostgREST not at all. The owner-scoped policies
 *     (`auth.uid() = user_id`) are untouched.
 *  2. This module reads the row with the SERVICE-ROLE client, which bypasses
 *     RLS, and binds BOTH `share_token` and `is_public` server-side. The token
 *     stays the credential, but now it is enforced by code that a client cannot
 *     route around, instead of by a policy that never checked it.
 *
 * Why the admin client and not a `SECURITY DEFINER` RPC: the RPC is the more
 * elegant shape, but `lib/store/memory-store.ts`'s `.rpc()` is a no-op stub, so
 * an RPC rewrite would break the DEFAULT (memory) backend for everyone. This is
 * the established repo pattern for a table only the service-role client reads —
 * see `supabase/migrations/016_rls_computer_use_tables.sql`.
 *
 * SAFETY INVARIANTS for anything editing this file — the admin client has no
 * RLS behind it, so these are the whole boundary:
 *  - NEVER relax either filter. `share_token` proves the caller was given the
 *    link; `is_public` proves the owner still wants it shared.
 *  - NEVER widen the column list. `user_id` and `share_token` must not leave
 *    the server: returning `share_token` would let one recipient's link be
 *    re-derived from another's response.
 *  - NEVER accept an empty/short token. `.eq("share_token", "")` against a
 *    table where the column is nullable must not become a wildcard.
 */

import { getAdminClient } from "@/lib/supabase/admin";
import { createClient, supabaseDataBackendEnabled } from "@/lib/supabase/server";
import { logServerError } from "@/lib/utils/api-error";

/**
 * Minimum share-token length. Tokens are minted as 16 random bytes rendered hex
 * (32 chars) in `app/api/saved-designs/[id]/route.ts`; anything shorter than 16
 * is not a token this app ever issued, so it is rejected before it reaches the
 * database.
 */
export const MIN_SHARE_TOKEN_LENGTH = 16;

/**
 * Columns a share link may expose. Deliberately excludes `user_id` (whose
 * design it is) and `share_token` (the credential itself).
 */
const PUBLIC_SHARE_COLUMNS =
  "id, title, room_type, stage, thumbnail_url, snapshot, created_at";

export type PublicSharedDesignRow = {
  id: string;
  title: string;
  room_type: string | null;
  stage: string;
  thumbnail_url: string | null;
  snapshot: unknown;
  created_at: string;
};

/** True when `token` is shaped like a token this app mints. */
export function isWellFormedShareToken(token: string | undefined | null): boolean {
  return typeof token === "string" && token.length >= MIN_SHARE_TOKEN_LENGTH;
}

/**
 * Reads the public snapshot behind a share token, or null when no PUBLIC design
 * carries that token.
 *
 * Callers decide how "null" renders (the page 404s, the API route returns 404) —
 * both must be indistinguishable from "token exists but is not public", so a
 * probe learns nothing either way.
 */
export async function readSharedDesignByToken(
  token: string,
): Promise<PublicSharedDesignRow | null> {
  if (!isWellFormedShareToken(token)) return null;

  const client = await publicShareReader();

  const { data, error } = await client
    .from("saved_designs")
    .select(PUBLIC_SHARE_COLUMNS)
    // Both filters are load-bearing — see the invariants in the file header.
    .eq("share_token", token)
    .eq("is_public", true)
    .maybeSingle();
  // .maybeSingle() returns no error for the legitimate "0 rows" case (data is
  // simply null), so any error here is a real DB failure — log it, but still
  // return null: per the invariants above, "real error" and "no such share"
  // must render identically to the caller, so this cannot change the response.
  if (error) logServerError("publicShare.readByToken", error);

  return (data as PublicSharedDesignRow | null) ?? null;
}

/**
 * The client this read must use for the ACTIVE data backend.
 *
 * - `supabase`: the service-role client. Migration 030 leaves anon with no
 *   policy on `saved_designs`, so the anon client would now return 0 rows for
 *   every valid link — a silently broken share feature. FAIL LOUD instead: a
 *   missing service-role key is a misconfiguration, not a reason to degrade.
 * - memory (default): the in-memory store, which has no RLS to bypass. The
 *   filters above are the boundary there exactly as they are in Postgres.
 */
async function publicShareReader() {
  if (!supabaseDataBackendEnabled()) {
    return createClient();
  }

  const admin = getAdminClient();
  if (!admin) {
    throw new Error(
      "DATA_BACKEND=supabase requires SUPABASE_SERVICE_ROLE_KEY to serve public " +
        "share links: migration 030 leaves anon with no read policy on " +
        "saved_designs, so the anon client returns 0 rows for every valid link.",
    );
  }
  return admin;
}
