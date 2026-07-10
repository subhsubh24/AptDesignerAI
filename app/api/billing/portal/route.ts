import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createBillingPortalSession } from "@/lib/billing/stripe";
import { checkRateLimit, RATE_LIMITS } from "@/lib/utils/rate-limiter";
import { apiError, logServerError } from "@/lib/utils/api-error";

/**
 * POST /api/billing/portal
 *
 * Opens a Stripe Billing Portal session for the authenticated web user so they
 * can manage/cancel their subscription, update payment method, and download
 * invoices — the self-serve subscription management surface. Returns { url };
 * the client redirects to it.
 *
 * The Stripe customer id is looked up from the CURRENT user's own
 * stripe_customers row via the user-scoped client (RLS restricts SELECT to
 * auth.uid() = user_id), so a caller can only ever open THEIR OWN portal — the
 * client never supplies a customer id.
 */

// Bound the Stripe network call the same way as checkout so a stalled portal
// create fails fast/catchably instead of the platform 504-ing first.
export const maxDuration = 20;

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = checkRateLimit(`billing-portal:${user.id}`, RATE_LIMITS.billingCheckout);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please wait before trying again." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((limit.retryAfterMs || 3600000) / 1000)) } },
    );
  }

  const { data, error } = await supabase
    .from("stripe_customers")
    .select("stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) return apiError("billing.portal", error);

  const customerId = (data as { stripe_customer_id?: string } | null)?.stripe_customer_id;
  if (!customerId) {
    // No Stripe customer yet (free user / never checked out) — nothing to manage.
    return NextResponse.json({ error: "No active subscription found." }, { status: 404 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://aptdesignerai.com";
  try {
    const { url } = await createBillingPortalSession(customerId, `${appUrl}/account`);
    return NextResponse.json({ url });
  } catch (err) {
    logServerError("billing.portal", err);
    return NextResponse.json(
      { error: "Could not open the billing portal. Please try again." },
      { status: 502 },
    );
  }
}
