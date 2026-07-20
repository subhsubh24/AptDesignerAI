import { beforeEach, afterEach, describe, expect, it, vi, type Mock } from "vitest";

// Regression guard for the deleted-FK null-product crash on the PAID bundle
// evaluation path. The route fetches `product_bundle_items(*, candidate_products(*))`;
// when a candidate_products row was deleted the nested join comes back null. Left
// unfiltered that null flows into evaluateBundle and derefs (`[${p.category}]` in
// bundle-optimizer) → an uncaught 500 on a paid path, leaving the bundle stuck
// "pending" and orphaning the agent run. The fix filters the nulls and rejects a
// bundle that lost ALL its products BEFORE the paid LLM call.

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth/ownership", () => ({ userOwnsRoom: vi.fn() }));
vi.mock("@/lib/utils/rate-limiter", () => ({
  checkRateLimit: vi.fn(() => ({ allowed: true })),
  RATE_LIMITS: { bundleEvaluate: {} },
}));
vi.mock("@/lib/utils/spend-limiter", () => ({
  checkDailySpend: vi.fn(() => ({ allowed: true })),
  dailySpendExceededResponse: vi.fn(),
}));
vi.mock("@/lib/db/agent-runs", () => ({
  createAgentRun: vi.fn(async () => ({ id: "agent-run-1" })),
  completeAgentRun: vi.fn(async () => {}),
}));
// The paid LLM evaluation is stubbed so we can (a) assert what products it
// receives and (b) prove it is NOT called when there is nothing to evaluate.
vi.mock("@/lib/agents/bundle-optimizer", () => ({
  evaluateBundle: vi.fn(async () => ({
    success: true,
    data: { scores: {}, final_bundle_score: 8, verdict: "good", analysis: "ok", room_vibe: null },
    model: "stub-model",
    tokensUsed: 1,
  })),
}));

import { createClient } from "@/lib/supabase/server";
import { userOwnsRoom } from "@/lib/auth/ownership";
import { evaluateBundle } from "@/lib/agents/bundle-optimizer";
import { POST as evaluatePost } from "@/app/api/bundles/evaluate/route";

const mockCreateClient = createClient as unknown as Mock;
const mockUserOwnsRoom = userOwnsRoom as unknown as Mock;
const mockEvaluateBundle = evaluateBundle as unknown as Mock;

// Build a Supabase stub whose bundle carries the given product_bundle_items rows
// (each { candidate_products } may be an object or null). All other reads return
// benign fixtures so a request that gets past the filter runs to a 201.
function makeClient(bundleItems: Array<{ candidate_products: unknown }>) {
  const from = vi.fn((table: string) => {
    if (table === "product_bundles") {
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn().mockReturnValue(chain);
      chain.eq = vi.fn().mockReturnValue(chain);
      chain.update = vi.fn().mockReturnValue(chain);
      // .eq() after update resolves; .single() after select returns the bundle.
      chain.single = vi.fn().mockResolvedValue({
        data: { id: "bundle-1", room_id: "room-1", product_bundle_items: bundleItems },
        error: null,
      });
      return chain;
    }
    if (table === "rooms") {
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn().mockReturnValue(chain);
      chain.eq = vi.fn().mockReturnValue(chain);
      chain.single = vi.fn().mockResolvedValue({
        data: { id: "room-1", room_type: "living_room", project_id: null, room_images: [], priorities: [] },
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
    auth: { getUser: async () => ({ data: { user: { id: "owner-1" } } }) },
    from,
  });
}

function req(body: unknown) {
  return new Request("http://localhost/api/bundles/evaluate", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockCreateClient.mockReset();
  mockUserOwnsRoom.mockReset();
  mockEvaluateBundle.mockClear();
  mockUserOwnsRoom.mockResolvedValue(true); // caller owns the room in every case
});
afterEach(() => vi.restoreAllMocks());

describe("bundles/evaluate deleted-FK null-product handling", () => {
  it("filters a null candidate_products and evaluates only the live products", async () => {
    makeClient([{ candidate_products: { id: "prod-A", category: "sofa" } }, { candidate_products: null }]);
    const res = await evaluatePost(req({ bundle_id: "bundle-1" }));
    // Did NOT crash on the null; reached the (stubbed) paid evaluation.
    expect(res.status).toBe(201);
    expect(mockEvaluateBundle).toHaveBeenCalledTimes(1);
    // The null was filtered out before the LLM call.
    const passedProducts = mockEvaluateBundle.mock.calls[0][0] as unknown[];
    expect(passedProducts).toHaveLength(1);
    expect(passedProducts.every((p) => p != null)).toBe(true);
  });

  it("rejects with 400 and never runs the paid evaluation when every product was deleted", async () => {
    makeClient([{ candidate_products: null }, { candidate_products: null }]);
    const res = await evaluatePost(req({ bundle_id: "bundle-1" }));
    expect(res.status).toBe(400);
    expect(mockEvaluateBundle).not.toHaveBeenCalled();
  });
});
