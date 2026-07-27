import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { purgeUserStorage } from "@/lib/storage/user-storage";
import { checkRateLimit, RATE_LIMITS } from "@/lib/utils/rate-limiter";

// Listing + removing every object a user owns is more round trips than a plain
// cascade delete; give it headroom over the platform default.
export const maxDuration = 60;

export async function DELETE() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limit = checkRateLimit(`user-delete:${user.id}`, RATE_LIMITS.userDelete);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many deletion requests. Please try again later." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((limit.retryAfterMs || 86400000) / 1000)) } },
    );
  }

  const admin = getAdminClient();
  if (!admin) {
    return NextResponse.json(
      { error: "Account deletion is unavailable right now. Please contact support." },
      { status: 503 },
    );
  }

  // Storage is NOT part of the Postgres cascade, and both buckets are public —
  // so purge the user's objects FIRST. Order matters: the rows that reference a
  // generated mockup are what attribute it to this user, and the cascade below
  // destroys them. If the purge fails we must NOT delete the account: reporting
  // success while the user's photos stay publicly fetchable is exactly the fake
  // success this codebase treats as a release blocker. Failing here leaves the
  // account intact and retryable, and the purge itself is idempotent.
  try {
    await purgeUserStorage(admin, user.id);
  } catch (err) {
    console.error("[user-delete] storage purge failed:", err instanceof Error ? err.message : err);
    return NextResponse.json(
      {
        error:
          "We couldn't remove your stored images, so your account was not deleted. Please try again or contact support.",
      },
      { status: 500 },
    );
  }

  // Deleting the auth user cascades to profiles → projects → rooms → all room data,
  // and directly to saved_designs (user_id references auth.users on delete cascade).
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) {
    return NextResponse.json(
      { error: "Failed to delete account. Please try again or contact support." },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}
