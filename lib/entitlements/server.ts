/**
 * Server-side RevenueCat entitlement check.
 *
 * Uses the RC REST API to verify subscription status without trusting the
 * client. Requires REVENUECAT_SECRET_KEY (server-only env var, never exposed
 * to the client).
 *
 * Two distinct failure modes are handled differently:
 *   - MISCONFIGURATION (key unset): a deploy-time mistake. In production this
 *     fails CLOSED (returns false) with a loud console.error so it can't
 *     silently grant Pro to every user; in development it fails OPEN so local
 *     work isn't blocked. Production must set the key via PENDING_OPS.md.
 *   - RUNTIME OUTAGE (key set, RC API errors/times out): fails OPEN (returns
 *     true) so paying subscribers are never denied service during an RC outage.
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
 * On a missing key (misconfiguration) fails CLOSED in production and OPEN in
 * development; on a runtime RC outage fails OPEN so paying subscribers are not
 * blocked. Logs an error to surface the misconfiguration either way.
 */
export async function hasProEntitlement(rcAppUserId: string): Promise<boolean> {
  if (!RC_SECRET_KEY) {
    const isProduction = process.env.NODE_ENV === "production";
    console.error(
      "[entitlements] REVENUECAT_SECRET_KEY is not configured — " +
      (isProduction
        ? "denying Pro entitlement (fail-closed in production)"
        : "granting access (fail-open in development)") +
      ". Set the key in Vercel env vars (see PENDING_OPS.md).",
    );
    return !isProduction;
  }

  let resp: Response;
  try {
    resp = await fetch(
      `${RC_API_BASE}/subscribers/${encodeURIComponent(rcAppUserId)}`,
      {
        headers: {
          Authorization: `Bearer ${RC_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
        // 5-second timeout via AbortSignal
        signal: AbortSignal.timeout(5000),
      },
    );
  } catch {
    // Network error or timeout — fail open (don't block saves on RC outage)
    return true;
  }

  if (!resp.ok) {
    // 404 = subscriber not found in RC → no subscription
    if (resp.status === 404) return false;
    // Any other non-2xx (500, rate limit, etc.) — fail open
    return true;
  }

  let data: RCSubscriberResponse;
  try {
    data = await resp.json() as RCSubscriberResponse;
  } catch {
    return true;
  }

  // A 200 whose body parsed but lacks the expected shape (missing `subscriber`
  // or `entitlements`) is an RC glitch, not a definitive "no subscription" —
  // treat it like the parse-error and 5xx paths above and fail OPEN so a paying
  // subscriber is never blocked by a malformed response. Reading
  // `data.subscriber.entitlements` unguarded would instead throw an uncaught
  // TypeError on the entitlement critical path (e.g. on `{}` or `{subscriber:null}`).
  const entitlements = data.subscriber?.entitlements;
  if (!entitlements || typeof entitlements !== "object") return true;

  const entitlement = entitlements[ENTITLEMENT_ID];
  if (!entitlement) return false;

  // expires_date is null for lifetime purchases; non-null for subscriptions.
  // A subscription is active if expires_date is in the future.
  if (entitlement.expires_date === null) return true;
  return new Date(entitlement.expires_date) > new Date();
}
