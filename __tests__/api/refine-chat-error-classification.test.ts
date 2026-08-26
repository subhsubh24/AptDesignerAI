import { beforeEach, afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { NextRequest } from "next/server";

/**
 * Regression guard for the same discarded/misclassified-DB-error bug class
 * this board has fixed repeatedly elsewhere (APT-15/16/17/25/28/54/58/59/60
 * and more) — GET/POST /api/area-analysis/refine-chat previously only
 * `logServerError`'d a real DB failure and fell through: GET returned 200
 * with `{ messages: [] }` (a real outage read back as "no chat history yet"),
 * and POST's room/diagnosis fetch errors fell through to `!room`/
 * `!latestDiagnosis`, surfacing as a misleading 404 "Room not found" or 400
 * "run the initial assessment first" instead of a real 500.
 */
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth/ownership", () => ({ requireRoomOwnership: vi.fn() }));

import { createClient } from "@/lib/supabase/server";
import { requireRoomOwnership } from "@/lib/auth/ownership";
import { GET as refineChatGet, POST as refineChatPost } from "@/app/api/area-analysis/refine-chat/route";

const mockCreateClient = createClient as unknown as Mock;
const mockRequireRoomOwnership = requireRoomOwnership as unknown as Mock;

/** A chainable query stub whose terminal read resolves to `result`. */
function queryStub(result: { data: unknown; error?: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "limit"]) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.single = vi.fn().mockResolvedValue({ error: null, ...result });
  chain.maybeSingle = vi.fn().mockResolvedValue({ error: null, ...result });
  chain.then = (res: (v: unknown) => unknown) => res({ error: null, ...result });
  return chain;
}

function authed(userId: string, from: (table: string) => unknown) {
  mockCreateClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: userId } } }) },
    from: vi.fn(from),
  });
}

beforeEach(() => {
  mockCreateClient.mockReset();
  mockRequireRoomOwnership.mockReset();
  mockRequireRoomOwnership.mockResolvedValue(null);
});
afterEach(() => vi.restoreAllMocks());

describe("GET /api/area-analysis/refine-chat — error classification", () => {
  it("returns 500 on a real DB error instead of masking it as an empty chat history", async () => {
    const dbError = { message: "connection reset by peer" };
    authed("owner-1", () => queryStub({ data: null, error: dbError }));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await refineChatGet(
      new NextRequest("http://localhost/api/area-analysis/refine-chat?room_id=own-room"),
    );

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).not.toEqual({ messages: [] });
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^\[refine-chat\.messages\]/),
      dbError,
    );
    errorSpy.mockRestore();
  });

  it("still returns 200 with an empty array for a genuinely empty (no-error) chat history", async () => {
    authed("owner-1", () => queryStub({ data: [] }));

    const res = await refineChatGet(
      new NextRequest("http://localhost/api/area-analysis/refine-chat?room_id=own-room"),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ messages: [] });
  });
});

describe("POST /api/area-analysis/refine-chat — error classification", () => {
  function postReq(body: unknown) {
    return new NextRequest("http://localhost/api/area-analysis/refine-chat", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  it("returns 500 on a real room-fetch DB error, not the misleading 404 'Room not found'", async () => {
    const dbError = { message: "connection reset by peer", code: "08006" };
    authed("owner-1", (table) =>
      table === "rooms"
        ? queryStub({ data: null, error: dbError })
        : queryStub({ data: null }),
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await refineChatPost(postReq({ room_id: "own-room", content: "make it warmer" }));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).not.toBe("Room not found");
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^\[area-analysis\.refine-chat\.room\]/),
      dbError,
    );
    errorSpy.mockRestore();
  });

  it("still returns 404 'Room not found' for a genuine PGRST116 (ownership-check-then-delete race)", async () => {
    const raceError = { message: "no rows", code: "PGRST116" };
    authed("owner-1", (table) =>
      table === "rooms"
        ? queryStub({ data: null, error: raceError })
        : queryStub({ data: null }),
    );

    const res = await refineChatPost(postReq({ room_id: "own-room", content: "make it warmer" }));

    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Room not found");
  });

  it("returns 500 on a real diagnosis-fetch DB error, not the misleading 'run the initial assessment first'", async () => {
    const dbError = { message: "connection reset by peer" };
    authed("owner-1", (table) =>
      table === "rooms"
        ? queryStub({ data: { id: "own-room" } })
        : queryStub({ data: null, error: dbError }),
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await refineChatPost(postReq({ room_id: "own-room", content: "make it warmer" }));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).not.toMatch(/run the initial assessment/i);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^\[area-analysis\.refine-chat\.latestDiagnosis\]/),
      dbError,
    );
    errorSpy.mockRestore();
  });

  it("still returns 400 'No analysis to refine' for a genuinely absent (no-error) diagnosis", async () => {
    authed("owner-1", (table) =>
      table === "rooms"
        ? queryStub({ data: { id: "own-room" } })
        : queryStub({ data: null }),
    );

    const res = await refineChatPost(postReq({ room_id: "own-room", content: "make it warmer" }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/run the initial assessment/i);
  });
});
