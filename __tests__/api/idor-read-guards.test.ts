import { beforeEach, afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { NextRequest } from "next/server";

// Regression guard for the read-leak IDOR fixes: the GET/read endpoints that
// resolve a resource by a client-supplied room_id must verify the caller owns
// that room BEFORE returning any of its data. The memory-store query is not
// user-scoped, so the ownership check is the only cross-tenant boundary. Here we
// mock `userOwnsRoom` and assert the routes 404 a non-owner without ever
// reaching the underlying data read.
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
  getCurrentUserId: vi.fn(),
}));
vi.mock("@/lib/auth/ownership", () => ({ userOwnsRoom: vi.fn() }));

import { createClient, getCurrentUserId } from "@/lib/supabase/server";
import { userOwnsRoom } from "@/lib/auth/ownership";
import { GET as productsGet } from "@/app/api/products/route";
import { GET as refineChatGet, POST as refineChatPost } from "@/app/api/area-analysis/refine-chat/route";
import { POST as savedDesignsPost } from "@/app/api/saved-designs/route";

const mockCreateClient = createClient as unknown as Mock;
const mockGetCurrentUserId = getCurrentUserId as unknown as Mock;
const mockUserOwnsRoom = userOwnsRoom as unknown as Mock;

/** A chainable query stub whose terminal read resolves to `result`. */
function queryStub(result: { data: unknown; error?: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "neq", "limit"]) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.range = vi.fn().mockResolvedValue({ error: null, ...result });
  chain.single = vi.fn().mockResolvedValue({ error: null, ...result });
  chain.maybeSingle = vi.fn().mockResolvedValue({ error: null, ...result });
  // Awaiting the builder directly (e.g. refine-chat GET) resolves the result.
  chain.then = (res: (v: unknown) => unknown) => res({ error: null, ...result });
  return chain;
}

function authed(user: { id: string } | null, from = () => queryStub({ data: [] })) {
  mockCreateClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user } }) },
    from: vi.fn(from),
  });
}

beforeEach(() => {
  mockCreateClient.mockReset();
  mockGetCurrentUserId.mockReset();
  mockUserOwnsRoom.mockReset();
  mockGetCurrentUserId.mockResolvedValue("attacker-1");
});
afterEach(() => vi.restoreAllMocks());

