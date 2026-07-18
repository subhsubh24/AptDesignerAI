import { beforeEach, afterEach, describe, expect, it, vi, type Mock } from "vitest";

// Destructive account-deletion path (Apple 5.1.1(v)). Exercise the route's
// control flow — auth gate, rate limit, admin availability, cascade delete,
// error hygiene — with Supabase mocked. The rate limiter is mocked so the 429
// branch is deterministic and its module-level counter never leaks between tests.
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ getAdminClient: vi.fn() }));
vi.mock("@/lib/utils/rate-limiter", () => ({
  checkRateLimit: vi.fn(),
  RATE_LIMITS: { userDelete: { windowMs: 86_400_000, max: 3 } },
}));
vi.mock("@/lib/billing/stripe", () => ({
  isStripeConfigured: vi.fn(),
  cancelSubscription: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit } from "@/lib/utils/rate-limiter";
import { isStripeConfigured, cancelSubscription } from "@/lib/billing/stripe";
import { DELETE } from "@/app/api/user/delete/route";

const mockCreateClient = createClient as unknown as Mock;
const mockGetAdmin = getAdminClient as unknown as Mock;
const mockRateLimit = checkRateLimit as unknown as Mock;
const mockStripeConfigured = isStripeConfigured as unknown as Mock;
const mockCancelSub = cancelSubscription as unknown as Mock;

function authedAs(user: { id: string } | null) {
  mockCreateClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user } }) },
  });
}

// Build a fake admin client. `billing` (when provided) is the stripe_customers
// row the deletion path reads before cancelling; omit it (default null) to model
// a user with no billing record.
function fakeAdmin(
  deleteResult: { error: unknown },
  billing: { stripe_subscription_id: string | null; status: string } | null = null,
  billingError: unknown = null,
) {
  const deleteUser = vi.fn(async () => deleteResult);
  const maybeSingle = vi.fn(async () => ({ data: billingError ? null : billing, error: billingError }));
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { admin: { auth: { admin: { deleteUser } }, from }, deleteUser, from };
}

beforeEach(() => {
  mockCreateClient.mockReset();
  mockGetAdmin.mockReset();
  mockRateLimit.mockReset();
  mockStripeConfigured.mockReset();
  mockCancelSub.mockReset();
  authedAs({ id: "u1" });
  mockRateLimit.mockReturnValue({ allowed: true });
  // Default: Stripe not configured (pre-launch) — the billing branch is a no-op,
  // so the base-case tests below exercise the pre-existing control flow unchanged.
  mockStripeConfigured.mockReturnValue(false);
});
afterEach(() => vi.restoreAllMocks());

