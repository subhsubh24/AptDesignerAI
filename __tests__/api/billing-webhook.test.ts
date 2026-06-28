import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { NextRequest } from "next/server";

// The webhook route's external collaborators are all mocked so the test exercises
// the route's own control flow (signature gate, transition detection, lifecycle
// email triggers, idempotency) without Stripe, Supabase, or a real email send.
vi.mock("@/lib/billing/stripe", () => ({
  constructWebhookEvent: vi.fn(),
  extractBillingInfoFromEvent: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ getAdminClient: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async () => ({ delivered: false, dryRun: true })) }));

import { constructWebhookEvent, extractBillingInfoFromEvent } from "@/lib/billing/stripe";
import { getAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { POST } from "@/app/api/billing/webhook/route";

const mockConstruct = constructWebhookEvent as unknown as Mock;
const mockExtract = extractBillingInfoFromEvent as unknown as Mock;
const mockGetAdmin = getAdminClient as unknown as Mock;
const mockSendEmail = sendEmail as unknown as Mock;

interface AdminOpts {
  existingStatus?: string; // undefined => no prior row
  upsertError?: unknown;
  userEmail?: string;
}
function fakeAdmin(o: AdminOpts = {}) {
  return {
    from() {
      const builder: Record<string, unknown> = {};
      Object.assign(builder, {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () => ({
          data: o.existingStatus === undefined ? null : { status: o.existingStatus },
          error: null,
        }),
        upsert: async () => ({ error: o.upsertError ?? null }),
      });
      return builder;
    },
    auth: {
      admin: {
        getUserById: async () => ({ data: { user: { email: o.userEmail ?? "user@example.com" } } }),
      },
    },
  };
}

function webhookReq() {
  return new NextRequest("http://localhost/api/billing/webhook", {
    method: "POST",
    headers: { "stripe-signature": "sig_test", "content-type": "application/json" },
    body: "{}",
  });
}

// The lifecycle emails are fired fire-and-forget (void). Flush microtasks/timers
// so the async getUserById → sendEmail chain settles before we assert on it.
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  mockConstruct.mockReset();
  mockExtract.mockReset();
  mockGetAdmin.mockReset();
  mockSendEmail.mockClear();
});
afterEach(() => vi.restoreAllMocks());

describe("POST /api/billing/webhook", () => {
  it("returns 400 when the signature can't be verified (never touches the DB)", async () => {
    mockConstruct.mockImplementation(() => {
      throw new Error("No signatures found matching the expected signature");
    });
    const res = await POST(webhookReq());
    expect(res.status).toBe(400);
    expect(mockGetAdmin).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("acknowledges an unhandled event type with processed:false (no DB write)", async () => {
    mockConstruct.mockReturnValue({ type: "invoice.paid" });
    mockExtract.mockReturnValue(null);
    const res = await POST(webhookReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.processed).toBe(false);
    expect(mockGetAdmin).not.toHaveBeenCalled();
  });

  it("returns 503 when the admin client is unavailable", async () => {
    mockConstruct.mockReturnValue({ type: "checkout.session.completed" });
    mockExtract.mockReturnValue({
      tier: "pro",
      status: "active",
      userId: "u1",
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
      currentPeriodEnd: new Date("2026-01-01T00:00:00Z"),
    });
    mockGetAdmin.mockReturnValue(null);
    const res = await POST(webhookReq());
    expect(res.status).toBe(503);
  });

  it("returns 500 when the stripe_customers upsert fails", async () => {
    mockConstruct.mockReturnValue({ type: "checkout.session.completed" });
    mockExtract.mockReturnValue({
      tier: "pro",
      status: "active",
      userId: "u1",
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
      currentPeriodEnd: null,
    });
    mockGetAdmin.mockReturnValue(fakeAdmin({ upsertError: { message: "constraint violation" } }));
    const res = await POST(webhookReq());
    expect(res.status).toBe(500);
    const body = await res.json();
    // Error hygiene: a generic message, never the raw DB error string.
    expect(body.error).toBe("Database error");
  });

  it("on a genuine free→paid activation, upserts and sends the welcome-to-Pro email", async () => {
    mockConstruct.mockReturnValue({ type: "checkout.session.completed" });
    mockExtract.mockReturnValue({
      tier: "pro",
      status: "active",
      userId: "u1",
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
      currentPeriodEnd: new Date("2026-01-01T00:00:00Z"),
    });
    mockGetAdmin.mockReturnValue(fakeAdmin({ existingStatus: undefined, userEmail: "new@pro.com" }));
    const res = await POST(webhookReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.processed).toBe(true);
    // The send is fire-and-forget (getUserById → sendEmail, two awaits); wait
    // for it deterministically rather than racing a single microtask flush.
    await vi.waitFor(() => expect(mockSendEmail).toHaveBeenCalledTimes(1));
    const arg = mockSendEmail.mock.calls[0][0];
    expect(arg.stage).toBe("paid_welcome_1");
    expect(arg.to).toBe("new@pro.com");
  });

  it("suppresses the welcome email on a renewal (already active — idempotent)", async () => {
    mockConstruct.mockReturnValue({ type: "checkout.session.completed" });
    mockExtract.mockReturnValue({
      tier: "pro",
      status: "active",
      userId: "u1",
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
      currentPeriodEnd: new Date("2026-02-01T00:00:00Z"),
    });
    mockGetAdmin.mockReturnValue(fakeAdmin({ existingStatus: "active" }));
    const res = await POST(webhookReq());
    expect(res.status).toBe(200);
    await flush();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("on a genuine cancellation, marks cancelled and sends the win-back email", async () => {
    mockConstruct.mockReturnValue({ type: "customer.subscription.deleted" });
    mockExtract.mockReturnValue({
      tier: "pro",
      status: "cancelled",
      userId: "u1",
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
      currentPeriodEnd: null,
    });
    mockGetAdmin.mockReturnValue(fakeAdmin({ existingStatus: "active", userEmail: "leaving@pro.com" }));
    const res = await POST(webhookReq());
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(mockSendEmail).toHaveBeenCalledTimes(1));
    expect(mockSendEmail.mock.calls[0][0].stage).toBe("winback_1");
  });

  it("suppresses the win-back email when the row was already cancelled (redelivery)", async () => {
    mockConstruct.mockReturnValue({ type: "customer.subscription.deleted" });
    mockExtract.mockReturnValue({
      tier: "pro",
      status: "cancelled",
      userId: "u1",
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
      currentPeriodEnd: null,
    });
    mockGetAdmin.mockReturnValue(fakeAdmin({ existingStatus: "cancelled" }));
    const res = await POST(webhookReq());
    expect(res.status).toBe(200);
    await flush();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});
