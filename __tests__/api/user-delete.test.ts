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
vi.mock("@/lib/storage/user-storage", () => ({
  purgeUserStorage: vi.fn(),
  StoragePurgeError: class StoragePurgeError extends Error {},
}));

import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { purgeUserStorage } from "@/lib/storage/user-storage";
import { checkRateLimit } from "@/lib/utils/rate-limiter";
import { DELETE } from "@/app/api/user/delete/route";

const mockCreateClient = createClient as unknown as Mock;
const mockGetAdmin = getAdminClient as unknown as Mock;
const mockRateLimit = checkRateLimit as unknown as Mock;
const mockPurge = purgeUserStorage as unknown as Mock;

function authedAs(user: { id: string } | null) {
  mockCreateClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user } }) },
  });
}

function fakeAdmin(deleteResult: { error: unknown }) {
  const deleteUser = vi.fn(async () => deleteResult);
  return { admin: { auth: { admin: { deleteUser } } }, deleteUser };
}

beforeEach(() => {
  mockCreateClient.mockReset();
  mockGetAdmin.mockReset();
  mockRateLimit.mockReset();
  mockPurge.mockReset();
  authedAs({ id: "u1" });
  mockRateLimit.mockReturnValue({ allowed: true });
  mockPurge.mockResolvedValue({ removed: 0 });
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

  it("purges the user's stored objects BEFORE the cascade removes the rows that attribute them", async () => {
    const order: string[] = [];
    mockPurge.mockImplementation(async () => {
      order.push("purge");
      return { removed: 2 };
    });
    const deleteUser = vi.fn(async () => {
      order.push("deleteUser");
      return { error: null };
    });
    mockGetAdmin.mockReturnValue({ auth: { admin: { deleteUser } } });

    const res = await DELETE();

    expect(res.status).toBe(200);
    expect(mockPurge).toHaveBeenCalledWith(expect.anything(), "u1");
    expect(order).toEqual(["purge", "deleteUser"]);
  });

  it("does NOT delete the account when the storage purge fails", async () => {
    // Reporting success while the user's photos stay publicly fetchable is the
    // fake-success failure mode; the account must survive so a retry can finish
    // the job (the purge is idempotent).
    mockPurge.mockRejectedValue(new Error("storage list failed: network down"));
    const { admin, deleteUser } = fakeAdmin({ error: null });
    mockGetAdmin.mockReturnValue(admin);

    const res = await DELETE();

    expect(res.status).toBe(500);
    expect(deleteUser).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.error).toContain("stored images");
    // No raw storage error text leaks to the client.
    expect(JSON.stringify(body)).not.toContain("network down");
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
});
