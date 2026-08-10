import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

// Regression guard for POST /api/search's room fetch — the same DB-error-as-404
// bug shape fixed elsewhere in this PR. userOwnsRoom() already confirmed the
// room exists moments before this fetch, so a miss here on anything but a
// genuine PGRST116 "zero rows" is a real DB failure, not a not-found, and must
// surface as a 500 rather than the misleading "Room not found" 404.

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth/ownership", () => ({ userOwnsRoom: vi.fn() }));
vi.mock("@/lib/utils/rate-limiter", () => ({
  checkRateLimit: vi.fn(() => ({ allowed: true })),
  RATE_LIMITS: { search: { maxRequests: 20, windowMs: 60_000 } },
}));
vi.mock("@/lib/utils/spend-limiter", () => ({
  checkDailySpend: vi.fn(() => ({ allowed: true })),
  dailySpendExceededResponse: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";
import { userOwnsRoom } from "@/lib/auth/ownership";
import { POST as searchPost } from "@/app/api/search/route";

const mockCreateClient = createClient as unknown as Mock;
const mockUserOwnsRoom = userOwnsRoom as unknown as Mock;

function jsonReq(body: unknown): Request {
  return new Request("http://localhost/api/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function clientWithRoomFetch(roomResult: { data: unknown; error: unknown }) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: "owner-1" } } }) },
    from: (table: string) => {
      if (table === "rooms") {
        return { select: () => ({ eq: () => ({ single: async () => roomResult }) }) };
      }
      return {};
    },
  };
}

beforeEach(() => {
  mockCreateClient.mockReset();
  mockUserOwnsRoom.mockReset();
  mockUserOwnsRoom.mockResolvedValue(true);
});
afterEach(() => vi.restoreAllMocks());

describe("POST /api/search — room fetch error classification", () => {
  it("returns 500, not 404, for a real database error on the room fetch", async () => {
    mockCreateClient.mockResolvedValue(
      clientWithRoomFetch({ data: null, error: { code: "53300", message: "too many connections" } }),
    );
    const res = await searchPost(jsonReq({ room_id: "room-1" }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).not.toContain("too many connections");
  });

  it("still returns 404 'Room not found' for the genuine PGRST116 race case", async () => {
    mockCreateClient.mockResolvedValue(
      clientWithRoomFetch({ data: null, error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" } }),
    );
    const res = await searchPost(jsonReq({ room_id: "room-1" }));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Room not found");
  });
});
