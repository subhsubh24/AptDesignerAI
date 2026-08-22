import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

// Regression guard for the fix to app/api/rooms/[roomId]/route.ts: the PATCH
// and DELETE ownership checks used to discard `error` from the room lookup,
// so a real DB failure (timeout, RLS denial, connection error) was silently
// indistinguishable from a legitimate not-found/not-owned room. This
// exercises the real route handlers (not a re-implementation) and asserts
// logServerError fires ONLY on a genuine DB error — never on the ordinary
// PGRST116 empty-state path — for both handlers, mirroring the sibling fix
// in __tests__/api/rooms-diagnosis-error-classification.test.ts.

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/utils/write-rate-limit", () => ({
  enforceWriteRateLimit: vi.fn(() => null),
  DELETE_WRITE_LIMIT: 30,
}));
vi.mock("@/lib/utils/api-error", async () => {
  const actual = await vi.importActual<typeof import("@/lib/utils/api-error")>(
    "@/lib/utils/api-error",
  );
  return { ...actual, logServerError: vi.fn() };
});

import { createClient } from "@/lib/supabase/server";
import { logServerError } from "@/lib/utils/api-error";
import { PATCH, DELETE } from "@/app/api/rooms/[roomId]/route";

const mockCreateClient = createClient as unknown as Mock;
const mockLogServerError = logServerError as unknown as Mock;

function params(roomId = "room-1") {
  return { params: Promise.resolve({ roomId }) };
}

/** A chainable query stub whose terminal read resolves to `result`. */
function queryStub(result: { data: unknown; error?: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "update", "delete"]) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.single = vi.fn().mockResolvedValue({ error: null, ...result });
  // DELETE's second query (`.delete().eq(...)`) resolves the chain directly
  // (no terminal `.single()`); make the chain itself thenable for that case.
  (chain as unknown as { then: unknown }).then = (
    resolve: (v: { error: unknown }) => void,
  ) => resolve({ error: (result as { error?: unknown }).error ?? null });
  return chain;
}

function clientWith(roomResult: { data: unknown; error?: unknown }) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: "owner-1" } } }) },
    from: vi.fn(() => queryStub(roomResult)),
  };
}

beforeEach(() => {
  mockCreateClient.mockReset();
  mockLogServerError.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("PATCH /api/rooms/[roomId] — ownership-check error classification", () => {
  it("does NOT log when the room is genuinely not found/not owned (PGRST116)", async () => {
    mockCreateClient.mockResolvedValue(
      clientWith({ data: null, error: { code: "PGRST116", message: "no rows" } }),
    );
    const res = await PATCH(
      new Request("http://localhost/api/rooms/room-1", {
        method: "PATCH",
        body: JSON.stringify({ name: "Living Room" }),
      }),
      params(),
    );
    expect(res.status).toBe(404);
    expect(mockLogServerError).not.toHaveBeenCalled();
  });

  it("DOES log when the ownership lookup hits a real DB error", async () => {
    mockCreateClient.mockResolvedValue(
      clientWith({ data: null, error: { code: "53300", message: "too many connections" } }),
    );
    const res = await PATCH(
      new Request("http://localhost/api/rooms/room-1", {
        method: "PATCH",
        body: JSON.stringify({ name: "Living Room" }),
      }),
      params(),
    );
    expect(res.status).toBe(404);
    expect(mockLogServerError).toHaveBeenCalledWith(
      "rooms.byId.patch.room",
      expect.objectContaining({ code: "53300" }),
    );
  });
});

describe("DELETE /api/rooms/[roomId] — ownership-check error classification", () => {
  it("does NOT log when the room is genuinely not found/not owned (PGRST116)", async () => {
    mockCreateClient.mockResolvedValue(
      clientWith({ data: null, error: { code: "PGRST116", message: "no rows" } }),
    );
    const res = await DELETE(new Request("http://localhost/api/rooms/room-1"), params());
    expect(res.status).toBe(404);
    expect(mockLogServerError).not.toHaveBeenCalled();
  });

  it("DOES log when the ownership lookup hits a real DB error", async () => {
    mockCreateClient.mockResolvedValue(
      clientWith({ data: null, error: { code: "53300", message: "too many connections" } }),
    );
    const res = await DELETE(new Request("http://localhost/api/rooms/room-1"), params());
    expect(res.status).toBe(404);
    expect(mockLogServerError).toHaveBeenCalledWith(
      "rooms.byId.delete.room",
      expect.objectContaining({ code: "53300" }),
    );
  });
});
