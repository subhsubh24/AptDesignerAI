import { beforeEach, afterEach, describe, expect, it, vi, type Mock } from "vitest";

// Regression guard for the "full"-stage silent-partial-persistence bug
// (F4.1 SIDE-EFFECT INTEGRITY). When a user saves a FULL design, the route reads
// the room's selected candidate_products + product_bundles to snapshot them. It
// previously used `data ?? []`, so if EITHER read errored, `data` was null and the
// route wrote a snapshot with zero products/bundles yet still returned HTTP 200.
// The user believed their shortlist was saved; on reload the design showed nothing
// (silent data loss on a retention-critical save). The fix fails loud: a read error
// returns a 500 (client can retry) instead of persisting a hollow snapshot.
//
// Follows the route-mock pattern in mockups-product-binding.test.ts.

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(), getCurrentUserId: vi.fn() }));
vi.mock("@/lib/auth/ownership", () => ({ userOwnsRoom: vi.fn() }));
vi.mock("@/lib/utils/rate-limiter", () => ({ checkRateLimit: vi.fn(() => ({ allowed: true })) }));
vi.mock("@/lib/entitlements/web", () => ({
  hasProEntitlementWeb: vi.fn(async () => true),
  FREE_SAVE_LIMIT_WEB: 3,
}));

import { createClient, getCurrentUserId } from "@/lib/supabase/server";
import { userOwnsRoom } from "@/lib/auth/ownership";
import { POST as savedDesignsPost } from "@/app/api/saved-designs/route";

const mockCreateClient = createClient as unknown as Mock;
const mockGetCurrentUserId = getCurrentUserId as unknown as Mock;
const mockUserOwnsRoom = userOwnsRoom as unknown as Mock;

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
  // Direct `await supabase.from(...).select().eq()...` (no terminal) resolves here.
  chain.then = (resolve: (v: QueryResult) => unknown) => Promise.resolve(result).then(resolve);
  return chain;
}

// Per-table results for a FULL-stage save of an already-saved room (UPDATE path,
// so the free-limit count + entitlement checks are skipped).
function makeClient(over: Partial<Record<string, QueryResult>>) {
  const results: Record<string, QueryResult> = {
    rooms: { data: { name: "Living Room", room_type: "living_room" }, error: null },
    room_diagnoses: {
      data: { diagnosis_json: { what_it_needs: [], summary: "s" }, design_direction_json: {} },
      error: null,
    },
    candidate_products: { data: [], error: null },
    product_bundles: { data: [], error: null },
    saved_designs: { data: { id: "sd-1" }, error: null },
    ...over,
  };
  return { from: vi.fn((table: string) => makeQuery(results[table] ?? { data: null, error: null })) };
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
  mockUserOwnsRoom.mockReset();
  mockGetCurrentUserId.mockResolvedValue("user-1");
  mockUserOwnsRoom.mockResolvedValue(true);
});
afterEach(() => vi.restoreAllMocks());

describe("saved-designs POST — full-stage read-error integrity", () => {
  const body = { room_id: "room-1", stage: "full" };

  it("returns 500 (not a hollow 200) when the candidate_products read errors", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({ candidate_products: { data: null, error: { message: "db down" } } }),
    );
    const res = await savedDesignsPost(jsonReq(body) as never);
    expect(res.status).toBe(500);
  });

  it("returns 500 when the product_bundles read errors", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({ product_bundles: { data: null, error: { message: "db down" } } }),
    );
    const res = await savedDesignsPost(jsonReq(body) as never);
    expect(res.status).toBe(500);
  });

  it("saves normally (200) when both reads succeed", async () => {
    mockCreateClient.mockResolvedValue(makeClient({}));
    const res = await savedDesignsPost(jsonReq(body) as never);
    expect(res.status).toBe(200);
  });
});
