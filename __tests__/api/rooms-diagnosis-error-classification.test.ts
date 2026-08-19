import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

// Regression guard for the fix to app/api/rooms/[roomId]/diagnosis/route.ts:
// both Supabase reads used to discard `error`, so a real DB failure on either
// query was silently indistinguishable from a legitimate empty state (a
// not-found/not-owned room, or a room with no diagnosis yet). This exercises
// the real route handler (not a re-implementation) and asserts logServerError
// fires ONLY on a genuine DB error — never on the ordinary PGRST116/null-error
// empty-state paths — for both the room lookup and the diagnosis lookup.

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/utils/api-error", async () => {
  const actual = await vi.importActual<typeof import("@/lib/utils/api-error")>(
    "@/lib/utils/api-error",
  );
  return { ...actual, logServerError: vi.fn() };
});

import { createClient } from "@/lib/supabase/server";
import { logServerError } from "@/lib/utils/api-error";
import { GET } from "@/app/api/rooms/[roomId]/diagnosis/route";

const mockCreateClient = createClient as unknown as Mock;
const mockLogServerError = logServerError as unknown as Mock;

function params(roomId = "room-1") {
  return { params: Promise.resolve({ roomId }) };
}

/** A chainable query stub whose terminal read resolves to `result`. */
function queryStub(result: { data: unknown; error?: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "limit"]) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.single = vi.fn().mockResolvedValue({ error: null, ...result });
  chain.maybeSingle = vi.fn().mockResolvedValue({ error: null, ...result });
  return chain;
}

function clientWith(
  roomResult: { data: unknown; error?: unknown },
  diagnosisResult: { data: unknown; error?: unknown } = { data: null, error: null },
) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: "owner-1" } } }) },
    from: vi.fn((table: string) =>
      table === "rooms" ? queryStub(roomResult) : queryStub(diagnosisResult),
    ),
  };
}

beforeEach(() => {
  mockCreateClient.mockReset();
  mockLogServerError.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("GET /api/rooms/[roomId]/diagnosis — error classification", () => {
  it("does NOT log when the room is genuinely not found/not owned (PGRST116)", async () => {
    mockCreateClient.mockResolvedValue(
      clientWith({ data: null, error: { code: "PGRST116", message: "no rows" } }),
    );
    const res = await GET(new Request("http://localhost/api/rooms/room-1/diagnosis"), params());
    expect(res.status).toBe(404);
    expect(mockLogServerError).not.toHaveBeenCalled();
  });

  it("DOES log when the room lookup hits a real DB error", async () => {
    mockCreateClient.mockResolvedValue(
      clientWith({ data: null, error: { code: "53300", message: "too many connections" } }),
    );
    const res = await GET(new Request("http://localhost/api/rooms/room-1/diagnosis"), params());
    expect(res.status).toBe(404);
    expect(mockLogServerError).toHaveBeenCalledWith(
      "rooms.diagnosis.room",
      expect.objectContaining({ code: "53300" }),
    );
  });

  it("does NOT log when the room has no diagnosis yet (maybeSingle → null, no error)", async () => {
    mockCreateClient.mockResolvedValue(
      clientWith({ data: { id: "room-1" }, error: null }, { data: null, error: null }),
    );
    const res = await GET(new Request("http://localhost/api/rooms/room-1/diagnosis"), params());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ diagnosis: null });
    expect(mockLogServerError).not.toHaveBeenCalled();
  });

  it("DOES log when the diagnosis lookup hits a real DB error", async () => {
    mockCreateClient.mockResolvedValue(
      clientWith(
        { data: { id: "room-1" }, error: null },
        { data: null, error: { code: "53300", message: "too many connections" } },
      ),
    );
    const res = await GET(new Request("http://localhost/api/rooms/room-1/diagnosis"), params());
    expect(res.status).toBe(200);
    expect(mockLogServerError).toHaveBeenCalledWith(
      "rooms.diagnosis.diagnosis",
      expect.objectContaining({ code: "53300" }),
    );
  });
});
