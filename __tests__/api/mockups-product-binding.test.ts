import { beforeEach, afterEach, describe, expect, it, vi, type Mock } from "vitest";

// Regression guard for the mockups product<->room binding IDOR fix. The standard
// (product-based) mockup POST takes a client-supplied bundle_id OR product_ids.
// Owning the target room is NOT sufficient — the bundle must belong to that room
// and every product id must be a product of that room, or an owner of room A
// could pass another user's bundle_id / product_ids (room B) and have their
// catalog data fetched, rendered into a mockup, and persisted in
// selected_products (a cross-tenant read + paid render on data they don't own).
// The memory-store query is not user-scoped, so this app-layer bind is the only
// boundary. Mirrors app/api/bundles/route.ts:74-95.

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth/ownership", () => ({ requireRoomOwnership: vi.fn() }));
vi.mock("@/lib/utils/rate-limiter", () => ({
  checkRateLimit: vi.fn(() => ({ allowed: true })),
  RATE_LIMITS: { mockup: {}, recommendationMockup: {} },
}));
vi.mock("@/lib/utils/spend-limiter", () => ({
  checkDailySpend: vi.fn(() => ({ allowed: true })),
  dailySpendExceededResponse: vi.fn(),
}));
vi.mock("@/lib/observability/margin-context", () => ({
  runWithMarginSession: (_room: string, _name: string, fn: () => unknown) => fn(),
}));
vi.mock("@/lib/db/agent-runs", () => ({
  createAgentRun: vi.fn(async () => ({ id: "agent-run-1" })),
  completeAgentRun: vi.fn(async () => {}),
}));
// The render pipeline is stubbed so a request that PASSES the binding proceeds
// into it (and we can prove it did) without calling a real image model.
vi.mock("@/lib/agents/mockup-agent", () => ({
  generateMockupPrompt: vi.fn(async () => ({ success: false, error: "stub-prompt-fail" })),
  generateMockupImage: vi.fn(),
  buildMockupContext: vi.fn(() => ({ diagnosisSummary: "", existingItems: [], designDirection: "" })),
}));
vi.mock("@/lib/agents/mockup-prompt-validator", () => ({ validateMockupPrompt: vi.fn() }));
vi.mock("@/lib/agents/mockup-verifier", () => ({ generateWithVerification: vi.fn() }));
vi.mock("@/lib/agents/photo-orientation-analyzer", () => ({ analyzePhotoOrientations: vi.fn(async () => []) }));
vi.mock("@/lib/agents/room-architecture-extractor", () => ({
  extractRoomArchitecture: vi.fn(async () => null),
  formatArchitectureForPrompt: vi.fn(() => ""),
}));
vi.mock("@/lib/agents/format-floor-plan", () => ({ getRoomFromFloorPlan: vi.fn(() => undefined) }));

import { createClient } from "@/lib/supabase/server";
import { requireRoomOwnership } from "@/lib/auth/ownership";
import { POST as mockupsPost } from "@/app/api/mockups/route";

const mockCreateClient = createClient as unknown as Mock;
const mockRequireRoomOwnership = requireRoomOwnership as unknown as Mock;

/**
 * Build a Supabase stub for the standard-mode mockup POST.
 *   ownedProductIds — candidate_products ids the room actually owns (what the
 *                     binding `.eq("room_id").in("id")` query returns).
 *   bundleBelongsToRoom — whether product_bundles has a row for (bundle_id, room_id).
 *   jobInsertSpy — records mockup_jobs inserts so we can assert a rejected
 *                  request starts NO render (no job row).
 */
