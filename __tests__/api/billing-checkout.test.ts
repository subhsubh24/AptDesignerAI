import { beforeEach, afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { NextRequest } from "next/server";

// Money path: exercise the checkout route's own control flow (auth gate, rate
// limit, body/tier validation, Stripe call, error hygiene) with Stripe and
// Supabase mocked. The rate limiter is mocked so the 429 branch is deterministic
// and its module-level counter never leaks between tests.
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/billing/stripe", () => ({ createCheckoutSession: vi.fn() }));
vi.mock("@/lib/utils/rate-limiter", () => ({
  checkRateLimit: vi.fn(),
  RATE_LIMITS: { billingCheckout: { windowMs: 3_600_000, max: 10 } },
}));

import { createClient } from "@/lib/supabase/server";
import { createCheckoutSession } from "@/lib/billing/stripe";
import { checkRateLimit } from "@/lib/utils/rate-limiter";
import { POST } from "@/app/api/billing/checkout/route";

const mockCreateClient = createClient as unknown as Mock;
const mockCreateSession = createCheckoutSession as unknown as Mock;
const mockRateLimit = checkRateLimit as unknown as Mock;

function authedAs(user: { id: string; email?: string } | null) {
  mockCreateClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user } }) },
  });
}

function checkoutReq(rawBody: string) {
  return new NextRequest("http://localhost/api/billing/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: rawBody,
  });
}

beforeEach(() => {
  mockCreateClient.mockReset();
  mockCreateSession.mockReset();
  mockRateLimit.mockReset();
  // Default: authenticated user + rate limit open. Individual tests override.
  authedAs({ id: "u1", email: "buyer@example.com" });
  mockRateLimit.mockReturnValue({ allowed: true });
});
afterEach(() => vi.restoreAllMocks());

describe("POST /api/billing/checkout", () => {
  it("returns 401 when unauthenticated (never touches Stripe)", async () => {
    authedAs(null);
    const res = await POST(checkoutReq(JSON.stringify({ tier: "pro" })));
    expect(res.status).toBe(401);
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it("returns 429 with Retry-After when rate limited", async () => {
    mockRateLimit.mockReturnValue({ allowed: false, retryAfterMs: 3_600_000 });
    const res = await POST(checkoutReq(JSON.stringify({ tier: "pro" })));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("3600");
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it("returns 400 on a malformed JSON body", async () => {
    const res = await POST(checkoutReq("{not json"));
    expect(res.status).toBe(400);
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it("returns 400 on an unknown tier", async () => {
    const res = await POST(checkoutReq(JSON.stringify({ tier: "platinum" })));
    expect(res.status).toBe(400);
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it("returns 400 when tier is missing", async () => {
    const res = await POST(checkoutReq(JSON.stringify({})));
    expect(res.status).toBe(400);
  });

  it.each(["apartment", "pro", "pro_annual"])(
    "creates a checkout session for the %s tier and returns sessionId + url",
    async (tier) => {
      mockCreateSession.mockResolvedValue({ sessionId: "cs_123", url: "https://stripe.test/cs_123" });
      const res = await POST(checkoutReq(JSON.stringify({ tier })));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ sessionId: "cs_123", url: "https://stripe.test/cs_123" });
      // The authenticated user's id/email and the requested tier are passed through —
      // never trusted from anything client-supplied beyond the validated tier.
      const arg = mockCreateSession.mock.calls[0][0];
      expect(arg.tier).toBe(tier);
      expect(arg.userId).toBe("u1");
      expect(arg.userEmail).toBe("buyer@example.com");
      expect(arg.successUrl).toContain(`tier=${tier}`);
    },
  );

  it("returns a generic 500 (no raw error leak) when Stripe fails", async () => {
    mockCreateSession.mockRejectedValue(new Error("price_xxx is archived in account acct_123"));
    const res = await POST(checkoutReq(JSON.stringify({ tier: "pro" })));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Failed to create checkout session. Please try again.");
    expect(JSON.stringify(body)).not.toContain("acct_123");
  });
});
