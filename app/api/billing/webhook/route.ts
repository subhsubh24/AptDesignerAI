import { NextRequest, NextResponse } from "next/server";
import { constructWebhookEvent, extractBillingInfoFromEvent } from "@/lib/billing/stripe";
import { getAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/billing/webhook
 *
 * Stripe webhook receiver. Must be registered in the Stripe dashboard pointing
 * at <app-url>/api/billing/webhook. Requires STRIPE_WEBHOOK_SECRET (see PENDING_OPS.md).
 *
 * Handles:
 *   checkout.session.completed      → upsert stripe_customers row (status=active)
 *   customer.subscription.updated   → update status + current_period_end
 *   customer.subscription.deleted   → mark status=cancelled
 *
 * All writes use the service-role client (bypasses RLS) so no additional
 * INSERT/UPDATE policy is required on stripe_customers.
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature") ?? "";

  let event;
  try {
    event = constructWebhookEvent(rawBody, signature);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Webhook signature verification failed";
    console.error("[webhook] signature error:", msg);
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const billing = extractBillingInfoFromEvent(event);
  if (!billing) {
    // Event type not handled — acknowledge to Stripe so it stops retrying
    return NextResponse.json({ received: true, processed: false });
  }

  const admin = getAdminClient();
  if (!admin) {
    console.error("[webhook] Supabase admin client unavailable — cannot persist billing record");
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }

  const { error } = await admin.from("stripe_customers").upsert(
    {
      user_id: billing.userId,
      stripe_customer_id: billing.stripeCustomerId,
      stripe_subscription_id: billing.stripeSubscriptionId,
      tier: billing.tier,
      status: billing.status,
      current_period_end: billing.currentPeriodEnd?.toISOString() ?? null,
      updated_at: new Date().toISOString(),
    },
    {
      onConflict: "user_id",
    },
  );

  if (error) {
    console.error("[webhook] stripe_customers upsert error:", error.message);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  return NextResponse.json({ received: true, processed: true, type: event.type });
}
