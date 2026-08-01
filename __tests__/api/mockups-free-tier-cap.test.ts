import { beforeEach, afterEach, describe, expect, it, vi, type Mock } from "vitest";

// Guards the free-tier caps on mockup renders: the standard full room-scene
// render, and the per-item recommendation-mockup shot.
//
// "AI mockups of finished rooms" is an Apartment-tier feature on /pricing and is
// absent from the free tier's list, but app/api/mockups originally enforced only
// a rate limit on two of its three render modes — so the most expensive calls in
// the product were unlimited for free users, and docs/BUSINESS_CASE.md's claim
// that "the free tier caps renders per user" was not true of the code (#748).
//
// The properties that matter, and that these tests pin:
//   1. A blocked request costs NOTHING — each gate runs before its render, so no
//      job/run row is created and no image model is reached.
//   2. `recommendation_mockup` is capped per-user across ALL their rooms,
//      excluding failed/incomplete runs from the count (an outage must not
//      consume the allowance).
//   3. `vision_mode` (the preview the focus page auto-generates the moment an
//      analysis lands — the free tier's "aha") stays deliberately UNGATED; a
//      regression there would trade activation for revenue.

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth/ownership", () => ({ userOwnsRoom: vi.fn() }));
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
// Only the entitlement lookup is stubbed — FREE_MOCKUP_LIMIT_WEB stays REAL so
// these tests fail if the shipped limit stops matching what they assert.
vi.mock("@/lib/entitlements/web", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/entitlements/web")>()),
  hasProEntitlementWeb: vi.fn(async () => false),
}));
// The render pipeline is stubbed so a request that PASSES the gate proceeds into
// it (and we can prove it did) without calling a real image model.
vi.mock("@/lib/agents/mockup-agent", () => ({
  generateMockupPrompt: vi.fn(async () => ({ success: false, error: "stub-prompt-fail" })),
  generateMockupImage: vi.fn(async () => ({ success: false, error: "stub-image-fail" })),
  buildMockupContext: vi.fn(() => ({ diagnosisSummary: "", existingItems: [], designDirection: "" })),
}));
vi.mock("@/lib/agents/mockup-prompt-validator", () => ({ validateMockupPrompt: vi.fn() }));
// Shaped like the real MockupVerificationResult (mockup-verifier.ts:29-35) —
// an empty finalImageData is its genuine "generation failed" return, which the
// route handles. A bare vi.fn() returning undefined would make the vision and
// recommendation branches throw for a reason production never produces.
vi.mock("@/lib/agents/mockup-verifier", () => ({
  generateWithVerification: vi.fn(async () => ({
    verified: false,
    attempts: 1,
    finalVerification: null,
    finalImageData: "",
    finalImageMimeType: undefined,
  })),
}));
vi.mock("@/lib/agents/photo-orientation-analyzer", () => ({ analyzePhotoOrientations: vi.fn(async () => []) }));
vi.mock("@/lib/agents/room-architecture-extractor", () => ({
  extractRoomArchitecture: vi.fn(async () => null),
  formatArchitectureForPrompt: vi.fn(() => ""),
}));
vi.mock("@/lib/agents/format-floor-plan", () => ({ getRoomFromFloorPlan: vi.fn(() => undefined) }));

import { createClient } from "@/lib/supabase/server";
import { userOwnsRoom } from "@/lib/auth/ownership";
import { createAgentRun } from "@/lib/db/agent-runs";
import { hasProEntitlementWeb, FREE_MOCKUP_LIMIT_WEB, FREE_RECOMMENDATION_MOCKUP_LIMIT_WEB } from "@/lib/entitlements/web";
import { POST as mockupsPost } from "@/app/api/mockups/route";

const mockCreateClient = createClient as unknown as Mock;
const mockUserOwnsRoom = userOwnsRoom as unknown as Mock;
const mockHasPro = hasProEntitlementWeb as unknown as Mock;
const mockCreateAgentRun = createAgentRun as unknown as Mock;

