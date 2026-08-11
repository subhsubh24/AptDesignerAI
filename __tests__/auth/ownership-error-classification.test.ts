import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

// Acceptance test for APT-16: lib/auth/ownership.ts's userOwnsRoom/userOwnsProject
// used to collapse a REAL database error on the ownership check itself into the
// exact same `false` → 404 "Not found" as a genuine not-owned/missing resource —
// silently misreporting a DB outage as "this room doesn't exist" on the very
// first query every guarded route makes. The new requireRoomOwnership /
// requireProjectOwnership guards must distinguish the two. This exercises the
// REAL ownership.ts logic (not mocked) through real route callers, per the
// issue's acceptance check ("verified against at least one real caller").

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/utils/rate-limiter", () => ({
  checkRateLimit: vi.fn(() => ({ allowed: true })),
  RATE_LIMITS: {
    search: { maxRequests: 20, windowMs: 60_000 },
    analyzeApartment: { maxRequests: 20, windowMs: 60_000 },
  },
}));
vi.mock("@/lib/utils/spend-limiter", () => ({
  checkDailySpend: vi.fn(() => ({ allowed: true })),
  dailySpendExceededResponse: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";
import { POST as searchPost } from "@/app/api/search/route";
import { POST as analyzeApartmentPost } from "@/app/api/analyze-apartment/route";

const mockCreateClient = createClient as unknown as Mock;

function jsonReq(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** A Supabase client whose ONLY configured table result is the ownership check. */
function clientWithOwnershipResult(table: string, ownershipResult: { data: unknown; error: unknown }) {
  const single = vi.fn().mockResolvedValue(ownershipResult);
  const chain: Record<string, unknown> = { single };
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.select = vi.fn().mockReturnValue(chain);
  return {
    auth: { getUser: async () => ({ data: { user: { id: "owner-1" } } }) },
    from: vi.fn((t: string) => (t === table ? chain : { select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }) }) }) })),
  };
}

beforeEach(() => mockCreateClient.mockReset());
afterEach(() => vi.restoreAllMocks());

describe("POST /api/search — ownership-check error classification", () => {
  it("returns 500, not 404, when the room-ownership query itself hits a real DB error", async () => {
    mockCreateClient.mockResolvedValue(
      clientWithOwnershipResult("rooms", { data: null, error: { code: "53300", message: "too many connections" } }),
    );
    const res = await searchPost(jsonReq("http://localhost/api/search", { room_id: "room-1" }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).not.toContain("too many connections");
  });

  it("still returns 404 'Not found' for a genuine not-owned/missing room (PGRST116)", async () => {
    mockCreateClient.mockResolvedValue(
      clientWithOwnershipResult("rooms", { data: null, error: { code: "PGRST116", message: "no rows" } }),
    );
    const res = await searchPost(jsonReq("http://localhost/api/search", { room_id: "room-1" }));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Not found");
  });

  it("still returns 404 'Not found' when there is no data and no error (defensive branch)", async () => {
    mockCreateClient.mockResolvedValue(clientWithOwnershipResult("rooms", { data: null, error: null }));
    const res = await searchPost(jsonReq("http://localhost/api/search", { room_id: "room-1" }));
    expect(res.status).toBe(404);
  });
});

describe("POST /api/analyze-apartment — ownership-check error classification", () => {
  it("returns 500, not 404, when the project-ownership query itself hits a real DB error", async () => {
    mockCreateClient.mockResolvedValue(
      clientWithOwnershipResult("projects", { data: null, error: { code: "53300", message: "too many connections" } }),
    );
    const res = await analyzeApartmentPost(jsonReq("http://localhost/api/analyze-apartment", { project_id: "proj-1" }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).not.toContain("too many connections");
  });

  it("still returns 404 'Not found' for a genuine not-owned/missing project (PGRST116)", async () => {
    mockCreateClient.mockResolvedValue(
      clientWithOwnershipResult("projects", { data: null, error: { code: "PGRST116", message: "no rows" } }),
    );
    const res = await analyzeApartmentPost(jsonReq("http://localhost/api/analyze-apartment", { project_id: "proj-1" }));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Not found");
  });
});
