import { beforeEach, afterEach, describe, expect, it, vi, type Mock } from "vitest";

// Regression guard: the free-save-limit COUNT query previously ignored its
// `error` field (`saveCount ?? 0`). A transient DB error on that count reads as
// "0 saves so far", which silently BYPASSES the free tier's save limit — the
// same fail-open class the `existingError`/`rooms`-read guards in the sibling
// persistence tests already close. The fix fails loud (500) so the client
// retries instead of getting an unlimited save for free.
//
// Follows the call-site-aware stub pattern in saved-designs-existing-persistence.test.ts:
// the `saved_designs` table is hit twice for a NEW save (no existing row) — once
// via `.maybeSingle()` (the existing-design lookup, must report "not found") and
// once via a direct awaited chain (the free-limit count, must report the error).
// A single table-keyed result can't express both, so this stub differentiates by
// call site.

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(), getCurrentUserId: vi.fn() }));
vi.mock("@/lib/auth/ownership", () => ({ requireRoomOwnership: vi.fn() }));
vi.mock("@/lib/utils/rate-limiter", () => ({ checkRateLimit: vi.fn(() => ({ allowed: true })) }));
vi.mock("@/lib/entitlements/web", () => ({
  hasProEntitlementWeb: vi.fn(async () => true),
  FREE_SAVE_LIMIT_WEB: 3,
}));

import { createClient, getCurrentUserId } from "@/lib/supabase/server";
import { requireRoomOwnership } from "@/lib/auth/ownership";
import { hasProEntitlementWeb } from "@/lib/entitlements/web";
import { POST as savedDesignsPost } from "@/app/api/saved-designs/route";

const mockCreateClient = createClient as unknown as Mock;
const mockGetCurrentUserId = getCurrentUserId as unknown as Mock;
const mockRequireRoomOwnership = requireRoomOwnership as unknown as Mock;
const mockHasProEntitlementWeb = hasProEntitlementWeb as unknown as Mock;

type QueryResult = { data?: unknown; count?: number | null; error?: unknown };

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

function makeClientCountErrors(countResult: QueryResult, insertSpy: Mock) {
  const savedDesignsChain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "limit"]) {
    savedDesignsChain[m] = vi.fn(() => savedDesignsChain);
  }
  // The existing-design lookup finds nothing → NEW save (INSERT path), which is
  // what reaches the free-limit count gate at all.
  savedDesignsChain.maybeSingle = vi.fn(() => Promise.resolve({ data: null, error: null }));
  // The free-limit count path awaits the chain directly.
  savedDesignsChain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(countResult).then(resolve);
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
  mockHasProEntitlementWeb.mockReset();
  mockGetCurrentUserId.mockResolvedValue("user-1");
  mockRequireRoomOwnership.mockResolvedValue(null);
  mockHasProEntitlementWeb.mockResolvedValue(true);
});
afterEach(() => vi.restoreAllMocks());

describe("saved-designs POST — free-limit count-error integrity", () => {
  const body = { room_id: "room-1", stage: "assessment" };

  it("returns 500 (not a fail-open unlimited save) when the free-limit count query errors", async () => {
    const insertSpy = vi.fn();
    mockCreateClient.mockResolvedValue(
      makeClientCountErrors({ count: null, error: { message: "db down" } }, insertSpy),
    );
    const res = await savedDesignsPost(jsonReq(body) as never);
    expect(res.status).toBe(500);
    // The entitlement check must never run off a bogus "0 saves" count derived
    // from an errored query — proves the guard fires before the limit logic,
    // not that the limit logic happened to still deny for an unrelated reason.
    expect(mockHasProEntitlementWeb).not.toHaveBeenCalled();
  });

  it("saves normally (200) when the count query succeeds and is under the limit", async () => {
    const insertSpy = vi.fn();
    mockCreateClient.mockResolvedValue(makeClientCountErrors({ count: 1, error: null }, insertSpy));
    const res = await savedDesignsPost(jsonReq(body) as never);
    expect(res.status).toBe(201);
    expect(insertSpy).toHaveBeenCalled();
  });
});
