import { beforeEach, afterEach, describe, expect, it, vi, type Mock } from "vitest";

// Regression guard for the duplicate-room-type persistence bug: analyze-apartment
// must persist EACH room's OWN diagnosis. It previously looked the analysis up in
// a room_type-keyed map, so two rooms of the same type (e.g. two bedrooms)
// collapsed and both were saved the LAST same-type room's analysis. This test
// drives the real POST handler with two same-type rooms and distinct per-room
// AI analyses, then asserts each room_diagnoses insert carries that room's own
// analysis — following the route-mock pattern in idor-compute-guards.test.ts
// plus the geminiProvider mock used across the agent tests.

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth/ownership", () => ({ userOwnsProject: vi.fn() }));
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
import { userOwnsProject } from "@/lib/auth/ownership";
import { geminiProvider } from "@/lib/ai/gemini";
import { POST as analyzeApartmentPost } from "@/app/api/analyze-apartment/route";

const mockCreateClient = createClient as unknown as Mock;
const mockUserOwnsProject = userOwnsProject as unknown as Mock;
const mockChat = geminiProvider.chat as unknown as Mock;

// Two rooms of the SAME type but distinct ids/names — the exact shape the bug
// corrupts. Each has an image so analyzeRoom runs (doesn't early-return null).
const roomA = { id: "room-a", name: "Bedroom A", room_type: "bedroom", room_images: [{ image_url: "https://x/a.jpg" }] };
const roomB = { id: "room-b", name: "Bedroom B", room_type: "bedroom", room_images: [{ image_url: "https://x/b.jpg" }] };

function jsonReq(body: unknown): Request {
  return new Request("http://localhost/api/analyze-apartment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockCreateClient.mockReset();
  mockUserOwnsProject.mockReset();
  mockChat.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("analyze-apartment — per-room diagnosis persistence", () => {
  it("persists each same-type room's OWN analysis (no duplicate-type clobber)", async () => {
    mockUserOwnsProject.mockResolvedValue(true);

    // Route the AI response by which room's prompt it is. The synthesis call
    // contains BOTH room names, so match "synthesize" first.
    const usage = { input_tokens: 1, output_tokens: 1 };
    mockChat.mockImplementation(async (args: { messages: unknown }) => {
      const text = JSON.stringify(args.messages);
      if (text.includes("synthesize")) {
        return { content: JSON.stringify({ overall: "apartment narrative" }), usage };
      }
      if (text.includes("Bedroom A")) {
        return { content: JSON.stringify({ summary: "ROOM_A_ANALYSIS", score: 7, keep: ["floor a"], replace: ["lamp a"], add: ["rug a"], priority: 5 }), usage };
      }
      return { content: JSON.stringify({ summary: "ROOM_B_ANALYSIS", score: 6, keep: ["floor b"], replace: ["lamp b"], add: ["rug b"], priority: 6 }), usage };
    });

    const diagnosesInserts: Array<{ room_id: string; diagnosis_json: { summary?: string } }> = [];
    mockCreateClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: "owner-1" } } }) },
      from: (table: string) => {
        if (table === "projects") {
          return {
            select: () => ({ eq: () => ({ single: async () => ({ data: { id: "proj-1" }, error: null }) }) }),
            update: () => ({ eq: async () => ({ error: null }) }),
          };
        }
        if (table === "rooms") {
          return {
            select: () => ({ eq: () => ({ order: async () => ({ data: [roomA, roomB], error: null }) }) }),
            update: () => ({ eq: async () => ({ error: null }) }),
          };
        }
        if (table === "room_diagnoses") {
          return {
            insert: async (payload: { room_id: string; diagnosis_json: { summary?: string } }) => {
              diagnosesInserts.push(payload);
              return { error: null };
            },
          };
        }
        return {};
      },
    });

    const res = await analyzeApartmentPost(jsonReq({ project_id: "proj-1" }));
    expect(res.status).toBe(200);

    // Both rooms persisted, each with ITS OWN analysis — the pre-fix code saved
    // room-a the room-b analysis (last same-type wins in the room_type map).
    expect(diagnosesInserts).toHaveLength(2);
    const byRoom = Object.fromEntries(diagnosesInserts.map((d) => [d.room_id, d.diagnosis_json.summary]));
    expect(byRoom["room-a"]).toBe("ROOM_A_ANALYSIS");
    expect(byRoom["room-b"]).toBe("ROOM_B_ANALYSIS");
  });
});
