import { beforeEach, afterEach, describe, expect, it, vi, type Mock } from "vitest";

// Guards the free-tier cap on full room-scene mockup renders.
//
// "AI mockups of finished rooms" is an Apartment-tier feature on /pricing and is
// absent from the free tier's list, but app/api/mockups enforced only a rate
// limit — so the most expensive call in the product was unlimited for free
// users, and docs/BUSINESS_CASE.md's claim that "the free tier caps renders per
// user" was not true of the code.
//
// The two properties that matter, and that these tests pin:
//   1. A blocked request costs NOTHING — the gate runs before the render, so no
//      mockup_jobs row is created and no image model is reached.
//   2. The cap is scoped to the STANDARD render only. `vision_mode` (the preview
//      the focus page auto-generates the moment an analysis lands — the free
//      tier's "aha") and `recommendation_mockup` (per-item product shots) are
//      never counted and never gated; a regression there would trade activation
//      for revenue.

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
import { hasProEntitlementWeb, FREE_MOCKUP_LIMIT_WEB } from "@/lib/entitlements/web";
import { POST as mockupsPost } from "@/app/api/mockups/route";

const mockCreateClient = createClient as unknown as Mock;
const mockUserOwnsRoom = userOwnsRoom as unknown as Mock;
const mockHasPro = hasProEntitlementWeb as unknown as Mock;

type Harness = {
  /** Spy on the mockup_jobs INSERT — the first billable step of a render. */
  jobInsert: Mock;
  /** Spy on the counting SELECT (the one passed `{ count: "exact" }`). */
  countSelect: Mock;
  /** Spy on the `.neq(...)` applied to the count query. */
  countNeq: Mock;
  /** Spy on the ownership `.eq(...)` applied to the count query. */
  countEq: Mock;
};

/**
 * Supabase stub for the mockup POST. `existingMockups` is what the free-tier
 * count query returns for this user.
 */
function makeClient(opts: { user: { id: string }; existingMockups: number }): Harness {
  const { user, existingMockups } = opts;
  const jobInsert = vi.fn().mockReturnValue({
    select: () => ({ single: async () => ({ data: { id: "job-1" }, error: null }) }),
  });
  const countNeq = vi.fn().mockResolvedValue({ count: existingMockups, error: null });
  const countEq = vi.fn();
  const countSelect = vi.fn();

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

  return { jobInsert, countSelect, countNeq, countEq };
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

  it("never gates per-item recommendation shots", async () => {
    const h = makeClient({ user: { id: "free-1" }, existingMockups: FREE_MOCKUP_LIMIT_WEB + 10 });
    const res = await mockupsPost(
      req({ room_id: "room-1", recommendation_mockup: { category: "sofa", search_title: "linen sofa" } }),
    );

    expect(res.status).not.toBe(403);
    expect(h.countNeq).not.toHaveBeenCalled();
    expect(mockHasPro).not.toHaveBeenCalled();
  });
});
