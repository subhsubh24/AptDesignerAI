import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createCheckoutSession, type BillingTier } from "@/lib/billing/stripe";

/**
 * POST /api/billing/checkout
 *
 * Creates a Stripe Checkout session for the authenticated web user.
 * Body: { tier: "apartment" | "pro" }
 * Returns: { sessionId, url } — the client redirects to url immediately.
 *
 * Requires: STRIPE_SECRET_KEY, STRIPE_PRICE_ID_APARTMENT or
 *           STRIPE_PRICE_ID_PRO_MONTHLY (see PENDING_OPS.md).
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { tier?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const tier = body.tier;
  if (tier !== "apartment" && tier !== "pro") {
    return NextResponse.json(
      { error: "tier must be 'apartment' or 'pro'" },
      { status: 400 },
    );
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://aptdesigner.app";
  const successUrl = `${appUrl}/billing/checkout-success?tier=${tier}`;
  const cancelUrl = `${appUrl}/billing/checkout-cancel`;

  try {
    const { sessionId, url } = await createCheckoutSession({
      userId: user.id,
      userEmail: user.email ?? "",
      tier: tier as BillingTier,
      successUrl,
      cancelUrl,
    });

    return NextResponse.json({ sessionId, url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create checkout session";
    console.error("[api/billing/checkout]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
