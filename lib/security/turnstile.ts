// Cloudflare Turnstile verification for public (unauthenticated) forms (G5).
//
// Bot/abuse protection on public POSTs. Like the email/RevenueCat integrations,
// this ships CLOSED-but-inert: until the owner sets TURNSTILE_SECRET_KEY it is
// disabled and verifyTurnstile() returns success (fail-open), so the waitlist
// keeps working with no key. Once the secret is set, a request must carry a
// valid Turnstile token or it is rejected.
//
// Failure policy when ENABLED:
//   - missing / malformed token  -> reject (a bot that skips the widget fails).
//   - token present but invalid   -> reject (Cloudflare says it's not human).
//   - Cloudflare unreachable      -> ALLOW (don't lock real users out of the
//                                    funnel during a third-party outage). This
//                                    is the deliberate trade-off for a low-stakes
//                                    public form; rate limiting still applies.

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** True when a secret key is configured (the owner has opted in). */
export function isTurnstileEnabled(): boolean {
  const key = process.env.TURNSTILE_SECRET_KEY;
  return typeof key === "string" && key.trim().length > 0;
}

export interface TurnstileResult {
  success: boolean;
  /** Machine-readable reason for logging; never returned to the client. */
  reason?: "disabled" | "missing_token" | "rejected" | "unreachable";
}

/**
 * Verify a Turnstile token against Cloudflare's siteverify API.
 * @param token the `cf-turnstile-response` value from the client widget.
 * @param remoteIp optional client IP for Cloudflare's risk scoring.
 */
export async function verifyTurnstile(
  token: string | null | undefined,
  remoteIp?: string,
): Promise<TurnstileResult> {
  if (!isTurnstileEnabled()) return { success: true, reason: "disabled" };
  if (typeof token !== "string" || token.trim().length === 0) {
    return { success: false, reason: "missing_token" };
  }

  const body = new URLSearchParams();
  body.set("secret", process.env.TURNSTILE_SECRET_KEY as string);
  body.set("response", token);
  if (remoteIp && remoteIp !== "unknown") body.set("remoteip", remoteIp);

  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      // This runs on every public-form POST (signup/waitlist). A stalled
      // Cloudflare connection must not block the funnel: time out at 5s and
      // fall through to the fail-open "unreachable" branch below.
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { success: true, reason: "unreachable" };
    const data = (await res.json()) as { success?: boolean };
    return data.success === true
      ? { success: true }
      : { success: false, reason: "rejected" };
  } catch {
    // Network/parse error talking to Cloudflare — fail open (see policy above).
    return { success: true, reason: "unreachable" };
  }
}
