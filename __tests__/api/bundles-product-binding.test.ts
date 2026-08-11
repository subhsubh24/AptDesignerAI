import { beforeEach, afterEach, describe, expect, it, vi, type Mock } from "vitest";

// Regression guard for the bundle product<->room binding IDOR fix. Creating a
// bundle takes a client-supplied list of product_ids. Owning the target room is
// NOT sufficient — every product id must belong to THAT room, or an owner of
// room A could reference another user's product ids (room B) and have a later
// bundles/evaluate score cross-tenant products. The memory-store query is not
// user-scoped, so this app-layer check is the only boundary.
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth/ownership", () => ({ requireRoomOwnership: vi.fn() }));
vi.mock("@/lib/utils/write-rate-limit", () => ({ enforceWriteRateLimit: vi.fn(() => null) }));

import { createClient } from "@/lib/supabase/server";
import { requireRoomOwnership } from "@/lib/auth/ownership";
import { POST as bundlesPost } from "@/app/api/bundles/route";

const mockCreateClient = createClient as unknown as Mock;
const mockRequireRoomOwnership = requireRoomOwnership as unknown as Mock;

/**
 * Build a Supabase stub. `ownedProductIds` is the set of candidate_products ids
 * that belong to the requested room (what the binding `.in()` query returns).
 * `insertSpy` records product_bundle_items inserts so we can assert none happen
 * on rejection.
 */
function makeClient(user: { id: string } | null, ownedProductIds: string[], insertSpy: Mock) {
  const from = vi.fn((table: string) => {
    if (table === "candidate_products") {
      // .select("id").eq("room_id", ...).in("id", ids) — awaited directly.
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn().mockReturnValue(chain);
      chain.eq = vi.fn().mockReturnValue(chain);
      chain.in = vi.fn().mockReturnValue(chain);
      chain.then = (res: (v: unknown) => unknown) =>
        res({ data: ownedProductIds.map((id) => ({ id })), error: null });
      return chain;
    }
    if (table === "product_bundles") {
      const chain: Record<string, unknown> = {};
      chain.insert = vi.fn().mockReturnValue(chain);
      chain.select = vi.fn().mockReturnValue(chain);
      chain.delete = vi.fn().mockReturnValue(chain);
      chain.eq = vi.fn().mockResolvedValue({ error: null });
      chain.single = vi.fn().mockResolvedValue({ data: { id: "bundle-1" }, error: null });
      return chain;
    }
    if (table === "product_bundle_items") {
      return { insert: insertSpy };
    }
    return {};
  });
  mockCreateClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user } }) },
    from,
  });
}

function req(body: unknown) {
  return new Request("http://localhost/api/bundles", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockCreateClient.mockReset();
  mockRequireRoomOwnership.mockReset();
  mockRequireRoomOwnership.mockResolvedValue(null); // caller owns the target room in every case
});
afterEach(() => vi.restoreAllMocks());

describe("bundle creation product<->room binding", () => {
  it("404s and creates NO bundle items when a product id is not in the room", async () => {
    const insertSpy = vi.fn().mockResolvedValue({ error: null });
    // Room owns only prod-A; the request also references prod-FOREIGN (another user's).
    makeClient({ id: "attacker-1" }, ["prod-A"], insertSpy);
    const res = await bundlesPost(req({ room_id: "room-1", name: "b", product_ids: ["prod-A", "prod-FOREIGN"] }));
    expect(res.status).toBe(404);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("succeeds and inserts items when every product id belongs to the room", async () => {
    const insertSpy = vi.fn().mockResolvedValue({ error: null });
    makeClient({ id: "owner-1" }, ["prod-A", "prod-B"], insertSpy);
    const res = await bundlesPost(req({ room_id: "room-1", name: "b", product_ids: ["prod-A", "prod-B"] }));
    expect(res.status).toBe(201);
    expect(insertSpy).toHaveBeenCalledTimes(1);
  });

  it("skips the binding query and succeeds for a bundle with no products", async () => {
    const insertSpy = vi.fn().mockResolvedValue({ error: null });
    makeClient({ id: "owner-1" }, [], insertSpy);
    const res = await bundlesPost(req({ room_id: "room-1", name: "empty" }));
    expect(res.status).toBe(201);
    expect(insertSpy).not.toHaveBeenCalled();
  });
});
