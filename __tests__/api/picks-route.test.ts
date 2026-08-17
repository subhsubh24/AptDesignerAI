import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// GET /api/picks lists shortlisted/accepted products across every room the
// caller owns. There is no separate requireProjectOwnership() call here —
// ownership is enforced entirely by the rooms query's projects!inner(user_id)
// join filter, and candidate_products is then scoped to ONLY the room_ids
// that query returned. If that join filter were ever dropped (e.g. a refactor
// that queries rooms without scoping by owner), this would silently leak
// every user's shortlisted products to every other user — so the join clause
// itself, and the fact that an empty/unauthenticated rooms result short-
// circuits before candidate_products is ever queried, are what this asserts.

const mockGetUser = vi.fn();
const mockRoomsEq = vi.fn();
const mockRoomsOrder = vi.fn();
const mockRoomsLimit = vi.fn();
const mockProductsIn = vi.fn();
const mockRange = vi.fn();

let roomsResult: { data: unknown; error: unknown } = { data: [], error: null };
let productsResult: { data: unknown; error: unknown } = { data: [], error: null };

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
    from: vi.fn((table: string) => {
      if (table === "rooms") {
        const builder: Record<string, unknown> = {};
        builder.select = () => builder;
        builder.eq = (...args: unknown[]) => {
          mockRoomsEq(...args);
          return builder;
        };
        builder.order = (...args: unknown[]) => {
          mockRoomsOrder(...args);
          return builder;
        };
        builder.limit = (...args: unknown[]) => {
          mockRoomsLimit(...args);
          return builder;
        };
        // rooms query resolves directly (no .range() on it) — make the
        // builder itself thenable so `await roomsQuery` works either after
        // one or two .eq() calls.
        builder.then = (resolve: (v: unknown) => void) => resolve(roomsResult);
        return builder;
      }
      // candidate_products
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.in = (...args: unknown[]) => {
        mockProductsIn(...args);
        return builder;
      };
      builder.order = () => builder;
      builder.range = (...args: unknown[]) => {
        mockRange(...args);
        return productsResult;
      };
      return builder;
    }),
  })),
}));

import { GET } from "@/app/api/picks/route";

function req(query = "") {
  return new NextRequest(`http://localhost/api/picks${query}`);
}

const ROOMS = [
  { id: "room-1", name: "Living Room", room_type: "living_room", project_id: "proj-1" },
  { id: "room-2", name: "Bedroom", room_type: "bedroom", project_id: "proj-1" },
];

const PRODUCTS = [
  { id: "prod-1", room_id: "room-1", status: "shortlisted", created_at: "2026-02-01" },
  { id: "prod-2", room_id: "room-2", status: "accepted", created_at: "2026-01-01" },
];

beforeEach(() => {
  mockGetUser.mockReset();
  mockRoomsEq.mockReset();
  mockRoomsOrder.mockReset();
  mockRoomsLimit.mockReset();
  mockProductsIn.mockReset();
  mockRange.mockReset();
  mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  roomsResult = { data: ROOMS, error: null };
  productsResult = { data: PRODUCTS, error: null };
});
afterEach(() => vi.restoreAllMocks());

describe("GET /api/picks", () => {
  it("requires authentication before touching the database", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(mockRoomsEq).not.toHaveBeenCalled();
  });

  it("scopes the rooms query to the caller's own projects via the ownership join", async () => {
    await GET(req());
    expect(mockRoomsEq).toHaveBeenCalledWith("projects.user_id", "user-1");
  });

  it("additionally scopes by project_id when the query param is supplied", async () => {
    await GET(req("?project_id=proj-1"));
    expect(mockRoomsEq).toHaveBeenCalledWith("projects.user_id", "user-1");
    expect(mockRoomsEq).toHaveBeenCalledWith("project_id", "proj-1");
  });

  it("does NOT apply a project_id filter when the query param is absent", async () => {
    await GET(req());
    expect(mockRoomsEq).toHaveBeenCalledTimes(1);
    expect(mockRoomsEq).toHaveBeenCalledWith("projects.user_id", "user-1");
  });

  it("short-circuits to an empty array without querying candidate_products when the caller owns no rooms", async () => {
    roomsResult = { data: [], error: null };
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
    // Never reached the products query — nothing to enumerate against.
    expect(mockProductsIn).not.toHaveBeenCalled();
  });

  it("scopes candidate_products to exactly the room_ids the rooms query returned, and to shortlisted/accepted status", async () => {
    await GET(req());
    expect(mockProductsIn).toHaveBeenCalledWith("room_id", ["room-1", "room-2"]);
    expect(mockProductsIn).toHaveBeenCalledWith("status", ["shortlisted", "accepted"]);
  });

  it("paginates with the route's own default (limit 200, offset 0)", async () => {
    await GET(req());
    expect(mockRange).toHaveBeenCalledWith(0, 199);
  });

  it("bounds the owned-rooms fetch with a .limit() (APT-41 — was unbounded)", async () => {
    await GET(req());
    expect(mockRoomsLimit).toHaveBeenCalledWith(100);
  });

  it("orders the owned-rooms fetch before limiting it, so the cap drops a deterministic (not arbitrary) subset", async () => {
    await GET(req());
    expect(mockRoomsOrder).toHaveBeenCalledWith("created_at", { ascending: false });
  });

  it("honors explicit limit/offset query params", async () => {
    await GET(req("?limit=10&offset=20"));
    expect(mockRange).toHaveBeenCalledWith(20, 29);
  });

  it("enriches each product with its room's name and room_type", async () => {
    const res = await GET(req());
    const body = await res.json();
    expect(body).toEqual([
      expect.objectContaining({ id: "prod-1", room_name: "Living Room", room_type: "living_room" }),
      expect.objectContaining({ id: "prod-2", room_name: "Bedroom", room_type: "bedroom" }),
    ]);
  });

  it("falls back to 'Unknown Room' if a product references a room_id the rooms query didn't return", async () => {
    productsResult = {
      data: [{ id: "prod-3", room_id: "room-orphaned", status: "shortlisted", created_at: "2026-03-01" }],
      error: null,
    };
    const res = await GET(req());
    const body = await res.json();
    expect(body[0].room_name).toBe("Unknown Room");
    expect(body[0].room_type).toBeNull();
  });

  it("returns a generic 500 and does not leak the raw error when the rooms query fails", async () => {
    roomsResult = { data: null, error: { message: "connection reset", code: "08006" } };
    const res = await GET(req());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).not.toMatch(/connection reset/);
    expect(mockProductsIn).not.toHaveBeenCalled();
  });

  it("returns a generic 500 and does not leak the raw error when the candidate_products query fails", async () => {
    productsResult = { data: null, error: { message: "relation does not exist", code: "42P01" } };
    const res = await GET(req());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).not.toMatch(/relation does not exist/);
  });
});