describe("DELETE /api/user/delete", () => {
  it("returns 401 when unauthenticated (never touches the admin client)", async () => {
    authedAs(null);
    const res = await DELETE();
    expect(res.status).toBe(401);
    expect(mockGetAdmin).not.toHaveBeenCalled();
  });

  it("returns 429 with Retry-After when rate limited", async () => {
    mockRateLimit.mockReturnValue({ allowed: false, retryAfterMs: 86_400_000 });
    const res = await DELETE();
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("86400");
    expect(mockGetAdmin).not.toHaveBeenCalled();
  });

  it("returns 503 when the admin client is unavailable", async () => {
    mockGetAdmin.mockReturnValue(null);
    const res = await DELETE();
    expect(res.status).toBe(503);
  });

  it("deletes the authenticated user's auth record and returns success", async () => {
    const { admin, deleteUser } = fakeAdmin({ error: null });
    mockGetAdmin.mockReturnValue(admin);
    const res = await DELETE();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true });
    // Cascade is keyed on the SESSION user's id, never a client-supplied id.
    expect(deleteUser).toHaveBeenCalledWith("u1");
  });

  it("returns a generic 500 (no raw error leak) when the cascade delete fails", async () => {
    const { admin } = fakeAdmin({ error: { message: "auth.users FK violation on table profiles" } });
    mockGetAdmin.mockReturnValue(admin);
    const res = await DELETE();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Failed to delete account. Please try again or contact support.");
    expect(JSON.stringify(body)).not.toContain("profiles");
  });

  it("cancels a LIVE Stripe subscription before deleting the account", async () => {
    mockStripeConfigured.mockReturnValue(true);
    const { admin, deleteUser } = fakeAdmin(
      { error: null },
      { stripe_subscription_id: "sub_123", status: "active" },
    );
    mockGetAdmin.mockReturnValue(admin);
    const res = await DELETE();
    expect(res.status).toBe(200);
    expect(mockCancelSub).toHaveBeenCalledWith("sub_123");
    expect(deleteUser).toHaveBeenCalledWith("u1");
    // Cancellation must precede deletion — never orphan a charging subscription.
    expect(mockCancelSub.mock.invocationCallOrder[0]).toBeLessThan(
      deleteUser.mock.invocationCallOrder[0],
    );
  });

  it("does NOT call Stripe when there is no billing record", async () => {
    mockStripeConfigured.mockReturnValue(true);
    const { admin, deleteUser } = fakeAdmin({ error: null }, null);
    mockGetAdmin.mockReturnValue(admin);
    const res = await DELETE();
    expect(res.status).toBe(200);
    expect(mockCancelSub).not.toHaveBeenCalled();
    expect(deleteUser).toHaveBeenCalledWith("u1");
  });

  it("skips cancellation for an already-cancelled subscription (no-op), still deletes", async () => {
    mockStripeConfigured.mockReturnValue(true);
    const { admin, deleteUser } = fakeAdmin(
      { error: null },
      { stripe_subscription_id: "sub_123", status: "cancelled" },
    );
    mockGetAdmin.mockReturnValue(admin);
    const res = await DELETE();
    expect(res.status).toBe(200);
    expect(mockCancelSub).not.toHaveBeenCalled();
    expect(deleteUser).toHaveBeenCalledWith("u1");
  });

  it("skips the billing lookup entirely when Stripe is unconfigured (pre-launch)", async () => {
    mockStripeConfigured.mockReturnValue(false);
    const { admin, from, deleteUser } = fakeAdmin(
      { error: null },
      { stripe_subscription_id: "sub_123", status: "active" },
    );
    mockGetAdmin.mockReturnValue(admin);
    const res = await DELETE();
    expect(res.status).toBe(200);
    expect(from).not.toHaveBeenCalled();
    expect(mockCancelSub).not.toHaveBeenCalled();
    expect(deleteUser).toHaveBeenCalledWith("u1");
  });

  it("returns 502 and does NOT delete when the billing lookup itself fails (fail closed)", async () => {
    mockStripeConfigured.mockReturnValue(true);
    const { admin, deleteUser } = fakeAdmin(
      { error: null },
      null,
      { message: "stripe_customers connection reset" },
    );
    mockGetAdmin.mockReturnValue(admin);
    const res = await DELETE();
    expect(res.status).toBe(502);
    // Can't confirm there's no live subscription → must not delete + orphan it.
    expect(mockCancelSub).not.toHaveBeenCalled();
    expect(deleteUser).not.toHaveBeenCalled();
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain("connection reset");
  });

  it("returns 502 and does NOT delete when subscription cancellation fails", async () => {
    mockStripeConfigured.mockReturnValue(true);
    mockCancelSub.mockRejectedValue(new Error("stripe timeout"));
    const { admin, deleteUser } = fakeAdmin(
      { error: null },
      { stripe_subscription_id: "sub_123", status: "active" },
    );
    mockGetAdmin.mockReturnValue(admin);
    const res = await DELETE();
    expect(res.status).toBe(502);
    // The account (and its billing mapping) is preserved so the user can retry —
    // never orphan a live subscription by deleting after a failed cancel.
    expect(deleteUser).not.toHaveBeenCalled();
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain("stripe timeout");
  });
});
