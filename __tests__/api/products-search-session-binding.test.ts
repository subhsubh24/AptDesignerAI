import { beforeEach, afterEach, describe, expect, it, vi, type Mock } from "vitest";

/**
 * Regression guard for an unbound client-supplied id on the products write path.
 *
 * POST /api/products accepts `search_session_id` in its body. It was only
 * LENGTH-validated (a string of ≤2000 chars) and then written straight onto the
 * candidate_products row — never bound to anything the caller owns. The room is
 * ownership-checked, so the product itself stays isolated and there is no
 * cross-tenant READ here; what the caller could do is file their own product
 * under ANOTHER tenant's search session, leaving a foreign key that points
 * outside their data and silently corrupting any "products from this search"
 * query built on it later.
 *
 * The fix binds the session to the SAME room the ownership check already
 * cleared (`search_sessions.room_id`), and rejects rather than nulling, so a
 * mismatched id surfaces instead of being quietly dropped.
 *
 * The stub below honours BOTH .eq() filters the way Postgres would, so an
 * unbound query — one that matched on id alone — is what fails these tests.
 */

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth/ownership", () => ({ requireRoomOwnership: vi.fn() }));
vi.mock("@/lib/utils/write-rate-limit", () => ({ enforceWriteRateLimit: vi.fn(() => null) }));

import { createClient } from "@/lib/supabase/server";
import { requireRoomOwnership } from "@/lib/auth/ownership";
import { POST as productsPost } from "@/app/api/products/route";

const mockCreateClient = createClient as unknown as Mock;
const mockRequireRoomOwnership = requireRoomOwnership as unknown as Mock;

const CALLER = "user-1";
const OWN_ROOM = "room-own";
/** Belongs to the caller's room — the legitimate case. */
const OWN_SESSION = { id: "sess-own", room_id: OWN_ROOM };
/** A real session row, but on someone else's room. */
const FOREIGN_SESSION = { id: "sess-foreign", room_id: "room-other" };

type Captured = { row?: Record<string, unknown> };

/** Mimics the id + room_id filter pair; matches only when BOTH agree. */
function makeSessionsQuery(sessions: Array<Record<string, unknown>>) {
  const filters: Record<string, unknown> = {};
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn((col: string, val: unknown) => {
    filters[col] = val;
    return chain;
  });
  const resolve = () => ({
    data: sessions.find((s) => Object.entries(filters).every(([k, v]) => s[k] === v)) ?? null,
    error: null,
  });
  chain.maybeSingle = vi.fn(() => Promise.resolve(resolve()));
  chain.single = vi.fn(() => Promise.resolve(resolve()));
  return chain;
}

function makeClient(captured: Captured) {
  return {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: CALLER } } })) },
    from: vi.fn((table: string) => {
      if (table === "search_sessions") return makeSessionsQuery([OWN_SESSION, FOREIGN_SESSION]);
      const chain: Record<string, unknown> = {};
      chain.insert = vi.fn((row: Record<string, unknown>) => {
        captured.row = row;
        return chain;
      });
      chain.select = vi.fn(() => chain);
      chain.single = vi.fn(() => Promise.resolve({ data: { id: "prod-1" }, error: null }));
      return chain;
    }),
  };
}

function jsonReq(body: unknown): Request {
  return new Request("http://localhost/api/products", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockCreateClient.mockReset();
  mockRequireRoomOwnership.mockReset();
  mockRequireRoomOwnership.mockResolvedValue(null);
});
afterEach(() => vi.restoreAllMocks());

describe("products POST — search_session_id must be bound to the room", () => {
  it("rejects a session id belonging to a DIFFERENT room, and writes nothing", async () => {
    const captured: Captured = {};
    mockCreateClient.mockResolvedValue(makeClient(captured));

    const res = await productsPost(
      jsonReq({
        room_id: OWN_ROOM,
        title: "Sofa",
        search_session_id: FOREIGN_SESSION.id,
      }) as never,
    );

    expect(res.status).toBe(400);
    // The important half: it must not fall through and persist the row anyway.
    expect(captured.row).toBeUndefined();
  });

  it("accepts a session id on the caller's OWN room and persists it", async () => {
    const captured: Captured = {};
    mockCreateClient.mockResolvedValue(makeClient(captured));

    const res = await productsPost(
      jsonReq({
        room_id: OWN_ROOM,
        title: "Sofa",
        search_session_id: OWN_SESSION.id,
      }) as never,
    );

    expect(res.status).toBe(201);
    expect(captured.row?.search_session_id).toBe(OWN_SESSION.id);
  });

  it("still accepts a write with no session id at all (the common path)", async () => {
    const captured: Captured = {};
    mockCreateClient.mockResolvedValue(makeClient(captured));

    const res = await productsPost(
      jsonReq({ room_id: OWN_ROOM, title: "Sofa" }) as never,
    );

    expect(res.status).toBe(201);
    expect(captured.row?.search_session_id).toBeUndefined();
  });

  it("rejects a session id that does not exist at all", async () => {
    const captured: Captured = {};
    mockCreateClient.mockResolvedValue(makeClient(captured));

    const res = await productsPost(
      jsonReq({ room_id: OWN_ROOM, title: "Sofa", search_session_id: "sess-nope" }) as never,
    );

    expect(res.status).toBe(400);
    expect(captured.row).toBeUndefined();
  });
});
