import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, RATE_LIMITS } from "@/lib/utils/rate-limiter";

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
