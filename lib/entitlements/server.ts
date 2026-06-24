/**
 * Server-side RevenueCat entitlement check.
 *
 * Uses the RC REST API to verify subscription status without trusting the
 * client. Requires REVENUECAT_SECRET_KEY (server-only env var, never exposed
 * to the client). When the key is unset (local dev), returns false so the
 * save quota is enforced by client-side AsyncStorage only — acceptable for
 * development; production must set the key via PENDING_OPS.md.
 */

const RC_API_BASE = "https://api.revenuecat.com/v1";
const RC_SECRET_KEY = process.env.REVENUECAT_SECRET_KEY ?? "";

export const ENTITLEMENT_ID = "pro";
export const FREE_SAVE_LIMIT = 3;

interface RCEntitlement {
  expires_date: string | null;
  product_identifier: string;
  purchase_date: string;
}

interface RCSubscriberResponse {
  subscriber: {
    entitlements: Record<string, RCEntitlement>;
  };
}

/**
 * Returns true if the given RC app user ID has an active 'pro' entitlement.
 * Returns false when RC_SECRET_KEY is unset (graceful dev degradation).
 */
export async function hasProEntitlement(rcAppUserId: string): Promise<boolean> {
  if (!RC_SECRET_KEY) return false;

  let resp: Response;
  try {
    resp = await fetch(
      `${RC_API_BASE}/subscribers/${encodeURIComponent(rcAppUserId)}`,
      {
        headers: {
          Authorization: `Bearer ${RC_SECRET_KEY}`,
          "Content-Type": "application/json",
          "X-Platform": "stripe",
        },
        // 5-second timeout via AbortSignal
        signal: AbortSignal.timeout(5000),
      },
    );
  } catch {
    // Network error or timeout — fail open (don't block the save)
    return false;
  }

  if (!resp.ok) {
    // 404 = subscriber not found → no subscription
    return false;
  }

  let data: RCSubscriberResponse;
  try {
    data = await resp.json() as RCSubscriberResponse;
  } catch {
    return false;
  }

  const entitlement = data.subscriber.entitlements[ENTITLEMENT_ID];
  if (!entitlement) return false;

  // expires_date is null for lifetime purchases; non-null for subscriptions.
  // A subscription is active if expires_date is in the future.
  if (entitlement.expires_date === null) return true;
  return new Date(entitlement.expires_date) > new Date();
}
