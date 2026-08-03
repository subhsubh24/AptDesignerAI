import { describe, it, expect, afterEach } from "vitest";
import { NextRequest } from "next/server";

import { GET } from "@/app/api/mobile/billing-config/route";
import { RATE_LIMITS } from "@/lib/utils/rate-limiter";

// Public, unauthenticated endpoint the mobile paywall reads so its
// RevenueCat-offering gate agrees with lib/billing/stripe.ts's
// isAnnualBillingEnabled() instead of independently assuming Pro Annual is
// purchasable. Verifies the flag is reported correctly and the endpoint is
// rate-limited per IP like the other public GETs (shared-design, waitlist).

function reqFrom(ip: string): NextRequest {
  return new NextRequest(new URL("https://app.example.com/api/mobile/billing-config"), {
    headers: { "x-forwarded-for": ip },
  });
}

afterEach(() => {
  delete process.env.ANNUAL_BILLING_ENABLED;
});

describe("GET /api/mobile/billing-config", () => {
  it("reports annualBillingEnabled: false when the env flag is unset (the default, gated-off state)", async () => {
    delete process.env.ANNUAL_BILLING_ENABLED;
    const res = await GET(reqFrom("198.51.100.1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ annualBillingEnabled: false });
  });

  it("reports annualBillingEnabled: true once the owner sets the flag", async () => {
    process.env.ANNUAL_BILLING_ENABLED = "true";
    const res = await GET(reqFrom("198.51.100.2"));
    expect(await res.json()).toEqual({ annualBillingEnabled: true });
  });

  it("429s once an IP exceeds the window, with a Retry-After header", async () => {
    const ip = "198.51.100.3";
    const max = RATE_LIMITS.mobileBillingConfig.maxRequests;
    for (let i = 0; i < max; i++) {
      const ok = await GET(reqFrom(ip));
      expect(ok.status).not.toBe(429);
    }
    const blocked = await GET(reqFrom(ip));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBeTruthy();
  });

  it("keys the limit per IP — a different IP is unaffected by another's exhaustion", async () => {
    const busy = "198.51.100.4";
    const max = RATE_LIMITS.mobileBillingConfig.maxRequests;
    for (let i = 0; i <= max; i++) await GET(reqFrom(busy));
    expect((await GET(reqFrom(busy))).status).toBe(429);
    expect((await GET(reqFrom("198.51.100.5"))).status).not.toBe(429);
  });
});
