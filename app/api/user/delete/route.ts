import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, RATE_LIMITS } from "@/lib/utils/rate-limiter";
import { cancelSubscription, isStripeConfigured } from "@/lib/billing/stripe";
import { logServerError } from "@/lib/utils/api-error";

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

  // Cancel any LIVE Stripe subscription BEFORE deleting the auth record. The
  // delete cascade drops the stripe_customers mapping row, so this is the last
  // moment we can reach the subscription id — and a deleted account that keeps
  // getting billed is an Apple 5.1.1(v) rejection plus real consumer harm.
  // Guarded on our own stored status so an already-cancelled sub is a no-op, and
  // skipped entirely pre-launch (Stripe unconfigured → no live subscriptions).
  if (isStripeConfigured()) {
    const { data: billing } = await admin
      .from("stripe_customers")
      .select("stripe_subscription_id, status")
      .eq("user_id", user.id)
      .maybeSingle();
    const subscriptionId = billing?.stripe_subscription_id;
    const isLive =
      billing?.status === "active" ||
      billing?.status === "past_due" ||
      billing?.status === "unpaid";
    if (subscriptionId && isLive) {
      try {
        await cancelSubscription(subscriptionId);
      } catch (err) {
        // Do NOT delete the account if we couldn't stop the billing: deleting
        // now would orphan a charging subscription with no mapping left to
        // reconcile. Preserve the row, log server-side, and let the user retry.
        logServerError("user-delete:cancel-subscription", err);
        return NextResponse.json(
          { error: "We couldn't complete your deletion right now. Please try again or contact support." },
          { status: 502 },
        );
      }
    }
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
