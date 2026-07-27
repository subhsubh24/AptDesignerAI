import { beforeEach, afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { NextRequest } from "next/server";

/**
 * The native in-app deletion path (Apple 5.1.1(v) — the App Store requires an
 * in-app way to delete the account AND its associated data). It had no test at
 * all; these pin the same two properties the web route guarantees: stored
 * objects are purged BEFORE the cascade destroys the rows that attribute them,
 * and a failed purge never reports a successful deletion.
 */
vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ getAdminClient: vi.fn() }));
vi.mock("@/lib/utils/rate-limiter", () => ({
  checkRateLimit: vi.fn(),
  RATE_LIMITS: { userDelete: { windowMs: 86_400_000, max: 3 } },
}));
vi.mock("@/lib/storage/user-storage", () => ({
  purgeUserStorage: vi.fn(),
  StoragePurgeError: class StoragePurgeError extends Error {},
}));

import { createClient } from "@supabase/supabase-js";
import { getAdminClient } from "@/lib/supabase/admin";
import { purgeUserStorage } from "@/lib/storage/user-storage";
import { checkRateLimit } from "@/lib/utils/rate-limiter";
import { DELETE } from "@/app/api/mobile/account/route";

const mockAnonClient = createClient as unknown as Mock;
const mockGetAdmin = getAdminClient as unknown as Mock;
const mockRateLimit = checkRateLimit as unknown as Mock;
const mockPurge = purgeUserStorage as unknown as Mock;

function req(token: string | null = "tok") {
  return new NextRequest("http://localhost/api/mobile/account", {
    method: "DELETE",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

function tokenResolvesTo(user: { id: string } | null) {
  mockAnonClient.mockReturnValue({
    auth: { getUser: async () => ({ data: { user }, error: user ? null : { message: "bad jwt" } }) },
  });
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  mockAnonClient.mockReset();
  mockGetAdmin.mockReset();
  mockRateLimit.mockReset();
  mockPurge.mockReset();
  tokenResolvesTo({ id: "u1" });
  mockRateLimit.mockReturnValue({ allowed: true });
  mockPurge.mockResolvedValue({ removed: 0 });
});
afterEach(() => vi.restoreAllMocks());

describe("DELETE /api/mobile/account", () => {
  it("returns 401 without a Bearer token and never touches storage or the admin client", async () => {
    const res = await DELETE(req(null));
    expect(res.status).toBe(401);
    expect(mockPurge).not.toHaveBeenCalled();
    expect(mockGetAdmin).not.toHaveBeenCalled();
  });

  it("returns 401 when the token does not resolve to a user", async () => {
    tokenResolvesTo(null);
    const res = await DELETE(req());
    expect(res.status).toBe(401);
    expect(mockPurge).not.toHaveBeenCalled();
  });

  it("purges storage before the cascade, keyed on the TOKEN's user id", async () => {
    const order: string[] = [];
    mockPurge.mockImplementation(async () => {
      order.push("purge");
      return { removed: 3 };
    });
    const deleteUser = vi.fn(async () => {
      order.push("deleteUser");
      return { error: null };
    });
    mockGetAdmin.mockReturnValue({ auth: { admin: { deleteUser } } });

    const res = await DELETE(req());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(order).toEqual(["purge", "deleteUser"]);
    // Never a client-supplied id — the id comes from validating the JWT.
    expect(mockPurge).toHaveBeenCalledWith(expect.anything(), "u1");
    expect(deleteUser).toHaveBeenCalledWith("u1");
  });

  it("does NOT delete the account when the storage purge fails", async () => {
    mockPurge.mockRejectedValue(new Error("remove from room-images: permission denied"));
    const deleteUser = vi.fn(async () => ({ error: null }));
    mockGetAdmin.mockReturnValue({ auth: { admin: { deleteUser } } });

    const res = await DELETE(req());

    expect(res.status).toBe(500);
    expect(deleteUser).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.error).toContain("stored images");
    expect(JSON.stringify(body)).not.toContain("permission denied");
  });

  it("returns 429 when rate limited, before any destructive work", async () => {
    mockRateLimit.mockReturnValue({ allowed: false, retryAfterMs: 86_400_000 });
    const res = await DELETE(req());
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("86400");
    expect(mockPurge).not.toHaveBeenCalled();
  });

  it("returns 503 when the admin client is unavailable", async () => {
    mockGetAdmin.mockReturnValue(null);
    const res = await DELETE(req());
    expect(res.status).toBe(503);
    expect(mockPurge).not.toHaveBeenCalled();
  });
});