type Harness = {
  /** Spy on the mockup_jobs INSERT — the first billable step of a render. */
  jobInsert: Mock;
  /** Spy on the counting SELECT (the one passed `{ count: "exact" }`). */
  countSelect: Mock;
  /** Spy on the `.neq(...)` applied to the count query. */
  countNeq: Mock;
  /** Spy on the ownership `.eq(...)` applied to the standard-mode count query. */
  countEq: Mock;
  /** Spy on the ownership `.eq(...)` applied to the recommendation count query. */
  recCountOwnerEq: Mock;
  /** Spy on the `.eq("agent_type", ...)` applied to the recommendation count query. */
  recCountTypeEq: Mock;
  /** Spy on the `.eq("status", ...)` applied to the recommendation count query (the resolving call). */
  recCountStatusEq: Mock;
  /** Spy on the recommendation count SELECT (the one passed `{ count: "exact" }`). */
  recCountSelect: Mock;
};

/**
 * Supabase stub for the mockup POST. `existingMockups` is what the standard-mode
 * free-tier count query returns; `existingRecommendations` is what the
 * recommendation-mode free-tier count query returns.
 */
function makeClient(opts: { user: { id: string }; existingMockups: number; existingRecommendations?: number }): Harness {
  const { user, existingMockups, existingRecommendations = 0 } = opts;
  const jobInsert = vi.fn().mockReturnValue({
    select: () => ({ single: async () => ({ data: { id: "job-1" }, error: null }) }),
  });
  const countNeq = vi.fn().mockResolvedValue({ count: existingMockups, error: null });
  const countEq = vi.fn();
  const countSelect = vi.fn();

  const recCountStatusEq = vi.fn().mockResolvedValue({ count: existingRecommendations, error: null });
  const recCountTypeEq = vi.fn().mockReturnValue({ eq: recCountStatusEq });
  const recCountOwnerEq = vi.fn().mockReturnValue({ eq: recCountTypeEq });
  const recCountSelect = vi.fn().mockReturnValue({ eq: recCountOwnerEq });

  const from = vi.fn((table: string) => {
    if (table === "rooms") {
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn().mockReturnValue(chain);
      chain.eq = vi.fn().mockReturnValue(chain);
      chain.single = vi.fn().mockResolvedValue({
        data: {
          id: "room-1",
          room_type: "living_room",
          project_id: "proj-1",
          room_images: [{ image_url: "https://example.test/room.jpg" }],
          priorities: [],
        },
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
    if (table === "candidate_products") {
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn().mockReturnValue(chain);
      chain.eq = vi.fn().mockReturnValue(chain);
      chain.in = vi.fn().mockReturnValue(chain);
      chain.then = (res: (v: unknown) => unknown) => res({ data: [{ id: "prod-A" }], error: null });
      return chain;
    }
    if (table === "agent_runs") {
      // The only real (unmocked) read against this table is the
      // recommendation-mockup free-tier count — createAgentRun/completeAgentRun
      // are mocked at the module level and never touch the client.
      return { select: recCountSelect };
    }
    if (table === "mockup_jobs") {
      const chain: Record<string, unknown> = {};
      // The counting read and the write path share this table, so they are told
      // apart by the `{ count: "exact" }` option the cap query passes.
      const countChain: Record<string, unknown> = {};
      countEq.mockReturnValue(countChain);
      countChain.eq = countEq;
      countChain.neq = countNeq;
      countSelect.mockImplementation((_cols: string, options?: { count?: string }) =>
        options?.count ? countChain : chain,
      );
      chain.select = countSelect;
      chain.insert = jobInsert;
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
    storage: {
      from: () => ({
        upload: async () => ({ data: null, error: { message: "x" } }),
        getPublicUrl: () => ({ data: { publicUrl: "" } }),
      }),
    },
  });

  return { jobInsert, countSelect, countNeq, countEq, recCountOwnerEq, recCountTypeEq, recCountStatusEq, recCountSelect };
}

function req(body: unknown) {
  return new Request("http://localhost/api/mockups", { method: "POST", body: JSON.stringify(body) });
}

beforeEach(() => {
  mockCreateClient.mockReset();
  mockUserOwnsRoom.mockReset();
  mockUserOwnsRoom.mockResolvedValue(true);
  mockHasPro.mockReset();
  mockHasPro.mockResolvedValue(false);
  mockCreateAgentRun.mockClear();
});
afterEach(() => vi.restoreAllMocks());

describe("free-tier full-room mockup cap", () => {
  it("403s a free user who has spent the allowance, and starts NO render", async () => {
    const h = makeClient({ user: { id: "free-1" }, existingMockups: FREE_MOCKUP_LIMIT_WEB });
    const res = await mockupsPost(req({ room_id: "room-1", product_ids: ["prod-A"] }));

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.subscription_required).toBe(true);
    expect(body.limit).toBe(FREE_MOCKUP_LIMIT_WEB);
    // The whole point of gating here: a refused request must not have paid for
    // anything. No job row means the image model was never reached.
    expect(h.jobInsert).not.toHaveBeenCalled();
  });

  it("lets a free user under the allowance through to the render", async () => {
    const h = makeClient({ user: { id: "free-1" }, existingMockups: FREE_MOCKUP_LIMIT_WEB - 1 });
    const res = await mockupsPost(req({ room_id: "room-1", product_ids: ["prod-A"] }));

    expect(res.status).not.toBe(403);
    expect(h.jobInsert).toHaveBeenCalledTimes(1);
  });

  it("lets a PAID user render past the free allowance", async () => {
    mockHasPro.mockResolvedValue(true);
    const h = makeClient({ user: { id: "pro-1" }, existingMockups: FREE_MOCKUP_LIMIT_WEB + 5 });
    const res = await mockupsPost(req({ room_id: "room-1", product_ids: ["prod-A"] }));

    expect(res.status).not.toBe(403);
    expect(h.jobInsert).toHaveBeenCalledTimes(1);
    expect(mockHasPro).toHaveBeenCalledWith("pro-1");
  });

  it("does not pay for an entitlement lookup while the user is under the allowance", async () => {
    makeClient({ user: { id: "free-1" }, existingMockups: 0 });
    await mockupsPost(req({ room_id: "room-1", product_ids: ["prod-A"] }));

    expect(mockHasPro).not.toHaveBeenCalled();
  });

  it("excludes failed renders from the count — an outage must not consume the allowance", async () => {
    const h = makeClient({ user: { id: "free-1" }, existingMockups: 0 });
    await mockupsPost(req({ room_id: "room-1", product_ids: ["prod-A"] }));

    expect(h.countNeq).toHaveBeenCalledWith("status", "failed");
  });

  it("counts renders across ALL of the user's rooms, not just this one", async () => {
    const h = makeClient({ user: { id: "free-1" }, existingMockups: 0 });
    await mockupsPost(req({ room_id: "room-1", product_ids: ["prod-A"] }));

    // A per-room count would let a free user mint unlimited renders by making
    // more rooms, so ownership must be resolved through the project chain.
    expect(h.countEq).toHaveBeenCalledWith("rooms.projects.user_id", "free-1");
    expect(h.countSelect).toHaveBeenCalledWith(
      expect.stringContaining("rooms!inner(projects!inner(user_id))"),
      expect.objectContaining({ count: "exact" }),
    );
  });

  it("never gates the vision preview — it is the free tier's first look at a finished room", async () => {
    const h = makeClient({ user: { id: "free-1" }, existingMockups: FREE_MOCKUP_LIMIT_WEB + 10 });
    const res = await mockupsPost(
      req({ room_id: "room-1", vision_mode: true, design_direction: "warm minimal", items_description: "sofa" }),
    );

    expect(res.status).not.toBe(403);
    // Proves the scoping, not just the outcome: the cap query is never issued.
    expect(h.countNeq).not.toHaveBeenCalled();
    expect(mockHasPro).not.toHaveBeenCalled();
  });

});

describe("free-tier recommendation-mockup cap", () => {
  function recReq(recommendation_mockup: Record<string, unknown> = { category: "sofa", search_title: "linen sofa" }) {
    return req({ room_id: "room-1", recommendation_mockup });
  }

  it("403s a free user who has spent the recommendation allowance, and starts no agent run", async () => {
    const h = makeClient({
      user: { id: "free-1" },
      existingMockups: 0,
      existingRecommendations: FREE_RECOMMENDATION_MOCKUP_LIMIT_WEB,
    });
    const res = await mockupsPost(recReq());

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.subscription_required).toBe(true);
    expect(body.limit).toBe(FREE_RECOMMENDATION_MOCKUP_LIMIT_WEB);
    // A refused request must not have paid for anything — no agent run, no
    // image model call.
    expect(mockCreateAgentRun).not.toHaveBeenCalled();
    void h;
  });

  it("lets a free user under the recommendation allowance through", async () => {
    const h = makeClient({
      user: { id: "free-1" },
      existingMockups: 0,
      existingRecommendations: FREE_RECOMMENDATION_MOCKUP_LIMIT_WEB - 1,
    });
    const res = await mockupsPost(recReq());

    expect(res.status).not.toBe(403);
    expect(mockCreateAgentRun).toHaveBeenCalledTimes(1);
    void h;
  });

  it("lets a PAID user render past the recommendation allowance", async () => {
    mockHasPro.mockResolvedValue(true);
    const h = makeClient({
      user: { id: "pro-1" },
      existingMockups: 0,
      existingRecommendations: FREE_RECOMMENDATION_MOCKUP_LIMIT_WEB + 5,
    });
    const res = await mockupsPost(recReq());

    expect(res.status).not.toBe(403);
    expect(mockCreateAgentRun).toHaveBeenCalledTimes(1);
    expect(mockHasPro).toHaveBeenCalledWith("pro-1");
    void h;
  });

  it("does not pay for an entitlement lookup while under the recommendation allowance", async () => {
    makeClient({ user: { id: "free-1" }, existingMockups: 0, existingRecommendations: 0 });
    await mockupsPost(recReq());

    expect(mockHasPro).not.toHaveBeenCalled();
  });

  it("excludes non-completed (failed/running) renders from the recommendation count", async () => {
    const h = makeClient({ user: { id: "free-1" }, existingMockups: 0, existingRecommendations: 0 });
    await mockupsPost(recReq());

    expect(h.recCountStatusEq).toHaveBeenCalledWith("status", "completed");
    expect(h.recCountTypeEq).toHaveBeenCalledWith("agent_type", "mockup_recommendation");
  });

  it("counts recommendation renders across ALL of the user's rooms, not just this one", async () => {
    const h = makeClient({ user: { id: "free-1" }, existingMockups: 0, existingRecommendations: 0 });
    await mockupsPost(recReq());

    expect(h.recCountOwnerEq).toHaveBeenCalledWith("rooms.projects.user_id", "free-1");
    expect(h.recCountSelect).toHaveBeenCalledWith(
      expect.stringContaining("rooms!inner(projects!inner(user_id))"),
      expect.objectContaining({ count: "exact" }),
    );
  });
});

describe("vision-mode stays ungated", () => {
  it("never gates the vision preview — it is the free tier's first look at a finished room", async () => {
    const h = makeClient({ user: { id: "free-1" }, existingMockups: FREE_MOCKUP_LIMIT_WEB + 10 });
    const res = await mockupsPost(
      req({ room_id: "room-1", vision_mode: true, design_direction: "warm minimal", items_description: "sofa" }),
    );

    expect(res.status).not.toBe(403);
    // Proves the scoping, not just the outcome: neither cap query is issued.
    expect(h.countNeq).not.toHaveBeenCalled();
    expect(h.recCountStatusEq).not.toHaveBeenCalled();
    expect(mockHasPro).not.toHaveBeenCalled();
  });
});