function makeClient(opts: {
  user: { id: string } | null;
  ownedProductIds?: string[];
  bundleBelongsToRoom?: boolean;
  jobInsertSpy: Mock;
  // Raw product_bundle_items rows for the bundle branch. When set, overrides the
  // rows derived from ownedProductIds — lets a test inject a null candidate_products
  // (a deleted-FK nested join) to exercise the null-filter guard.
  bundleItemsRaw?: Array<{ candidate_products: unknown }>;
  // A real DB error on the product_bundle_items query (timeout, RLS denial, etc.),
  // as distinct from the table legitimately returning zero rows.
  bundleItemsError?: { code: string; message: string };
}) {
  const { user, ownedProductIds = [], bundleBelongsToRoom = false, jobInsertSpy, bundleItemsRaw, bundleItemsError } = opts;
  const from = vi.fn((table: string) => {
    if (table === "rooms") {
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn().mockReturnValue(chain);
      chain.eq = vi.fn().mockReturnValue(chain);
      chain.single = vi.fn().mockResolvedValue({
        data: { id: "room-1", room_type: "living_room", project_id: "proj-1", room_images: [], priorities: [] },
        error: null,
      });
      return chain;
    }
    if (table === "room_diagnoses") {
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn().mockReturnValue(chain);
      chain.eq = vi.fn().mockReturnValue(chain);
      chain.order = vi.fn().mockReturnValue(chain);
      chain.limit = vi.fn().mockReturnValue(chain);
      chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
      return chain;
    }
    if (table === "projects") {
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn().mockReturnValue(chain);
      chain.eq = vi.fn().mockReturnValue(chain);
      chain.single = vi.fn().mockResolvedValue({ data: { id: "proj-1" }, error: null });
      return chain;
    }
    if (table === "product_bundles") {
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn().mockReturnValue(chain);
      chain.eq = vi.fn().mockReturnValue(chain);
      chain.maybeSingle = vi.fn().mockResolvedValue({
        data: bundleBelongsToRoom ? { id: "bundle-1" } : null,
        error: null,
      });
      return chain;
    }
    if (table === "product_bundle_items") {
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn().mockReturnValue(chain);
      chain.eq = vi.fn().mockResolvedValue(
        bundleItemsError
          ? { data: null, error: bundleItemsError }
          : {
              data: bundleItemsRaw ?? ownedProductIds.map((id) => ({ candidate_products: { id } })),
              error: null,
            },
      );
      return chain;
    }
    if (table === "candidate_products") {
      // .select("*").eq("room_id", ...).in("id", ids) — awaited directly.
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn().mockReturnValue(chain);
      chain.eq = vi.fn().mockReturnValue(chain);
      chain.in = vi.fn().mockReturnValue(chain);
      chain.then = (res: (v: unknown) => unknown) =>
        res({ data: ownedProductIds.map((id) => ({ id })), error: null });
      return chain;
    }
    if (table === "mockup_jobs") {
      const chain: Record<string, unknown> = {};
      // The free-tier cap counts this table with `{ count: "exact" }` before any
      // render work; the write path uses the same table without it. These tests
      // are about the product<->room bind, so the count always reports 0 (under
      // the allowance) and the request proceeds to the bind as before.
      const countChain: Record<string, unknown> = {};
      countChain.eq = vi.fn().mockReturnValue(countChain);
      countChain.neq = vi.fn().mockResolvedValue({ count: 0, error: null });
      chain.insert = jobInsertSpy;
      chain.select = vi.fn((_cols?: string, options?: { count?: string }) =>
        options?.count ? countChain : chain,
      );
      chain.single = vi.fn().mockResolvedValue({ data: { id: "job-1" }, error: null });
      chain.update = vi.fn().mockReturnValue(chain);
      chain.eq = vi.fn().mockResolvedValue({ error: null });
      return chain;
    }
    return {};
  });
  mockCreateClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user } }) },
    from,
    storage: { from: () => ({ upload: async () => ({ data: null, error: { message: "x" } }), getPublicUrl: () => ({ data: { publicUrl: "" } }) }) },
  });
}

function req(body: unknown) {
  return new Request("http://localhost/api/mockups", { method: "POST", body: JSON.stringify(body) });
}

beforeEach(() => {
  mockCreateClient.mockReset();
  mockRequireRoomOwnership.mockReset();
  mockRequireRoomOwnership.mockResolvedValue(null); // caller owns the target room in every case
});
afterEach(() => vi.restoreAllMocks());

