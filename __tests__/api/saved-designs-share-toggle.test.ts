import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

// Regression guard for the public-share toggle (PATCH /api/saved-designs/[id]).
//
// The handler read `data` back from its `.update()` and treated a falsy value as
// "no rows matched", with a comment asserting `data` is null only when the row
// vanished. That is not how PostgREST behaves: an update returns NO body unless
// the rows are explicitly requested with `.select()`. Against a real Postgres
// backend `data` was therefore null on EVERY successful update, so the guard
// returned a 500 for every share toggle — while the write had already COMMITTED.
// The user saw "couldn't update sharing" on a design that was now genuinely
// public (or genuinely un-shared): a false failure on a privacy-visible action.
//
// It stayed invisible because the default in-memory dev store returns the mutated
// row from `.update()` regardless of `.select()`, so the bug only appears once
// DATA_BACKEND=supabase — the pending production cutover.
//
// These tests therefore drive a client that mimics PostgREST's real contract:
// an update resolves `{ data: null }` unless `.select()` was chained. Reverting
// the fix turns both share assertions red.

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(), getCurrentUserId: vi.fn() }));
vi.mock("@/lib/utils/write-rate-limit", () => ({
  enforceWriteRateLimit: vi.fn(() => null),
  DELETE_WRITE_LIMIT: { maxRequests: 30, windowMs: 60_000 },
}));

import { createClient, getCurrentUserId } from "@/lib/supabase/server";
import { PATCH } from "@/app/api/saved-designs/[id]/route";

const mockCreateClient = createClient as unknown as Mock;
const mockGetCurrentUserId = getCurrentUserId as unknown as Mock;

const OWNER = "user-1";
const DESIGN_ID = "design-1";

interface UpdateSpy {
  patch: Record<string, unknown> | null;
  selected: boolean;
}

/**
 * A saved_designs stub that honours PostgREST's return contract. The read chain
 * (`.select().eq().eq().maybeSingle()`) resolves the stored row; the write chain
 * resolves the updated row ONLY when `.select()` was chained, mirroring the real
 * client — which is precisely the distinction the regression is about.
 */
function makeClient(row: Record<string, unknown> | null, spy: UpdateSpy) {
  const chain: Record<string, unknown> = {};
  let isUpdate = false;

  chain.select = vi.fn(() => {
    if (isUpdate) spy.selected = true;
    return chain;
  });
  chain.eq = vi.fn(() => chain);
  chain.update = vi.fn((patch: Record<string, unknown>) => {
    isUpdate = true;
    spy.patch = patch;
    return chain;
  });

  const settle = () => {
    if (!isUpdate) return { data: row, error: null };
    if (!row) return { data: null, error: { message: "No rows" } };
    // PostgREST: no representation returned unless the caller asked for it.
    if (!spy.selected) return { data: null, error: null };
    return { data: { ...row, ...spy.patch }, error: null };
  };

  chain.single = vi.fn(() => Promise.resolve(settle()));
  chain.maybeSingle = vi.fn(() => Promise.resolve(settle()));
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(settle()).then(resolve);

  return { from: vi.fn(() => chain) };
}

function patchRequest(is_public: boolean) {
  return new Request("http://localhost/api/saved-designs/design-1", {
    method: "PATCH",
    body: JSON.stringify({ is_public }),
  }) as unknown as Parameters<typeof PATCH>[0];
}

const params = { params: Promise.resolve({ id: DESIGN_ID }) };

describe("PATCH /api/saved-designs/[id] — public share toggle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentUserId.mockResolvedValue(OWNER);
  });

  it("returns 200 and a share token when enabling sharing on a real Postgres backend", async () => {
    const spy: UpdateSpy = { patch: null, selected: false };
    mockCreateClient.mockResolvedValue(
      makeClient({ id: DESIGN_ID, share_token: null, is_public: false }, spy)
    );

    const res = await PATCH(patchRequest(true), params);
    const body = await res.json();

    // The load-bearing assertion: a committed update must NOT report failure.
    expect(res.status).toBe(200);
    expect(body.is_public).toBe(true);
    expect(typeof body.share_token).toBe("string");
    expect(body.share_token).toHaveLength(32);
    // ...and it must be reported as failing for the right reason: because the
    // handler asked PostgREST for the row, not because a shim happened to hand
    // one back. Without this, the test passes on a lenient mock.
    expect(spy.selected).toBe(true);
  });

  it("preserves the existing token when disabling sharing, so the URL survives a re-enable", async () => {
    const spy: UpdateSpy = { patch: null, selected: false };
    mockCreateClient.mockResolvedValue(
      makeClient({ id: DESIGN_ID, share_token: "kept-token", is_public: true }, spy)
    );

    const res = await PATCH(patchRequest(false), params);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.is_public).toBe(false);
    expect(body.share_token).toBe("kept-token");
  });

  it("404s without writing when the design is not owned by the caller", async () => {
    const spy: UpdateSpy = { patch: null, selected: false };
    const client = makeClient(null, spy);
    mockCreateClient.mockResolvedValue(client);

    const res = await PATCH(patchRequest(true), params);

    expect(res.status).toBe(404);
    // The ownership read gates the write — no update may be attempted.
    expect(spy.patch).toBeNull();
  });
});
