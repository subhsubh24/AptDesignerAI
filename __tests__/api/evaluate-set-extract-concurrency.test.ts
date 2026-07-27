import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

/**
 * /api/products/evaluate-set turns every URL in the request body into an LLM
 * extraction. The scoring phase below it was already batched at 5; extraction —
 * the phase directly above, and equally an LLM call per URL — ran `Promise.all`
 * over the whole body at once. This pins the gate that closed that asymmetry.
 *
 * There is deliberately NO test for a total-URL ceiling. An earlier version of
 * this change added one and it was dropped: no defensible bound on a legitimate
 * request size exists in the code today. `what_it_needs`, the array that feeds
 * ManualSourcingForm, is uncapped, and the pipeline's own ROOM_FURNISHING_TIERS
 * targets run to 28 categories for a studio — so any ceiling picked here risks
 * rejecting ordinary requests. The concurrency gate ships alone.
 */
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth/ownership", () => ({ userOwnsRoom: vi.fn() }));
vi.mock("@/lib/utils/rate-limiter", () => ({
  checkRateLimit: vi.fn(() => ({ allowed: true })),
  RATE_LIMITS: { bundleEvaluate: { windowMs: 60_000, max: 10 } },
}));
vi.mock("@/lib/utils/spend-limiter", () => ({
  checkDailySpend: vi.fn(() => ({ allowed: true })),
  dailySpendExceededResponse: vi.fn(),
}));
vi.mock("@/lib/agents/product-extractor", () => ({ extractFromUrl: vi.fn() }));
vi.mock("@/lib/agents/fit-scorer", () => ({ scoreProduct: vi.fn() }));
vi.mock("@/lib/agents/bundle-optimizer", () => ({ evaluateBundle: vi.fn() }));
vi.mock("@/lib/design-context/build-profile", () => ({ buildDesignProfile: vi.fn() }));

import { createClient } from "@/lib/supabase/server";
import { userOwnsRoom } from "@/lib/auth/ownership";
import { extractFromUrl } from "@/lib/agents/product-extractor";
import { POST } from "@/app/api/products/evaluate-set/route";

const mockCreateClient = createClient as unknown as Mock;
const mockOwnsRoom = userOwnsRoom as unknown as Mock;
const mockExtract = extractFromUrl as unknown as Mock;

function request(body: unknown) {
  return new Request("http://localhost/api/products/evaluate-set", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function urls(count: number) {
  return Array.from({ length: count }, (_, i) => `https://shop.example.com/p/${i}`);
}

/** Supabase double: authed user; any table read resolves to a minimal row. */
function supabaseStub() {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  Object.assign(builder, {
    select: chain,
    eq: chain,
    neq: chain,
    in: chain,
    order: chain,
    limit: chain,
    insert: chain,
    single: async () => ({ data: { id: "r1", project_id: "p1" }, error: null }),
    maybeSingle: async () => ({ data: { id: "r1", project_id: "p1" }, error: null }),
  });
  return {
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    from: () => builder,
  };
}

beforeEach(() => {
  mockCreateClient.mockReset();
  mockOwnsRoom.mockReset();
  mockExtract.mockReset();
  mockCreateClient.mockResolvedValue(supabaseStub());
  mockOwnsRoom.mockResolvedValue(true);
  // A per-URL extraction failure is a normal result, not a thrown request — it
  // keeps these tests on the fan-out and off the save path.
  mockExtract.mockResolvedValue({ success: false, error: "stubbed" });
});

describe("POST /api/products/evaluate-set — extraction fan-out is bounded", () => {
  it("never runs more than 5 extractions at once, however many URLs are posted", async () => {
    let inFlight = 0;
    let peak = 0;
    mockExtract.mockImplementation(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 2));
      inFlight--;
      return { success: false, error: "stubbed" };
    });

    await POST(request({ room_id: "r1", items: [{ category: "seating", urls: urls(60) }] }));

    expect(mockExtract).toHaveBeenCalledTimes(60);
    // An unbounded Promise.all over the request body puts this at 60.
    expect(peak).toBeLessThanOrEqual(5);
    expect(peak).toBeGreaterThan(1);
  });

  it("throttles without dropping — every URL across every item is still extracted", async () => {
    const items = [
      { category: "seating", urls: urls(7) },
      { category: "lighting", urls: urls(7) },
      { category: "rugs", urls: urls(7) },
    ];

    await POST(request({ room_id: "r1", items }));

    expect(mockExtract).toHaveBeenCalledTimes(21);
  });

  it("reports results in REQUEST order, not completion order", async () => {
    // Later URLs finish FIRST, so a completion-ordered implementation would
    // scramble which result belongs to which URL.
    mockExtract.mockImplementation(async (url: string) => {
      const i = Number(url.split("/").pop());
      await new Promise((resolve) => setTimeout(resolve, (10 - i) * 2));
      return { success: false, error: `err-${i}` };
    });

    const res = await POST(request({ room_id: "r1", items: [{ category: "seating", urls: urls(6) }] }));
    const body = await res.json();

    expect(body.details.map((d: { url: string }) => d.url)).toEqual(urls(6));
  });
});
