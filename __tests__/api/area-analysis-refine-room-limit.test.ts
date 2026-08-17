import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

// Regression guard for APT-41: the sibling-rooms fetch in POST
// /api/area-analysis/refine (used for cross-room coherence context) queried
// every other room in a project with no .limit() — unbounded as project room
// counts grow. Asserts the query builder is bounded.

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth/ownership", () => ({ requireRoomOwnership: vi.fn() }));
vi.mock("@/lib/ai/gemini", () => ({
  geminiProvider: { chat: vi.fn(async () => { throw new Error("stop-in-try-block"); }) },
}));
vi.mock("@/lib/db/agent-runs", () => ({
  createAgentRun: vi.fn(async () => ({ id: "run-1" })),
  completeAgentRun: vi.fn(async () => {}),
}));
vi.mock("@/lib/utils/rate-limiter", () => ({
  checkRateLimit: vi.fn(() => ({ allowed: true })),
  RATE_LIMITS: { areaAnalysisRefineFull: { maxRequests: 5, windowMs: 3_600_000 } },
}));
vi.mock("@/lib/utils/spend-limiter", () => ({
  checkDailySpend: vi.fn(() => ({ allowed: true })),
  dailySpendExceededResponse: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";
import { requireRoomOwnership } from "@/lib/auth/ownership";
import { POST as refinePost } from "@/app/api/area-analysis/refine/route";

const mockCreateClient = createClient as unknown as Mock;
const mockRequireRoomOwnership = requireRoomOwnership as unknown as Mock;

const OWNED_ROOM_ID = "room-owned";
const PROJECT_ID = "proj-1";

function jsonReq(body: unknown): Request {
  return new Request("http://localhost/api/area-analysis/refine", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeClient(capturedLimits: unknown[]) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: "caller-1" } } }) },
    from: vi.fn((table: string) => {
      if (table === "rooms") {
        const chain: Record<string, unknown> = {};
        let isOtherRoomsQuery = false;
        chain.select = vi.fn((sel: string) => {
          isOtherRoomsQuery = sel.includes("room_diagnoses");
          return chain;
        });
        chain.eq = vi.fn(() => chain);
        chain.neq = vi.fn(() => chain);
        chain.limit = vi.fn((n: unknown) => {
          if (isOtherRoomsQuery) capturedLimits.push(n);
          return chain;
        });
        chain.single = vi.fn(() =>
          Promise.resolve({
            data: {
              id: OWNED_ROOM_ID,
              project_id: PROJECT_ID,
              name: "Living Room",
              room_type: "living_room",
              room_images: [],
              user_context: null,
            },
            error: null,
          }),
        );
        // The otherRooms fetch is awaited directly (no .single()).
        chain.then = (resolve: (v: unknown) => unknown) =>
          Promise.resolve({ data: [], error: null }).then(resolve);
        return chain;
      }
      if (table === "projects") {
        const chain: Record<string, unknown> = {};
        chain.select = vi.fn(() => chain);
        chain.eq = vi.fn(() => chain);
        chain.single = vi.fn(() => Promise.resolve({ data: { id: PROJECT_ID }, error: null }));
        return chain;
      }
      return {};
    }),
  };
}

beforeEach(() => {
  mockCreateClient.mockReset();
  mockRequireRoomOwnership.mockReset();
  mockRequireRoomOwnership.mockResolvedValue(null);
});
afterEach(() => vi.restoreAllMocks());

describe("POST /api/area-analysis/refine — sibling-rooms query bound", () => {
  it("bounds the otherRooms fetch with a .limit() (APT-41 — was unbounded)", async () => {
    const limits: unknown[] = [];
    mockCreateClient.mockResolvedValue(makeClient(limits));

    await refinePost(jsonReq({ room_id: OWNED_ROOM_ID, user_feedback: "make it cozier" }));

    expect(limits).toEqual([30]);
  });
});
