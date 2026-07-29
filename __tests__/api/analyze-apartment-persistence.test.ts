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

    // The apartment SYNTHESIS narrative must also receive BOTH rooms' own
    // analyses. The synthesis input was built from the same room_type-keyed map
    // that collapsed duplicate types, so the pre-fix prompt carried the LAST
    // same-type room's summary twice (ROOM_B_ANALYSIS x2) and never
    // ROOM_A_ANALYSIS — feeding wrong per-room data into the cross-room
    // coherence pass. Assert the synth prompt now contains each distinct summary.
    const synthCall = mockChat.mock.calls
      .map((c) => c[0] as { messages: unknown })
      .find((args) => JSON.stringify(args.messages).includes("synthesize"));
    expect(synthCall).toBeDefined();
    const synthText = JSON.stringify(synthCall!.messages);
    expect(synthText).toContain("ROOM_A_ANALYSIS");
    expect(synthText).toContain("ROOM_B_ANALYSIS");
  });

  // The per-room analysis is raw extractJsonObject output — parsed JSON with NO
  // schema validation — so keep/replace/add are model-controlled and can come
  // back as a string or an object. The old `x || []` guard only caught
  // null/undefined, so a TRUTHY non-array reached `.join()` in the synthesis
  // prompt (uncaught TypeError -> 500 for the WHOLE apartment run) and was
  // stored verbatim into the action_list / missing_categories JSONB columns,
  // breaking the diagnosis page and the mockups placement map downstream.
  it("survives a non-array keep/replace/add and still persists array columns", async () => {
    mockUserOwnsProject.mockResolvedValue(true);

    const usage = { input_tokens: 1, output_tokens: 1 };
    mockChat.mockImplementation(async (args: { messages: unknown }) => {
      const text = JSON.stringify(args.messages);
      if (text.includes("synthesize")) {
        return { content: JSON.stringify({ overall: "apartment narrative" }), usage };
      }
      if (text.includes("Bedroom A")) {
        // Both malformed shapes at once: a bare string and an object.
        return {
          content: JSON.stringify({
            summary: "ROOM_A_ANALYSIS",
            score: 7,
            keep: "the oak floor",
            replace: { item: "floor lamp" },
            add: "a wool rug",
          }),
          usage,
        };
      }
      // Room B stays well-formed — the guard must not change good input.
      return {
        content: JSON.stringify({ summary: "ROOM_B_ANALYSIS", score: 6, keep: ["floor b"], replace: ["lamp b"], add: ["rug b"] }),
        usage,
      };
    });

    const diagnosesInserts: Array<{
      room_id: string;
      action_list: unknown;
      missing_categories: unknown;
    }> = [];
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
            insert: async (payload: { room_id: string; action_list: unknown; missing_categories: unknown }) => {
              diagnosesInserts.push(payload);
              return { error: null };
            },
          };
        }
        return {};
      },
    });

    // Pre-fix this threw a TypeError inside the synthesis prompt builder and the
    // route's catch turned it into a 500 — no room got persisted at all.
    const res = await analyzeApartmentPost(jsonReq({ project_id: "proj-1" }));
    expect(res.status).toBe(200);

    // Every persisted JSONB column that downstream code iterates must be a real
    // array, for the malformed room as well as the well-formed one.
    expect(diagnosesInserts).toHaveLength(2);
    for (const insert of diagnosesInserts) {
      expect(Array.isArray(insert.action_list)).toBe(true);
      expect(Array.isArray(insert.missing_categories)).toBe(true);
    }

    // The malformed room degrades to empty (it contributes no recommendations)
    // rather than storing the string/object verbatim...
    const byRoom = Object.fromEntries(diagnosesInserts.map((d) => [d.room_id, d]));
    expect(byRoom["room-a"].action_list).toEqual([]);
    expect(byRoom["room-a"].missing_categories).toEqual([]);
    // ...while the well-formed room is passed through completely unchanged.
    expect(byRoom["room-b"].action_list).toEqual(["lamp b"]);
    expect(byRoom["room-b"].missing_categories).toEqual(["rug b"]);

    // The synthesis prompt still ran and still carried both rooms.
    const synthCall = mockChat.mock.calls
      .map((c) => c[0] as { messages: unknown })
      .find((args) => JSON.stringify(args.messages).includes("synthesize"));
    expect(synthCall).toBeDefined();
    const synthText = JSON.stringify(synthCall!.messages);
    expect(synthText).toContain("ROOM_A_ANALYSIS");
    expect(synthText).toContain("ROOM_B_ANALYSIS");
  });
  // SIDE-EFFECT INTEGRITY (ROADMAP F4.1). The dashboard treats a 200 as success:
  // it fires `analysis_complete` and advances the user to room selection, which
  // reads the per-room diagnoses back out of the DB. A run where every insert
  // failed therefore used to walk the user into a flow with no data behind it,
  // having told them it worked — the exact fake-success class F4.1 forbids.
  it("reports failure when NO room diagnosis could be saved", async () => {
    mockUserOwnsProject.mockResolvedValue(true);

    const usage = { input_tokens: 1, output_tokens: 1 };
    mockChat.mockImplementation(async (args: { messages: unknown }) => {
      const text = JSON.stringify(args.messages);
      if (text.includes("synthesize")) {
        return { content: JSON.stringify({ overall: "apartment narrative" }), usage };
      }
      return { content: JSON.stringify({ summary: "S", score: 7, keep: [], replace: [], add: [] }), usage };
    });

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
          // EVERY insert fails — the whole run produced no durable effect.
          return { insert: async () => ({ error: { message: "insert failed" } }) };
        }
        return {};
      },
    });

    const res = await analyzeApartmentPost(jsonReq({ project_id: "proj-1" }));
    // Pre-fix this was 200 with a { summary } payload.
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/couldn't save/i);
    expect(body.summary).toBeUndefined();
  });

  // The converse, and the reason this is a zero-check rather than an
  // all-must-succeed check: 1 of 2 rooms saved is a real, useful partial result.
  // Failing the whole run would discard work the user already paid for.
  it("still succeeds when SOME rooms persist", async () => {
    mockUserOwnsProject.mockResolvedValue(true);

    const usage = { input_tokens: 1, output_tokens: 1 };
    mockChat.mockImplementation(async (args: { messages: unknown }) => {
      const text = JSON.stringify(args.messages);
      if (text.includes("synthesize")) {
        return { content: JSON.stringify({ overall: "apartment narrative" }), usage };
      }
      return { content: JSON.stringify({ summary: "S", score: 7, keep: [], replace: [], add: [] }), usage };
    });

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
            insert: async (payload: { room_id: string }) =>
              payload.room_id === "room-a" ? { error: { message: "insert failed" } } : { error: null },
          };
        }
        return {};
      },
    });

    const res = await analyzeApartmentPost(jsonReq({ project_id: "proj-1" }));
    expect(res.status).toBe(200);
    expect((await res.json()).summary).toBeDefined();
  });
  // The OTHER road to zero persisted rooms, and the one a guard keyed on
  // "an insert was attempted and failed" would miss entirely: every per-room
  // analysis comes back unusable (empty model response / parse failure /
  // safety block), so nothing is ever attempted. The route then reached the
  // success return with `rooms: {}` — a 200 carrying an empty apartment.
  // Not hypothetical: the route's own firstArray note records a shape bug that
  // took out every room in an apartment simultaneously.
  it("reports failure when every per-room analysis came back unusable", async () => {
    mockUserOwnsProject.mockResolvedValue(true);

    const usage = { input_tokens: 1, output_tokens: 1 };
    // Empty content for BOTH the per-room calls and the synthesis call.
    mockChat.mockImplementation(async () => ({ content: "", usage }));

    const inserts: unknown[] = [];
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
          // Inserts would SUCCEED here — proving the failure is "nothing was
          // produced", not "the write broke".
          return { insert: async (p: unknown) => { inserts.push(p); return { error: null }; } };
        }
        return {};
      },
    });

    const res = await analyzeApartmentPost(jsonReq({ project_id: "proj-1" }));
    expect(inserts).toHaveLength(0);
    // Pre-fix this returned 200 with {"summary":{"overall":"","rooms":{}}}.
    expect(res.status).toBe(500);
    expect((await res.json()).summary).toBeUndefined();
  });
});
