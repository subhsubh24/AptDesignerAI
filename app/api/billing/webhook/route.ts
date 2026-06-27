import { NextRequest, NextResponse } from "next/server";
import { constructWebhookEvent, extractBillingInfoFromEvent } from "@/lib/billing/stripe";
import { getAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { buildWinBackEmail1 } from "@/lib/email/templates/lifecycle";

// Subscription tiers (exclude one-time `apartment` purchase — not a recurring sub).
const SUBSCRIPTION_TIERS = new Set(["pro", "pro_annual"]);

// Attempt to send the win-back E1 email when a subscription is cancelled.
// Never throws — a failed email lookup or send must not prevent the 200 response
// that tells Stripe not to retry the event.
async function maybeSendWinBackEmail(userId: string, admin: ReturnType<typeof getAdminClient>): Promise<void> {
  if (!admin) return;
  try {
    const { data } = await admin.auth.admin.getUserById(userId);
    const email = data?.user?.email;
    if (!email) return;
    const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://aptdesignerai.ai").replace(/\/+$/, "");
    const { subject, html, text } = buildWinBackEmail1(siteUrl);
    const result = await sendEmail({ to: email, subject, html, text, stage: "winback_1" });
    if (result.error) {
      console.error("[webhook] win-back email not sent:", result.error);
    }
  } catch (err) {
    console.error("[webhook] win-back email lookup/send failed:", err);
  }
}

/**
 * POST /api/billing/webhook
 *
 * Stripe webhook receiver. Must be registered in the Stripe dashboard pointing
 * at <app-url>/api/billing/webhook. Requires STRIPE_WEBHOOK_SECRET (see PENDING_OPS.md).
 *
 * Handles:
 *   checkout.session.completed      → upsert stripe_customers row (status=active)
 *   customer.subscription.updated   → update status + current_period_end
 *   customer.subscription.deleted   → mark status=cancelled; send win-back E1 email
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

  // Check the previous status BEFORE upserting so we can detect a genuine
  // status transition. This makes win-back sends idempotent: if the row was
  // already 'cancelled' (e.g. Stripe re-delivered the event after a slow
  // response), we do not send a second email.
  let wasAlreadyCancelled = false;
  if (billing.status === "cancelled" && SUBSCRIPTION_TIERS.has(billing.tier)) {
    const { data: existing } = await admin
      .from("stripe_customers")
      .select("status")
      .eq("user_id", billing.userId)
      .maybeSingle();
    wasAlreadyCancelled = existing?.status === "cancelled";
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

  // Trigger win-back E1 only on a genuine cancellation transition.
  // Fire-and-forget: the response to Stripe must not block on the email send,
  // and a failed send must not turn a successful DB write into a 500.
  if (billing.status === "cancelled" && SUBSCRIPTION_TIERS.has(billing.tier) && !wasAlreadyCancelled) {
    void maybeSendWinBackEmail(billing.userId, admin);
  }

  return NextResponse.json({ received: true, processed: true, type: event.type });
}
