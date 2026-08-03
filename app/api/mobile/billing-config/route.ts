import { NextRequest, NextResponse } from "next/server";
import { isAnnualBillingEnabled } from "@/lib/billing/stripe";
import { checkRateLimit, RATE_LIMITS } from "@/lib/utils/rate-limiter";

/**
 * GET /api/mobile/billing-config
 *
 * Public, unauthenticated: reveals nothing except whether a feature is turned
 * on, the same fact app/pricing/page.tsx already renders to any visitor. The
 * mobile paywall (mobile/src/components/paywall-sheet.tsx) reads this so its
 * live-RevenueCat-offering path stays in sync with `isAnnualBillingEnabled()`
 * instead of independently assuming the annual tier is purchasable — see
 * lib/billing/stripe.ts for why annual ships gated off until migration 021.
 */
export async function GET(request: NextRequest) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";
  const limit = checkRateLimit(`mobile-billing-config:${ip}`, RATE_LIMITS.mobileBillingConfig);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil((limit.retryAfterMs || 60000) / 1000)) },
      },
    );
  }

  return NextResponse.json({ annualBillingEnabled: isAnnualBillingEnabled() });
}
