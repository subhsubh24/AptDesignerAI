import { beforeEach, afterEach, describe, expect, it, vi, type Mock } from "vitest";

// Regression guard: POST /api/bundles/evaluate discarded `error` on the bundle
// fetch, silently collapsing a real DB failure (timeout, RLS denial, connection
// reset) into the same 404 "Bundle not found" as a legitimate not-found bundle,
// with nothing surfaced to the caller as a retryable failure. Mirrors the sibling
// fix in app/api/mockups/route.ts (bundleItemsError) and the area-analysis
// route family's error-classification pattern.

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth/ownership", () => ({ requireRoomOwnership: vi.fn() }));
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
vi.mock("@/lib/agents/bundle-optimizer", () => ({
  evaluateBundle: vi.fn(async () => ({
    success: true,
    data: { scores: {}, final_bundle_score: 8, verdict: "good", analysis: "ok", room_vibe: null },
    model: "stub-model",
    tokensUsed: 1,
  })),
}));

import { createClient } from "@/lib/supabase/server";
import { requireRoomOwnership } from "@/lib/auth/ownership";
import { evaluateBundle } from "@/lib/agents/bundle-optimizer";
import { POST as evaluatePost } from "@/app/api/bundles/evaluate/route";

const mockCreateClient = createClient as unknown as Mock;
const mockRequireRoomOwnership = requireRoomOwnership as unknown as Mock;
const mockEvaluateBundle = evaluateBundle as unknown as Mock;

function makeClient(bundleResult: { data: unknown; error?: unknown }) {
  const from = vi.fn((table: string) => {
    if (table === "product_bundles") {
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn().mockReturnValue(chain);
      chain.eq = vi.fn().mockReturnValue(chain);
      chain.single = vi.fn().mockResolvedValue({ error: null, ...bundleResult });
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
  mockRequireRoomOwnership.mockReset();
  mockEvaluateBundle.mockClear();
  mockRequireRoomOwnership.mockResolvedValue(null);
});
afterEach(() => vi.restoreAllMocks());

describe("POST /api/bundles/evaluate — error classification", () => {
  it("returns 404 'Bundle not found' when the bundle is genuinely absent (PGRST116)", async () => {
    makeClient({ data: null, error: { code: "PGRST116", message: "no rows" } });
    const res = await evaluatePost(req({ bundle_id: "missing-bundle" }));
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe("Bundle not found");
  });

  it("returns 500 (not 404) when the bundle fetch hits a real DB error", async () => {
    makeClient({ data: null, error: { code: "53300", message: "too many connections" } });
    const res = await evaluatePost(req({ bundle_id: "bundle-1" }));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).not.toBe("Bundle not found");
    // The paid LLM evaluation must never run on a DB failure.
    expect(mockEvaluateBundle).not.toHaveBeenCalled();
  });
});
