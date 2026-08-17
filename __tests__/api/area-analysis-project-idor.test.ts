import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

// Regression guard for GitHub issue #858 (independent Quality Auditor,
// security_rls A+ -> B). POST /api/area-analysis accepted a client-supplied
// `project_id` in the request body and passed it straight through to
// runAnalysis, where `effectiveProjectId = project_id || room.project_id`
// let it OVERRIDE the caller's own (ownership-verified) room's real project
// with no ownership check on that id at all. The overridden id was then used
// to fetch the full `projects` row (address, building_research,
// apartment_analysis) and every sibling room's diagnosis history — a
// cross-tenant read of another tenant's private data via any authenticated
// caller who owns some room and can guess/enumerate a project UUID.
//
// The fix drops `project_id` from the request body entirely (mirroring how
// the refine-chat sibling route already derives it server-side from the
// owned room) so `effectiveProjectId` can only ever be the caller's own
// room's real project_id. This test asserts that property directly: even
// when the client sends another tenant's project_id, the `projects` table is
// only ever queried with the room's OWN project_id.

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth/ownership", () => ({ requireRoomOwnership: vi.fn() }));
vi.mock("@/lib/ai/gemini", () => ({ geminiProvider: { chat: vi.fn(async () => { throw new Error("stop-after-project-fetch"); }) } }));
vi.mock("@/lib/db/agent-runs", () => ({
  createAgentRun: vi.fn(async () => ({ id: "run-1" })),
  completeAgentRun: vi.fn(async () => {}),
}));
vi.mock("@/lib/utils/rate-limiter", () => ({
  checkRateLimit: vi.fn(() => ({ allowed: true })),
  RATE_LIMITS: { areaAnalysis: { maxRequests: 5, windowMs: 3_600_000 } },
}));
vi.mock("@/lib/utils/spend-limiter", () => ({
  checkDailySpend: vi.fn(() => ({ allowed: true })),
  dailySpendExceededResponse: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";
import { requireRoomOwnership } from "@/lib/auth/ownership";
import { POST as areaAnalysisPost } from "@/app/api/area-analysis/route";

const mockCreateClient = createClient as unknown as Mock;
const mockRequireRoomOwnership = requireRoomOwnership as unknown as Mock;

const CALLER = "attacker-1";
const OWNED_ROOM_ID = "room-owned";
const CALLER_PROJECT_ID = "proj-attacker-own";
const VICTIM_PROJECT_ID = "proj-victim";

function jsonReq(body: unknown): Request {
  return new Request("http://localhost/api/area-analysis", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * Builds a Supabase stub distinguishing the two different `rooms` queries
 * (the single owned-room fetch vs. the sibling `otherRooms` fetch) by which
 * select/filter methods are called, and captures every `project_id` used to
 * query the `projects` table.
 */
function makeClient(capturedProjectIds: string[], capturedLimits: unknown[] = []) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: CALLER } } }) },
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
          void isOtherRoomsQuery;
          capturedLimits.push(n);
          return chain;
        });
        chain.single = vi.fn(() =>
          Promise.resolve({
            data: {
              id: OWNED_ROOM_ID,
              project_id: CALLER_PROJECT_ID,
              name: "Living Room",
              room_type: "living_room",
              room_images: [],
            },
            error: null,
          }),
        );
        // The otherRooms fetch (`.eq("project_id", X).neq("id", room_id)`) is
        // awaited directly (no .single()) — resolve it to an empty list.
        chain.then = (resolve: (v: unknown) => unknown) => {
          void isOtherRoomsQuery;
          return Promise.resolve({ data: [], error: null }).then(resolve);
        };
        return chain;
      }
      if (table === "projects") {
        const chain: Record<string, unknown> = {};
        chain.select = vi.fn(() => chain);
        chain.eq = vi.fn((col: string, val: string) => {
          if (col === "id") capturedProjectIds.push(val);
          return chain;
        });
        chain.single = vi.fn(() => Promise.resolve({ data: null, error: { code: "PGRST116" } }));
        return chain;
      }
      if (table === "room_diagnoses") {
        const chain: Record<string, unknown> = {};
        for (const m of ["select", "eq", "order", "limit"]) chain[m] = vi.fn(() => chain);
        chain.maybeSingle = vi.fn(() => Promise.resolve({ data: null, error: null }));
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

describe("POST /api/area-analysis — project_id cross-tenant IDOR", () => {
  it("never queries the projects table with a client-supplied project_id, even when one is sent", async () => {
    const captured: string[] = [];
    mockCreateClient.mockResolvedValue(makeClient(captured));

    await areaAnalysisPost(
      jsonReq({ room_id: OWNED_ROOM_ID, project_id: VICTIM_PROJECT_ID }),
    );

    expect(captured).not.toContain(VICTIM_PROJECT_ID);
    expect(captured).toEqual([CALLER_PROJECT_ID]);
  });

  it("still uses the caller's own room's real project_id when no project_id is sent", async () => {
    const captured: string[] = [];
    mockCreateClient.mockResolvedValue(makeClient(captured));

    await areaAnalysisPost(jsonReq({ room_id: OWNED_ROOM_ID }));

    expect(captured).toEqual([CALLER_PROJECT_ID]);
  });

  it("bounds the sibling-rooms fetch with a .limit() (APT-41 — was unbounded)", async () => {
    const captured: string[] = [];
    const limits: unknown[] = [];
    mockCreateClient.mockResolvedValue(makeClient(captured, limits));

    await areaAnalysisPost(jsonReq({ room_id: OWNED_ROOM_ID }));

    expect(limits).toContain(30);
  });
});
