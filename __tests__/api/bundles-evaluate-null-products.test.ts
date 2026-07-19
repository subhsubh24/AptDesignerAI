import { beforeEach, afterEach, describe, expect, it, vi, type Mock } from "vitest";

// Regression guard: the bundles/evaluate route loads products via a nested
// Supabase join (product_bundle_items -> candidate_products). A bundle_item whose
// product row was deleted (or a broken FK) yields a null candidate_products. Before
// the fix that null flowed straight into evaluateBundle, whose first deref
// (p.id / p.category) threw an UNCAUGHT error -> a 500 on a paid path that left the
// bundle stuck at "pending" and orphaned the just-created agent run. The route now
// filters nulls and rejects a bundle with no resolvable products BEFORE the paid
// LLM call. Mirrors the route-mock pattern in bundles-product-binding.test.ts.
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth/ownership", () => ({ userOwnsRoom: vi.fn() }));
vi.mock("@/lib/agents/bundle-optimizer", () => ({ evaluateBundle: vi.fn() }));
vi.mock("@/lib/db/agent-runs", () => ({
  createAgentRun: vi.fn(async () => ({ id: "run-1" })),
  completeAgentRun: vi.fn(async () => {}),
}));
vi.mock("@/lib/design-context/build-profile", () => ({ buildDesignProfile: vi.fn(() => ({})) }));
vi.mock("@/lib/utils/rate-limiter", () => ({
  checkRateLimit: vi.fn(() => ({ allowed: true })),
  RATE_LIMITS: { bundleEvaluate: { maxRequests: 10, windowMs: 60_000 } },
}));
vi.mock("@/lib/utils/spend-limiter", () => ({
  checkDailySpend: vi.fn(() => ({ allowed: true })),
  dailySpendExceededResponse: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";
import { userOwnsRoom } from "@/lib/auth/ownership";
import { evaluateBundle } from "@/lib/agents/bundle-optimizer";
import { POST } from "@/app/api/bundles/evaluate/route";

const mockCreateClient = createClient as unknown as Mock;
const mockUserOwnsRoom = userOwnsRoom as unknown as Mock;
const mockEvaluateBundle = evaluateBundle as unknown as Mock;

/**
 * Supabase stub for the evaluate route. `bundleItems` is the nested
 * product_bundle_items array (each item's candidate_products may be null).
 */
function makeClient(user: { id: string } | null, bundleItems: Array<{ candidate_products: unknown }>) {
  const from = vi.fn((table: string) => {
    if (table === "product_bundles") {
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn().mockReturnValue(chain);
      chain.eq = vi.fn().mockReturnValue(chain);
      // .select(...).eq("id", ...).single() for the fetch; .update(...).eq(...) for status.
      chain.single = vi.fn().mockResolvedValue({
        data: { id: "bundle-1", room_id: "room-1", product_bundle_items: bundleItems },
        error: null,
      });
      chain.update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
      return chain;
    }
    if (table === "rooms") {
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn().mockReturnValue(chain);
      chain.eq = vi.fn().mockReturnValue(chain);
      chain.single = vi.fn().mockResolvedValue({
        data: { id: "room-1", room_type: "living_room", room_images: [], project_id: null },
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
      chain.single = vi.fn().mockResolvedValue({ data: null, error: null });
      return chain;
    }
    if (table === "bundle_evaluations") {
      const chain: Record<string, unknown> = {};
      chain.insert = vi.fn().mockReturnValue(chain);
      chain.select = vi.fn().mockReturnValue(chain);
      chain.single = vi.fn().mockResolvedValue({ data: { id: "eval-1" }, error: null });
      return chain;
    }
    return {};
  });
  mockCreateClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user } }) },
    from,
  });
}

function req(body: unknown) {
  return new Request("http://localhost/api/bundles/evaluate", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("bundles/evaluate — null candidate_products handling", () => {
  beforeEach(() => {
    mockUserOwnsRoom.mockResolvedValue(true);
    mockEvaluateBundle.mockResolvedValue({
      success: true,
      data: { scores: {}, final_bundle_score: 8, verdict: "ship", analysis: "ok" },
      model: "test-model",
    });
  });
  afterEach(() => vi.clearAllMocks());

  it("drops null products from a broken join and evaluates only resolvable ones", async () => {
    const validProduct = { id: "p-1", category: "sofa", title: "Sofa" };
    makeClient({ id: "u-1" }, [{ candidate_products: validProduct }, { candidate_products: null }]);

    const res = await POST(req({ bundle_id: "bundle-1" }));

    expect(res.status).toBe(201);
    expect(mockEvaluateBundle).toHaveBeenCalledTimes(1);
    // The null must never reach evaluateBundle (where p.id/p.category would throw).
    const productsArg = mockEvaluateBundle.mock.calls[0][0];
    expect(productsArg).toEqual([validProduct]);
    expect(productsArg).not.toContain(null);
  });

  it("rejects a bundle with no resolvable products BEFORE the paid LLM call", async () => {
    makeClient({ id: "u-1" }, [{ candidate_products: null }, { candidate_products: null }]);

    const res = await POST(req({ bundle_id: "bundle-1" }));

    expect(res.status).toBe(400);
    expect(mockEvaluateBundle).not.toHaveBeenCalled();
  });
});
