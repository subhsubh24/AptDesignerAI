import Stripe from "stripe";

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? "";

// Stripe price IDs — set these in Vercel env vars after creating products in the Stripe dashboard.
// See PENDING_OPS.md for the exact env var names and setup steps.
export const STRIPE_PRICE_IDS = {
  apartment: process.env.STRIPE_PRICE_ID_APARTMENT ?? "",      // one-time $29
  pro_monthly: process.env.STRIPE_PRICE_ID_PRO_MONTHLY ?? "",  // recurring $49/month
  pro_annual: process.env.STRIPE_PRICE_ID_PRO_ANNUAL ?? "",    // recurring $399/year
} as const;

export type BillingTier = "apartment" | "pro" | "pro_annual";

let _stripe: Stripe | null = null;

function getStripe(): Stripe {
  if (!STRIPE_SECRET_KEY) {
    throw new Error(
      "[billing] STRIPE_SECRET_KEY is not configured. Set it in Vercel env vars (see PENDING_OPS.md).",
    );
  }
  if (!_stripe) {
    _stripe = new Stripe(STRIPE_SECRET_KEY, {
      apiVersion: "2026-05-27.dahlia",
      // Bound the money-path network call so a stalled Stripe API fails fast and
      // CATCHABLY (StripeConnectionError) instead of hanging until the serverless
      // platform kills the function with an opaque 504. The SDK default is 80s —
      // longer than any Vercel budget. 15s is ample for a single checkout-session
      // create (normally sub-second). Mirrors the explicit timeouts on the other
      // external calls (email 10s, Turnstile 5s).
      timeout: 15_000,
      // CRITICAL to the ordering above: the SDK RETRIES a timed-out request (its
      // default maxNetworkRetries is 2), so leaving the default would burn
      // ~3×15s + backoff ≈ 45–50s — past the route's maxDuration=20, letting the
      // platform 504 first and reproducing the very hang this fixes. A user-
      // initiated checkout should surface the failure on the first attempt, so
      // disable retries: one 15s attempt stays safely under maxDuration.
      maxNetworkRetries: 0,
    });
  }
  return _stripe;
}

export interface CheckoutSessionParams {
  userId: string;
  userEmail: string;
  tier: BillingTier;
  successUrl: string;
  cancelUrl: string;
}

export async function createCheckoutSession(
  params: CheckoutSessionParams,
): Promise<{ sessionId: string; url: string }> {
  const stripe = getStripe();
  const { userId, userEmail, tier, successUrl, cancelUrl } = params;

  const priceId =
    tier === "apartment"
      ? STRIPE_PRICE_IDS.apartment
      : tier === "pro_annual"
        ? STRIPE_PRICE_IDS.pro_annual
        : STRIPE_PRICE_IDS.pro_monthly;
  if (!priceId) {
    throw new Error(
      `[billing] Stripe price ID for tier '${tier}' is not configured. ` +
      "Set STRIPE_PRICE_ID_APARTMENT, STRIPE_PRICE_ID_PRO_MONTHLY, or STRIPE_PRICE_ID_PRO_ANNUAL in Vercel env vars.",
    );
  }

  const mode: Stripe.Checkout.SessionCreateParams.Mode =
    tier === "apartment" ? "payment" : "subscription";

  const session = await stripe.checkout.sessions.create({
    mode,
    customer_email: userEmail,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { user_id: userId, tier },
    // Allow promotional codes entered by the user (e.g. EARLY30 discount).
    allow_promotion_codes: true,
    ...(mode === "subscription"
      ? { subscription_data: { metadata: { user_id: userId } } }
      : {}),
  });

  if (!session.url) {
    throw new Error("[billing] Stripe returned a checkout session with no URL.");
  }

  return { sessionId: session.id, url: session.url };
}

export interface WebhookResult {
  type: string;
  processed: boolean;
  userId?: string;
  tier?: BillingTier;
}

export function constructWebhookEvent(
  rawBody: string,
  signature: string,
): Stripe.Event {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? "";
  if (!webhookSecret) {
    throw new Error(
      "[billing] STRIPE_WEBHOOK_SECRET is not configured. Register the webhook endpoint in the Stripe dashboard.",
    );
  }
  const stripe = getStripe();
  return stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
}

export function extractBillingInfoFromEvent(event: Stripe.Event): {
  stripeCustomerId: string;
  stripeSubscriptionId: string | null;
  tier: BillingTier;
  status: "active" | "cancelled" | "past_due" | "unpaid";
  currentPeriodEnd: Date | null;
  userId: string;
} | null {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.user_id;
      const tier = session.metadata?.tier as BillingTier | undefined;

      if (!userId || !tier || !session.customer) return null;

      const stripeCustomerId =
        typeof session.customer === "string" ? session.customer : session.customer.id;
      const stripeSubscriptionId =
        session.subscription
          ? typeof session.subscription === "string"
            ? session.subscription
            : session.subscription.id
          : null;

      return {
        stripeCustomerId,
        stripeSubscriptionId,
        tier,
        status: "active",
        currentPeriodEnd: null,  // will be updated on subscription events for Pro
        userId,
      };
    }

    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const userId = sub.metadata?.user_id;
      const tier = (sub.metadata?.tier as BillingTier | undefined) ?? "pro";

      if (!userId || !sub.customer) return null;

      const stripeCustomerId =
        typeof sub.customer === "string" ? sub.customer : sub.customer.id;

      const statusMap: Record<Stripe.Subscription.Status, "active" | "cancelled" | "past_due" | "unpaid"> = {
        active: "active",
        trialing: "active",
        past_due: "past_due",
        unpaid: "unpaid",
        canceled: "cancelled",
        incomplete: "past_due",
        incomplete_expired: "cancelled",
        paused: "cancelled",
      };

      return {
        stripeCustomerId,
        stripeSubscriptionId: sub.id,
        tier,
        status: statusMap[sub.status] ?? "cancelled",
        // The dahlia API removed current_period_end from the Subscription object.
        // Entitlement gating relies on `status`; period end is left null here.
        currentPeriodEnd: null,
        userId,
      };
    }

    default:
      return null;
  }
}
