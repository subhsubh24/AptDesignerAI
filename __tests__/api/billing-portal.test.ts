import { beforeEach, afterEach, describe, expect, it, vi, type Mock } from "vitest";

// Guards the self-serve billing-portal route: it must (a) require auth, (b)
// resolve the Stripe customer id from the CURRENT user's own stripe_customers
// row (never a client-supplied id), (c) 404 when the user has no customer, and
// (d) return the Stripe portal url on success.
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/billing/stripe", () => ({ createBillingPortalSession: vi.fn() }));
vi.mock("@/lib/utils/rate-limiter", () => ({
  checkRateLimit: vi.fn(() => ({ allowed: true })),
  RATE_LIMITS: { billingCheckout: { max: 10, windowMs: 1000 } },
}));

import { createClient } from "@/lib/supabase/server";
import { createBillingPortalSession } from "@/lib/billing/stripe";
import { POST as portalPost } from "@/app/api/billing/portal/route";

const mockCreateClient = createClient as unknown as Mock;
const mockPortal = createBillingPortalSession as unknown as Mock;

function client(user: { id: string } | null, customerRow: { stripe_customer_id: string } | null) {
  const from = vi.fn(() => {
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn().mockReturnValue(chain);
    chain.eq = vi.fn().mockReturnValue(chain);
    chain.maybeSingle = vi.fn().mockResolvedValue({ data: customerRow, error: null });
    return chain;
  });
  mockCreateClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user } }) },
    from,
  });
}

beforeEach(() => {
  mockCreateClient.mockReset();
  mockPortal.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("POST /api/billing/portal", () => {
  it("401s when unauthenticated and never touches Stripe", async () => {
    client(null, null);
    const res = await portalPost();
    expect(res.status).toBe(401);
    expect(mockPortal).not.toHaveBeenCalled();
  });

  it("404s when the user has no Stripe customer row", async () => {
    client({ id: "free-user" }, null);
    const res = await portalPost();
    expect(res.status).toBe(404);
    expect(mockPortal).not.toHaveBeenCalled();
  });

  it("returns the portal url built from the user's own customer id", async () => {
    client({ id: "sub-user" }, { stripe_customer_id: "cus_123" });
    mockPortal.mockResolvedValue({ url: "https://billing.stripe.com/session/xyz" });
    const res = await portalPost();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: "https://billing.stripe.com/session/xyz" });
    // Customer id came from the DB row, not the client.
    expect(mockPortal).toHaveBeenCalledWith("cus_123", expect.stringContaining("/account"));
  });

  it("502s (not a fake success) when the Stripe call throws", async () => {
    client({ id: "sub-user" }, { stripe_customer_id: "cus_123" });
    mockPortal.mockRejectedValue(new Error("stripe down"));
    const res = await portalPost();
    expect(res.status).toBe(502);
  });
});