describe("read-leak IDOR guards", () => {
  it("GET /api/products 404s when the caller does not own the room, without reading products", async () => {
    authed({ id: "attacker-1" });
    mockUserOwnsRoom.mockResolvedValue(false);

    const res = await productsGet(
      new Request("http://localhost/api/products?room_id=victim-room"),
    );

    expect(res.status).toBe(404);
    expect(mockUserOwnsRoom).toHaveBeenCalledWith(expect.anything(), "victim-room", "attacker-1");
  });

  it("GET /api/products serves data to the owner (guard does not break the happy path)", async () => {
    const rows = [{ id: "p1" }];
    authed({ id: "owner-1" }, () => queryStub({ data: rows }));
    mockUserOwnsRoom.mockResolvedValue(true);

    const res = await productsGet(
      new Request("http://localhost/api/products?room_id=own-room"),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(rows);
  });

  it("GET /api/area-analysis/refine-chat 404s when the caller does not own the room", async () => {
    authed({ id: "attacker-1" });
    mockUserOwnsRoom.mockResolvedValue(false);

    const res = await refineChatGet(
      new NextRequest("http://localhost/api/area-analysis/refine-chat?room_id=victim-room"),
    );

    expect(res.status).toBe(404);
    expect(mockUserOwnsRoom).toHaveBeenCalledWith(expect.anything(), "victim-room", "attacker-1");
  });

  it("GET /api/area-analysis/refine-chat serves chat history to the owner (guard does not block)", async () => {
    const msgs = [{ id: "m1", role: "user", content: "make it warmer" }];
    authed({ id: "owner-1" }, () => queryStub({ data: msgs }));
    mockUserOwnsRoom.mockResolvedValue(true);

    const res = await refineChatGet(
      new NextRequest("http://localhost/api/area-analysis/refine-chat?room_id=own-room"),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ messages: msgs });
  });

  it("POST /api/area-analysis/refine-chat 404s a non-owner before touching the room / re-analysis", async () => {
    const fromSpy = vi.fn(() => queryStub({ data: null }));
    mockCreateClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: "attacker-refine" } } }) },
      from: fromSpy,
    });
    mockUserOwnsRoom.mockResolvedValue(false);

    const req = new NextRequest("http://localhost/api/area-analysis/refine-chat", {
      method: "POST",
      body: JSON.stringify({ room_id: "victim-room", content: "make it warmer" }),
    });
    const res = await refineChatPost(req);

    expect(res.status).toBe(404);
    expect(mockUserOwnsRoom).toHaveBeenCalledWith(expect.anything(), "victim-room", "attacker-refine");
    // The guard runs before the paid re-analysis: the room is never even read.
    expect(fromSpy).not.toHaveBeenCalledWith("rooms");
  });

  it("POST /api/area-analysis/refine-chat lets an owner past the guard (reaches the room read)", async () => {
    // Owner passes the ownership guard, so the handler proceeds to load the room.
    // We return a null room so the handler stops at its own "Room not found" —
    // enough to prove the guard did NOT block a legitimate owner.
    const fromSpy = vi.fn(() => queryStub({ data: null }));
    mockCreateClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: "owner-refine" } } }) },
      from: fromSpy,
    });
    mockUserOwnsRoom.mockResolvedValue(true);

    const req = new NextRequest("http://localhost/api/area-analysis/refine-chat", {
      method: "POST",
      body: JSON.stringify({ room_id: "own-room", content: "make it warmer" }),
    });
    await refineChatPost(req);

    expect(mockUserOwnsRoom).toHaveBeenCalledWith(expect.anything(), "own-room", "owner-refine");
    // Guard passed → the handler advanced to the room read it gates.
    expect(fromSpy).toHaveBeenCalledWith("rooms");
  });

  it("POST /api/saved-designs 404s when the caller does not own the room, without snapshotting it", async () => {
    const fromSpy = vi.fn(() => queryStub({ data: null }));
    mockCreateClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: "attacker-1" } } }) },
      from: fromSpy,
    });
    mockUserOwnsRoom.mockResolvedValue(false);

    const req = new NextRequest("http://localhost/api/saved-designs", {
      method: "POST",
      body: JSON.stringify({ room_id: "victim-room", stage: "full" }),
    });
    const res = await savedDesignsPost(req);

    expect(res.status).toBe(404);
    expect(mockUserOwnsRoom).toHaveBeenCalledWith(expect.anything(), "victim-room", "attacker-1");
    // The guard runs before any snapshot read — the room_diagnoses table is never touched.
    expect(fromSpy).not.toHaveBeenCalledWith("room_diagnoses");
  });

  it("POST /api/saved-designs lets an owner past the guard (reaches the snapshot read)", async () => {
    // Owner passes the guard, so the handler proceeds to build the snapshot. A
    // null diagnosis makes it stop at its own "No analysis found" — proving the
    // guard did NOT block a legitimate owner.
    const fromSpy = vi.fn(() => queryStub({ data: null }));
    mockCreateClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: "owner-1" } } }) },
      from: fromSpy,
    });
    mockGetCurrentUserId.mockResolvedValue("owner-1");
    mockUserOwnsRoom.mockResolvedValue(true);

    const req = new NextRequest("http://localhost/api/saved-designs", {
      method: "POST",
      body: JSON.stringify({ room_id: "own-room", stage: "full" }),
    });
    await savedDesignsPost(req);

    expect(mockUserOwnsRoom).toHaveBeenCalledWith(expect.anything(), "own-room", "owner-1");
    // Guard passed → the handler advanced to the diagnosis snapshot read it gates.
    expect(fromSpy).toHaveBeenCalledWith("room_diagnoses");
  });
});