describe("standard mockup product<->room binding", () => {
  it("404s and starts NO render when a product_id is not in the room", async () => {
    const jobInsertSpy = vi.fn().mockReturnValue({ select: () => ({ single: async () => ({ data: { id: "job-1" }, error: null }) }) });
    // Room owns only prod-A; request also references prod-FOREIGN (another user's).
    makeClient({ user: { id: "attacker-1" }, ownedProductIds: ["prod-A"], jobInsertSpy });
    const res = await mockupsPost(req({ room_id: "room-1", product_ids: ["prod-A", "prod-FOREIGN"] }));
    expect(res.status).toBe(404);
    expect(jobInsertSpy).not.toHaveBeenCalled();
  });

  it("404s and starts NO render when bundle_id does not belong to the room", async () => {
    const jobInsertSpy = vi.fn().mockReturnValue({ select: () => ({ single: async () => ({ data: { id: "job-1" }, error: null }) }) });
    makeClient({ user: { id: "attacker-1" }, bundleBelongsToRoom: false, jobInsertSpy });
    const res = await mockupsPost(req({ room_id: "room-1", bundle_id: "bundle-FOREIGN" }));
    expect(res.status).toBe(404);
    expect(jobInsertSpy).not.toHaveBeenCalled();
  });

  it("passes the bind and proceeds to render when every product_id belongs to the room", async () => {
    const jobInsertSpy = vi.fn().mockReturnValue({ select: () => ({ single: async () => ({ data: { id: "job-1" }, error: null }) }) });
    makeClient({ user: { id: "owner-1" }, ownedProductIds: ["prod-A", "prod-B"], jobInsertSpy });
    const res = await mockupsPost(req({ room_id: "room-1", product_ids: ["prod-A", "prod-B"] }));
    // Binding accepted (NOT a 404); the stubbed prompt then fails → 500. The point
    // is the request got PAST the bind and started the render (job row created).
    expect(res.status).not.toBe(404);
    expect(jobInsertSpy).toHaveBeenCalledTimes(1);
  });

  it("passes the bind for a bundle that belongs to the room", async () => {
    const jobInsertSpy = vi.fn().mockReturnValue({ select: () => ({ single: async () => ({ data: { id: "job-1" }, error: null }) }) });
    makeClient({ user: { id: "owner-1" }, bundleBelongsToRoom: true, ownedProductIds: ["prod-A"], jobInsertSpy });
    const res = await mockupsPost(req({ room_id: "room-1", bundle_id: "bundle-1" }));
    expect(res.status).not.toBe(404);
    expect(jobInsertSpy).toHaveBeenCalledTimes(1);
  });

  // Regression guard: a bundle item whose candidate_products FK was deleted comes
  // back as a null nested join. Before the fix `products.map((p) => p.id)` derefed
  // that null and 500'd this paid render path (crash BEFORE the mockup_jobs insert).
  it("filters a deleted-FK null product and still reaches the render", async () => {
    const jobInsertSpy = vi.fn().mockReturnValue({ select: () => ({ single: async () => ({ data: { id: "job-1" }, error: null }) }) });
    makeClient({
      user: { id: "owner-1" },
      bundleBelongsToRoom: true,
      // one live product + one deleted-FK null → must not crash on the null.
      bundleItemsRaw: [{ candidate_products: { id: "prod-A" } }, { candidate_products: null }],
      jobInsertSpy,
    });
    const res = await mockupsPost(req({ room_id: "room-1", bundle_id: "bundle-1" }));
    // Got past the null-deref (line was BEFORE the job insert) into the render.
    expect(res.status).not.toBe(404);
    expect(jobInsertSpy).toHaveBeenCalledTimes(1);
  });

  // Regression guard: a real DB error on product_bundle_items must not be
  // misclassified as "bundle legitimately has zero items" (400) — it's a
  // genuine failure that should surface as a 500, not a misleading 400 right
  // before what would otherwise be an expensive paid render.
  it("500s (not 400) and starts NO render when the bundle-items query itself errors", async () => {
    const jobInsertSpy = vi.fn().mockReturnValue({ select: () => ({ single: async () => ({ data: { id: "job-1" }, error: null }) }) });
    makeClient({
      user: { id: "owner-1" },
      bundleBelongsToRoom: true,
      bundleItemsError: { code: "53300", message: "too many connections" },
      jobInsertSpy,
    });
    const res = await mockupsPost(req({ room_id: "room-1", bundle_id: "bundle-1" }));
    expect(res.status).toBe(500);
    expect(jobInsertSpy).not.toHaveBeenCalled();
  });

  it("rejects with 400 and starts NO render when every bundle product was deleted", async () => {
    const jobInsertSpy = vi.fn().mockReturnValue({ select: () => ({ single: async () => ({ data: { id: "job-1" }, error: null }) }) });
    makeClient({
      user: { id: "owner-1" },
      bundleBelongsToRoom: true,
      bundleItemsRaw: [{ candidate_products: null }, { candidate_products: null }],
      jobInsertSpy,
    });
    const res = await mockupsPost(req({ room_id: "room-1", bundle_id: "bundle-1" }));
    expect(res.status).toBe(400);
    expect(jobInsertSpy).not.toHaveBeenCalled();
  });
});
