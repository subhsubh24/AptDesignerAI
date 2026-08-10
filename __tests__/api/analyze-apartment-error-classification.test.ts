import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { NextRequest } from "next/server";

// Regression guard: POST /api/analyze-apartment silently swallowed real database
// errors on both its project and rooms fetches. The project fetch used `.single()`
// with the error discarded, so a real DB failure produced `project: undefined`
// and the route proceeded to build a design profile from nothing rather than
// failing loud. The rooms fetch is a plain array select (no `.single()`), so
// Supabase returns `[]` for a genuinely empty (but existing) project and `null`
// ONLY on a real query error — the pre-fix `!allRooms` check reported every DB
// failure as the user-facing "No rooms found" 400, indistinguishable from an
// apartment with zero rooms. Also covers the sibling GET handler's rooms fetch,
// which has the identical array-vs-.single() shape.

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth/ownership", () => ({ requireProjectOwnership: vi.fn() }));
vi.mock("@/lib/ai/gemini", () => ({ geminiProvider: { chat: vi.fn() } }));
vi.mock("@/lib/db/agent-runs", () => ({
  createAgentRun: vi.fn(async () => ({ id: "run-1" })),
  completeAgentRun: vi.fn(async () => {}),
}));
vi.mock("@/lib/utils/rate-limiter", () => ({
  checkRateLimit: vi.fn(() => ({ allowed: true })),
  RATE_LIMITS: { analyzeApartment: { maxRequests: 5, windowMs: 3_600_000 } },
}));
vi.mock("@/lib/utils/spend-limiter", () => ({
  checkDailySpend: vi.fn(() => ({ allowed: true })),
  dailySpendExceededResponse: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";
import { requireProjectOwnership } from "@/lib/auth/ownership";
import { GET as analyzeApartmentGet, POST as analyzeApartmentPost } from "@/app/api/analyze-apartment/route";

const mockCreateClient = createClient as unknown as Mock;
const mockRequireProjectOwnership = requireProjectOwnership as unknown as Mock;

function jsonReq(body: unknown): Request {
  return new Request("http://localhost/api/analyze-apartment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
function getReq(projectId: string): NextRequest {
  return new NextRequest(`http://localhost/api/analyze-apartment?project_id=${projectId}`);
}

beforeEach(() => {
  mockCreateClient.mockReset();
  mockRequireProjectOwnership.mockReset();
  mockRequireProjectOwnership.mockResolvedValue(null);
  mockCreateClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: "owner-1" } } }) },
  });
});
afterEach(() => vi.restoreAllMocks());

describe("POST /api/analyze-apartment — error classification", () => {
  it("returns 500, not a silently-empty analysis, when the project fetch fails", async () => {
    mockCreateClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: "owner-1" } } }) },
      from: (table: string) => {
        if (table === "projects") {
          return { select: () => ({ eq: () => ({ single: async () => ({ data: null, error: { code: "53300", message: "too many connections" } }) }) }) };
        }
        return {};
      },
    });
    const res = await analyzeApartmentPost(jsonReq({ project_id: "proj-1" }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).not.toContain("too many connections");
  });

  it("returns 404, not 500, when the project fetch misses with PGRST116 (race after the ownership check)", async () => {
    mockCreateClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: "owner-1" } } }) },
      from: (table: string) => {
        if (table === "projects") {
          return { select: () => ({ eq: () => ({ single: async () => ({ data: null, error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" } }) }) }) };
        }
        return {};
      },
    });
    const res = await analyzeApartmentPost(jsonReq({ project_id: "proj-1" }));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Not found");
  });

  it("returns 500, not '400 No rooms found', when the rooms fetch fails", async () => {
    mockCreateClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: "owner-1" } } }) },
      from: (table: string) => {
        if (table === "projects") {
          return { select: () => ({ eq: () => ({ single: async () => ({ data: { id: "proj-1" }, error: null }) }) }) };
        }
        if (table === "rooms") {
          return { select: () => ({ eq: () => ({ order: async () => ({ data: null, error: { code: "53300", message: "too many connections" } }) }) }) };
        }
        return {};
      },
    });
    const res = await analyzeApartmentPost(jsonReq({ project_id: "proj-1" }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).not.toBe("No rooms found");
    expect(body.error).not.toContain("too many connections");
  });

  it("still returns 400 'No rooms found' for a genuinely empty (but existing) project", async () => {
    mockCreateClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: "owner-1" } } }) },
      from: (table: string) => {
        if (table === "projects") {
          return { select: () => ({ eq: () => ({ single: async () => ({ data: { id: "proj-1" }, error: null }) }) }) };
        }
        if (table === "rooms") {
          return { select: () => ({ eq: () => ({ order: async () => ({ data: [], error: null }) }) }) };
        }
        return {};
      },
    });
    const res = await analyzeApartmentPost(jsonReq({ project_id: "proj-1" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("No rooms found");
  });
});

describe("GET /api/analyze-apartment — error classification", () => {
  it("returns 500, not '404 No rooms found', when the rooms fetch fails", async () => {
    mockCreateClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: "owner-1" } } }) },
      from: () => ({ select: () => ({ eq: () => ({ order: async () => ({ data: null, error: { code: "53300", message: "too many connections" } }) }) }) }),
    });
    const res = await analyzeApartmentGet(getReq("proj-1"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).not.toBe("No rooms found");
    expect(body.error).not.toContain("too many connections");
  });

  it("still returns a 200 summary for a genuinely empty (but existing) project", async () => {
    mockCreateClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: "owner-1" } } }) },
      from: () => ({ select: () => ({ eq: () => ({ order: async () => ({ data: [], error: null }) }) }) }),
    });
    const res = await analyzeApartmentGet(getReq("proj-1"));
    expect(res.status).toBe(200);
  });
});
