import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

// Regression guard: two Supabase reads in app/api/area-analysis/route.ts
// discarded `error` entirely (destructured only `data`), silently collapsing a
// real DB failure into the same "no existing analysis" outcome, with nothing
// logged server-side — the same bug class fixed in the rooms/diagnosis and
// area-analysis/refine siblings. Covers: (1) GET's existing-diagnosis lookup,
// (2) runAnalysis's dedup lookup (used by POST before running the pipeline).

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth/ownership", () => ({ requireRoomOwnership: vi.fn() }));
vi.mock("@/lib/utils/api-error", async () => {
  const actual = await vi.importActual<typeof import("@/lib/utils/api-error")>(
    "@/lib/utils/api-error",
  );
  return { ...actual, logServerError: vi.fn() };
});
vi.mock("@/lib/ai/gemini", () => ({
  geminiProvider: { chat: vi.fn(async () => { throw new Error("stop-after-dedup-check"); }) },
}));
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

import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireRoomOwnership } from "@/lib/auth/ownership";
import { logServerError } from "@/lib/utils/api-error";
import { GET as areaAnalysisGet, POST as areaAnalysisPost } from "@/app/api/area-analysis/route";

const mockCreateClient = createClient as unknown as Mock;
const mockRequireRoomOwnership = requireRoomOwnership as unknown as Mock;
const mockLogServerError = logServerError as unknown as Mock;

const OWNED_ROOM_ID = "room-owned";
const PROJECT_ID = "proj-1";

function nextReq(url: string): NextRequest {
  return new NextRequest(url);
}

function jsonReq(body: unknown): Request {
  return new Request("http://localhost/api/area-analysis", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function diagnosesStub(result: { data: unknown; error?: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "limit"]) chain[m] = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(() => Promise.resolve({ error: null, ...result }));
  return chain;
}

function makeGetClient(diagnosisResult: { data: unknown; error?: unknown }) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: "owner-1" } } }) },
    from: vi.fn((table: string) => (table === "room_diagnoses" ? diagnosesStub(diagnosisResult) : {})),
  };
}

/** Full client for the POST/runAnalysis path — stops right after the dedup check (geminiProvider throws next). */
function makePostClient(dedupResult: { data: unknown; error?: unknown }) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: "caller-1" } } }) },
    from: vi.fn((table: string) => {
      if (table === "rooms") {
        // Serves both the initial room-by-id fetch (.single()) and the
        // parallel otherRooms fetch (.neq/.order/.limit, awaited directly).
        const chain: Record<string, unknown> = {};
        chain.select = vi.fn(() => chain);
        chain.eq = vi.fn(() => chain);
        chain.neq = vi.fn(() => chain);
        chain.order = vi.fn(() => chain);
        chain.limit = vi.fn(() => Promise.resolve({ data: [], error: null }));
        chain.single = vi.fn(() =>
          Promise.resolve({
            data: { id: OWNED_ROOM_ID, project_id: PROJECT_ID, name: "Living Room", room_type: "living_room", room_images: [] },
            error: null,
          }),
        );
        return chain;
      }
      if (table === "projects") {
        const chain: Record<string, unknown> = {};
        chain.select = vi.fn(() => chain);
        chain.eq = vi.fn(() => chain);
        chain.single = vi.fn(() => Promise.resolve({ data: { id: PROJECT_ID }, error: null }));
        return chain;
      }
      if (table === "room_diagnoses") return diagnosesStub(dedupResult);
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

describe("GET /api/area-analysis — error classification", () => {
  it("does NOT log when there is simply no existing diagnosis (maybeSingle -> null, no error)", async () => {
    mockCreateClient.mockResolvedValue(makeGetClient({ data: null, error: null }));
    const res = await areaAnalysisGet(nextReq(`http://localhost/api/area-analysis?room_id=${OWNED_ROOM_ID}`));
    expect(res.status).toBe(200);
    expect(mockLogServerError).not.toHaveBeenCalled();
  });

  it("DOES log when the diagnosis lookup hits a real DB error", async () => {
    mockCreateClient.mockResolvedValue(
      makeGetClient({ data: null, error: { code: "53300", message: "too many connections" } }),
    );
    const res = await areaAnalysisGet(nextReq(`http://localhost/api/area-analysis?room_id=${OWNED_ROOM_ID}`));
    expect(res.status).toBe(200);
    expect(mockLogServerError).toHaveBeenCalledWith(
      "area-analysis.diagnosis",
      expect.objectContaining({ code: "53300" }),
    );
  });
});

describe("POST /api/area-analysis (runAnalysis dedup) — error classification", () => {
  it("does NOT log when there is simply no existing analysis to dedup against", async () => {
    mockCreateClient.mockResolvedValue(makePostClient({ data: null, error: null }));
    await areaAnalysisPost(jsonReq({ room_id: OWNED_ROOM_ID }));
    expect(mockLogServerError).not.toHaveBeenCalledWith(
      "area-analysis.runAnalysis.dedup",
      expect.anything(),
    );
  });

  it("DOES log when the dedup lookup hits a real DB error", async () => {
    mockCreateClient.mockResolvedValue(
      makePostClient({ data: null, error: { code: "53300", message: "too many connections" } }),
    );
    await areaAnalysisPost(jsonReq({ room_id: OWNED_ROOM_ID }));
    expect(mockLogServerError).toHaveBeenCalledWith(
      "area-analysis.runAnalysis.dedup",
      expect.objectContaining({ code: "53300" }),
    );
  });
});
