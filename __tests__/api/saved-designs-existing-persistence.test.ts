import { beforeEach, afterEach, describe, expect, it, vi, type Mock } from "vitest";

// Regression guard for the saved-designs read-error integrity bugs on the reads
// whose result is PERSISTED (F4.1 SIDE-EFFECT INTEGRITY). Two distinct bugs:
//
//  1. The `existing` upsert lookup (`saved_designs` maybeSingle) previously
//     ignored its `error` field. An errored existence check was indistinguishable
//     from "no existing design", so the route fell through to the INSERT branch —
//     creating a DUPLICATE saved_designs row for a room that already had one and
//     silently defeating the upsert. The fix fails loud (500) so the client
//     retries, never writing a second row.
//
//  2. The `rooms` read (used for the snapshot title + room_type) previously
//     ignored its `error` field. After the ownership guard already proved the room
//     exists, an errored read is a transient DB failure — persisting a snapshot
//     titled "Untitled Room" with a null room_type is a silently-degraded save.
//     The fix fails loud (500).
//
// Follows the route-mock pattern in saved-designs-full-persistence.test.ts.

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(), getCurrentUserId: vi.fn() }));
vi.mock("@/lib/auth/ownership", () => ({ requireRoomOwnership: vi.fn() }));
vi.mock("@/lib/utils/rate-limiter", () => ({ checkRateLimit: vi.fn(() => ({ allowed: true })) }));
vi.mock("@/lib/entitlements/web", () => ({
  hasProEntitlementWeb: vi.fn(async () => true),
  FREE_SAVE_LIMIT_WEB: 3,
}));

import { createClient, getCurrentUserId } from "@/lib/supabase/server";
import { requireRoomOwnership } from "@/lib/auth/ownership";
import { POST as savedDesignsPost } from "@/app/api/saved-designs/route";

const mockCreateClient = createClient as unknown as Mock;
const mockGetCurrentUserId = getCurrentUserId as unknown as Mock;
const mockRequireRoomOwnership = requireRoomOwnership as unknown as Mock;

type QueryResult = { data?: unknown; count?: number; error?: unknown };

// A thenable Supabase query stub: chain methods return `this`; awaiting the chain
// (or calling a terminal .single/.maybeSingle) resolves to the table's result.
function makeQuery(result: QueryResult) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "limit", "in", "update", "insert"]) {
    chain[m] = vi.fn(() => chain);
  }
  chain.single = vi.fn(() => Promise.resolve(result));
  chain.maybeSingle = vi.fn(() => Promise.resolve(result));
  chain.then = (resolve: (v: QueryResult) => unknown) => Promise.resolve(result).then(resolve);
  return chain;
}

// Per-table results for an assessment-stage save. `saved_designs` returns an
// existing row by default (UPDATE path), so the free-limit + entitlement checks
// are skipped and the happy path is a clean 200.
function makeClient(over: Partial<Record<string, QueryResult>>) {
  const results: Record<string, QueryResult> = {
    rooms: { data: { name: "Living Room", room_type: "living_room" }, error: null },
    room_diagnoses: {
      data: { diagnosis_json: { what_it_needs: [], summary: "s" }, design_direction_json: {} },
      error: null,
    },
    saved_designs: { data: { id: "sd-1" }, error: null },
    ...over,
  };
  return { from: vi.fn((table: string) => makeQuery(results[table] ?? { data: null, error: null })) };
}

// A client whose `saved_designs` existence lookup (maybeSingle) ERRORS but whose
// INSERT would SUCCEED — the realistic production scenario the fix targets: a
// transient SELECT error does NOT imply the subsequent INSERT will also fail. The
// shared table-keyed makeClient can't express "SELECT fails, INSERT succeeds", so a
// blanket saved_designs error would 500 via the pre-existing insert-error check even
// with the new guard removed (right result, wrong reason). This call-site-aware stub
// makes the test fail iff the `existingError` guard specifically is reverted: without
// it, the flow falls through to the succeeding INSERT (201, insert IS called); with
// it, the route 500s before any INSERT (insert NOT called).
function makeClientExistingLookupErrors(insertSpy: Mock) {
  const savedDesignsChain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "limit"]) {
    savedDesignsChain[m] = vi.fn(() => savedDesignsChain);
  }
  // The existence lookup errors.
  savedDesignsChain.maybeSingle = vi.fn(() =>
    Promise.resolve({ data: null, error: { message: "db down" } }),
  );
  // The free-limit count path awaits the chain directly → an unblocked count (0).
  savedDesignsChain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ count: 0, error: null }).then(resolve);
  // The INSERT path would SUCCEED — this is what the guard must prevent reaching.
  savedDesignsChain.insert = vi.fn((...args: unknown[]) => {
    insertSpy(...args);
    const ins: Record<string, unknown> = {};
    ins.select = vi.fn(() => ins);
    ins.single = vi.fn(() => Promise.resolve({ data: { id: "sd-new" }, error: null }));
    return ins;
  });

  const otherTables: Record<string, QueryResult> = {
    rooms: { data: { name: "Living Room", room_type: "living_room" }, error: null },
    room_diagnoses: {
      data: { diagnosis_json: { what_it_needs: [], summary: "s" }, design_direction_json: {} },
      error: null,
    },
  };
  return {
    from: vi.fn((table: string) =>
      table === "saved_designs"
        ? savedDesignsChain
        : makeQuery(otherTables[table] ?? { data: null, error: null }),
    ),
  };
}

function jsonReq(body: unknown): Request {
  return new Request("http://localhost/api/saved-designs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockCreateClient.mockReset();
  mockGetCurrentUserId.mockReset();
  mockRequireRoomOwnership.mockReset();
  mockGetCurrentUserId.mockResolvedValue("user-1");
  mockRequireRoomOwnership.mockResolvedValue(null);
});
afterEach(() => vi.restoreAllMocks());

describe("saved-designs POST — persisted-read error integrity", () => {
  const body = { room_id: "room-1", stage: "assessment" };

  it("returns 500 and never reaches the INSERT (no duplicate row) when the existing-design lookup errors", async () => {
    // The realistic hazard: the SELECT errors but the INSERT would SUCCEED. Without
    // the guard the flow falls through to that succeeding INSERT → a duplicate row
    // (201). The guard must 500 BEFORE any INSERT. Asserting insert-was-never-called
    // is what makes this mutation-provable specifically for the `existingError` guard.
    const insertSpy = vi.fn();
    mockCreateClient.mockResolvedValue(makeClientExistingLookupErrors(insertSpy));
    const res = await savedDesignsPost(jsonReq(body) as never);
    expect(res.status).toBe(500);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("returns 500 (not a mislabeled save) when the room read errors", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({ rooms: { data: null, error: { message: "db down" } } }),
    );
    const res = await savedDesignsPost(jsonReq(body) as never);
    expect(res.status).toBe(500);
  });

  it("saves normally (200) when all reads succeed", async () => {
    mockCreateClient.mockResolvedValue(makeClient({}));
    const res = await savedDesignsPost(jsonReq(body) as never);
    expect(res.status).toBe(200);
  });
});
