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

/** Canonical set of accepted billing tiers — mirrors the `stripe_customers.tier`
 *  CHECK constraint (migrations 018 + 021). Used to validate tier strings that
 *  arrive in (untrusted) Stripe webhook metadata before they reach the DB upsert. */
const VALID_BILLING_TIERS: readonly BillingTier[] = ["apartment", "pro", "pro_annual"];

/**
 * Validate a raw tier string from Stripe webhook metadata against the canonical set.
 * An unexpected value — a replay of an old event, a typo, or a tier the DB CHECK
 * constraint would reject — must NOT be cast straight through: passing it to the
 * `stripe_customers` upsert triggers a Postgres CHECK violation, the webhook route
 * 500s, and Stripe retries the event indefinitely (a stuck webhook that leaves the
 * subscription state diverged from Stripe's truth, breaking entitlement gating).
 * Returns the tier if valid, else null so the caller can fall back safely.
 */
export function normalizeBillingTier(raw: string | undefined | null): BillingTier | null {
  return raw != null && (VALID_BILLING_TIERS as readonly string[]).includes(raw)
    ? (raw as BillingTier)
    : null;
}

/**
 * Annual (`pro_annual`) billing is GATED OFF until migration 021
 * (`021_stripe_customers_annual_tier.sql`, which extends the `stripe_customers.tier`
 * CHECK constraint to accept `'pro_annual'`) is applied to prod — see PENDING_OPS.md
 * `apply-migration-021`. Until that constraint exists, a completed annual checkout
 * would CHARGE the customer on Stripe, then the webhook's `stripe_customers` upsert
 * would fail with a Postgres CHECK violation — leaving them charged with NO entitlement.
 *
 * Ships DISABLED. The owner sets `ANNUAL_BILLING_ENABLED=true` in the SAME deploy that
 * applies migration 021 (go-live billing config is human-applied by contract).
 */
export function isAnnualBillingEnabled(): boolean {
  return process.env.ANNUAL_BILLING_ENABLED === "true";
}

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
      ? { subscription_data: { metadata: { user_id: userId, tier } } }
      : {}),
  });

  if (!session.url) {
    throw new Error("[billing] Stripe returned a checkout session with no URL.");
  }

  return { sessionId: session.id, url: session.url };
}

/**
 * Create a Stripe Billing Portal session so a web subscriber can self-serve:
 * update their payment method, download invoices, switch plans, or cancel. The
 * caller MUST have already resolved `customerId` from the current user's own
 * stripe_customers row (never a client-supplied id) — the portal exposes full
 * billing management for whatever customer id is passed.
 */
export async function createBillingPortalSession(
  customerId: string,
  returnUrl: string,
): Promise<{ url: string }> {
  const stripe = getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });
  if (!session.url) {
    throw new Error("[billing] Stripe returned a billing portal session with no URL.");
  }
  return { url: session.url };
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
      // Validate rather than blind-cast: an invalid tier string here would flow to
      // the stripe_customers upsert and 500 on the CHECK constraint. A null tier
      // (missing OR unrecognized) fails the guard below → safe no-op, no stuck retry.
      const rawTier = session.metadata?.tier;
      const tier = normalizeBillingTier(rawTier);
      // A PRESENT-but-unrecognized tier on a real paid checkout must not vanish: the
      // null below yields a 200 no-op (no entitlement, no Stripe retry), which is
      // strictly harder to detect than the CHECK-violation 500 it replaces. Log it
      // LOUD so an invalid tier on a CHARGED customer surfaces in webhook monitoring
      // (distinct from a routine absent-tier / unhandled event, which stays quiet).
      if (rawTier && !tier) {
        console.error(
          `[billing] checkout.session.completed for user ${userId ?? "unknown"} carried an unrecognized tier "${rawTier}" — refusing to grant entitlement (would violate the stripe_customers CHECK constraint). The customer may have been charged; investigate.`,
        );
      }

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
      // Missing OR unrecognized tier → fall back to "pro" (a known-valid paid tier)
      // rather than casting a garbage string through to the DB CHECK constraint,
      // which would 500 the webhook and trigger an indefinite Stripe retry loop.
      const rawSubTier = sub.metadata?.tier;
      const normalizedSubTier = normalizeBillingTier(rawSubTier);
      const tier = normalizedSubTier ?? "pro";
      // Unlike checkout this still WRITES a row (fallback "pro"), so it's not a silent
      // drop — but a present-but-unrecognized tier means we're mis-attributing an
      // existing subscriber's plan, so warn for discoverability (absent tier is the
      // normal Stripe case for subscription events → stays quiet).
      if (rawSubTier && normalizedSubTier === null) {
        console.warn(
          `[billing] ${event.type} for user ${userId ?? "unknown"} carried an unrecognized tier "${rawSubTier}" — falling back to "pro" (plan attribution may be wrong).`,
        );
      }

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
