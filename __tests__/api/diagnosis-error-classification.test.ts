import { beforeEach, afterEach, describe, expect, it, vi, type Mock } from "vitest";

// Regression guard: POST /api/diagnosis discarded `error` on the room fetch,
// silently collapsing a real DB failure (timeout, RLS denial, connection
// reset) into the same 404 "Room not found" as a legitimate not-found room,
// with nothing surfaced to the caller as a retryable failure. Mirrors the
// sibling fix in app/api/bundles/evaluate/route.ts and
// app/api/rooms/[roomId]/route.ts.

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth/ownership", () => ({ requireRoomOwnership: vi.fn() }));
vi.mock("@/lib/utils/rate-limiter", () => ({
  checkRateLimit: vi.fn(() => ({ allowed: true })),
  RATE_LIMITS: { diagnosis: {} },
}));
vi.mock("@/lib/utils/spend-limiter", () => ({
  checkDailySpend: vi.fn(() => ({ allowed: true })),
  dailySpendExceededResponse: vi.fn(),
}));
vi.mock("@/lib/db/agent-runs", () => ({
  createAgentRun: vi.fn(async () => ({ id: "agent-run-1" })),
  completeAgentRun: vi.fn(async () => {}),
}));
vi.mock("@/lib/agents/room-diagnostician", () => ({
  runRoomDiagnosis: vi.fn(),
  reconcileStyleLabel: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";
import { requireRoomOwnership } from "@/lib/auth/ownership";
import { runRoomDiagnosis } from "@/lib/agents/room-diagnostician";
import { POST as diagnosisPost } from "@/app/api/diagnosis/route";

const mockCreateClient = createClient as unknown as Mock;
const mockRequireRoomOwnership = requireRoomOwnership as unknown as Mock;
const mockRunRoomDiagnosis = runRoomDiagnosis as unknown as Mock;

function makeClient(roomResult: { data: unknown; error?: unknown }) {
  const from = vi.fn((table: string) => {
    if (table === "rooms") {
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn().mockReturnValue(chain);
      chain.eq = vi.fn().mockReturnValue(chain);
      chain.single = vi.fn().mockResolvedValue({ error: null, ...roomResult });
      return chain;
    }
    return {};
  });
  mockCreateClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: "owner-1" } } }) },
    from,
  });
}

function req(body: unknown) {
  return new Request("http://localhost/api/diagnosis", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockCreateClient.mockReset();
  mockRequireRoomOwnership.mockReset();
  mockRunRoomDiagnosis.mockReset();
  mockRequireRoomOwnership.mockResolvedValue(null);
});
afterEach(() => vi.restoreAllMocks());

describe("POST /api/diagnosis — room-fetch error classification", () => {
  it("returns 404 'Room not found' when the room is genuinely absent (PGRST116)", async () => {
    makeClient({ data: null, error: { code: "PGRST116", message: "no rows" } });
    const res = await diagnosisPost(req({ room_id: "missing-room" }));
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe("Room not found");
    expect(mockRunRoomDiagnosis).not.toHaveBeenCalled();
  });

  it("returns 500 (not 404) when the room fetch hits a real DB error", async () => {
    makeClient({ data: null, error: { code: "53300", message: "too many connections" } });
    const res = await diagnosisPost(req({ room_id: "room-1" }));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).not.toBe("Room not found");
    expect(json.error).toBe("Something went wrong. Please try again.");
    // The paid diagnosis pipeline must never run on a DB failure.
    expect(mockRunRoomDiagnosis).not.toHaveBeenCalled();
  });
});
