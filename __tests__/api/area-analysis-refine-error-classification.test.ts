import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

// Regression guard: POST /api/area-analysis/refine discarded the `error` field
// on both the room fetch and the project fetch, silently collapsing a real DB
// failure (timeout, connection drop) into the same outcome as a legitimate
// empty state — with nothing logged server-side. Mirrors the sibling fix in
// app/api/rooms/[roomId]/diagnosis/route.ts and app/api/rooms/[roomId]/route.ts
// (see rooms-diagnosis-error-classification.test.ts).

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth/ownership", () => ({ requireRoomOwnership: vi.fn() }));
vi.mock("@/lib/utils/api-error", async () => {
  const actual = await vi.importActual<typeof import("@/lib/utils/api-error")>(
    "@/lib/utils/api-error",
  );
  return { ...actual, logServerError: vi.fn() };
});
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
import { logServerError } from "@/lib/utils/api-error";
import { POST as refinePost } from "@/app/api/area-analysis/refine/route";

const mockCreateClient = createClient as unknown as Mock;
const mockRequireRoomOwnership = requireRoomOwnership as unknown as Mock;
const mockLogServerError = logServerError as unknown as Mock;

const OWNED_ROOM_ID = "room-owned";
const PROJECT_ID = "proj-1";

function jsonReq(body: unknown): Request {
  return new Request("http://localhost/api/area-analysis/refine", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeClient(
  roomResult: { data: unknown; error?: unknown },
  projectResult: { data: unknown; error?: unknown } = { data: { id: PROJECT_ID }, error: null },
) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: "caller-1" } } }) },
    from: vi.fn((table: string) => {
      if (table === "rooms") {
        // Serves both the room-by-id lookup (.single()) and the sibling
        // otherRooms fetch (.neq/.order/.limit, awaited directly) — a fresh
        // chain per .from() call, all methods defined on both.
        const chain: Record<string, unknown> = {};
        chain.select = vi.fn(() => chain);
        chain.eq = vi.fn(() => chain);
        chain.neq = vi.fn(() => chain);
        chain.order = vi.fn(() => chain);
        chain.limit = vi.fn(() => Promise.resolve({ data: [], error: null }));
        chain.single = vi.fn(() => Promise.resolve({ error: null, ...roomResult }));
        return chain;
      }
      if (table === "projects") {
        const chain: Record<string, unknown> = {};
        chain.select = vi.fn(() => chain);
        chain.eq = vi.fn(() => chain);
        chain.single = vi.fn(() => Promise.resolve({ error: null, ...projectResult }));
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
  mockLogServerError.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("POST /api/area-analysis/refine — error classification", () => {
  it("does NOT log when the room is genuinely not found (PGRST116)", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({ data: null, error: { code: "PGRST116", message: "no rows" } }),
    );
    const res = await refinePost(jsonReq({ room_id: OWNED_ROOM_ID, user_feedback: "cozier" }));
    expect(res.status).toBe(404);
    expect(mockLogServerError).not.toHaveBeenCalled();
  });

  it("DOES log when the room lookup hits a real DB error", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({ data: null, error: { code: "53300", message: "too many connections" } }),
    );
    const res = await refinePost(jsonReq({ room_id: OWNED_ROOM_ID, user_feedback: "cozier" }));
    expect(res.status).toBe(404);
    expect(mockLogServerError).toHaveBeenCalledWith(
      "area-analysis.refine.room",
      expect.objectContaining({ code: "53300" }),
    );
  });

  it("does NOT log when the project lookup errors with PGRST116", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient(
        { data: { id: OWNED_ROOM_ID, project_id: PROJECT_ID, room_images: [] }, error: null },
        { data: null, error: { code: "PGRST116", message: "no rows" } },
      ),
    );
    await refinePost(jsonReq({ room_id: OWNED_ROOM_ID, user_feedback: "cozier" }));
    expect(mockLogServerError).not.toHaveBeenCalledWith(
      "area-analysis.refine.project",
      expect.anything(),
    );
  });

  it("DOES log when the project lookup hits a real DB error", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient(
        { data: { id: OWNED_ROOM_ID, project_id: PROJECT_ID, room_images: [] }, error: null },
        { data: null, error: { code: "53300", message: "too many connections" } },
      ),
    );
    await refinePost(jsonReq({ room_id: OWNED_ROOM_ID, user_feedback: "cozier" }));
    expect(mockLogServerError).toHaveBeenCalledWith(
      "area-analysis.refine.project",
      expect.objectContaining({ code: "53300" }),
    );
  });
});
