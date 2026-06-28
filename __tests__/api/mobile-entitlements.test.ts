import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { NextRequest } from "next/server";

// Mock the Supabase JS client (token verification) and the server-side
// entitlement check so the test exercises the route's auth + response shape
// without RevenueCat or a real Supabase backend.
const mockGetUser = vi.fn();
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ auth: { getUser: mockGetUser } })),
}));
vi.mock("@/lib/entitlements/server", () => ({ hasProEntitlement: vi.fn() }));

import { hasProEntitlement } from "@/lib/entitlements/server";
import { GET } from "@/app/api/mobile/entitlements/route";

const mockHasPro = hasProEntitlement as unknown as Mock;

function req(authHeader?: string) {
  const headers: Record<string, string> = {};
  if (authHeader) headers["Authorization"] = authHeader;
  return new NextRequest("http://localhost/api/mobile/entitlements", { headers });
}

beforeEach(() => {
  mockGetUser.mockReset();
  mockHasPro.mockReset();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-test-key");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET /api/mobile/entitlements", () => {
  it("returns 401 with no Authorization header (never checks entitlement)", async () => {
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(mockHasPro).not.toHaveBeenCalled();
  });

  it("returns 401 when the header is present but not a Bearer token", async () => {
    const res = await GET(req("Basic abc"));
    expect(res.status).toBe(401);
  });

  it("returns 503 when Supabase env config is missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    const res = await GET(req("Bearer tok"));
    expect(res.status).toBe(503);
    expect(mockHasPro).not.toHaveBeenCalled();
  });

  it("returns 401 when the token fails to resolve to a user", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: "bad jwt" } });
    const res = await GET(req("Bearer bad-token"));
    expect(res.status).toBe(401);
    expect(mockHasPro).not.toHaveBeenCalled();
  });

  it("grants Pro capabilities for an entitled user", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    mockHasPro.mockResolvedValue(true);
    const res = await GET(req("Bearer good-token"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ tier: "pro", isPro: true, canSaveDesigns: true, canAnalyze: true });
    // Entitlement must be resolved server-side from the authenticated user id.
    expect(mockHasPro).toHaveBeenCalledWith("user-1");
  });

  it("returns free capabilities (no save) for a non-entitled user", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-2" } }, error: null });
    mockHasPro.mockResolvedValue(false);
    const res = await GET(req("Bearer good-token"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ tier: "free", isPro: false, canSaveDesigns: false, canAnalyze: true });
  });
});
