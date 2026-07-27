import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

/**
 * /api/products/evaluate-set turns every URL in the request body into an LLM
 * extraction plus a deep score. The rate limiter and daily spend breaker cap how
 * OFTEN it runs; nothing capped how much ONE call does. These pin both halves of
 * the guard: a hard ceiling on total URLs, checked before any paid work, and a
 * bounded extraction fan-out rather than "all of them at once".
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

describe("POST /api/products/evaluate-set — request fan-out is bounded", () => {
  it("rejects an oversized request BEFORE doing any paid work", async () => {
    const res = await POST(request({ room_id: "r1", items: [{ category: "seating", urls: urls(41) }] }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/too many products/i);
    // The point of the guard: not one LLM extraction is issued.
    expect(mockExtract).not.toHaveBeenCalled();
  });

  it("counts URLs across ALL items, so splitting the list is not a way around it", async () => {
    const items = [
      { category: "seating", urls: urls(20) },
      { category: "lighting", urls: urls(20) },
      { category: "rugs", urls: urls(20) },
    ];

    const res = await POST(request({ room_id: "r1", items }));

    expect(res.status).toBe(400);
    expect(mockExtract).not.toHaveBeenCalled();
  });

  it("accepts a request at the ceiling and never runs more than 5 extractions at once", async () => {
    let inFlight = 0;
    let peak = 0;
    mockExtract.mockImplementation(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 2));
      inFlight--;
      return { success: false, error: "stubbed" };
    });

    const res = await POST(request({ room_id: "r1", items: [{ category: "seating", urls: urls(40) }] }));

    // 422 (nothing extracted) is the expected outcome for stubbed failures —
    // what matters is that it got past the ceiling check and did the work.
    expect(res.status).not.toBe(400);
    expect(mockExtract).toHaveBeenCalledTimes(40);
    // An unbounded Promise.all over the request body puts this at 40.
    expect(peak).toBeLessThanOrEqual(5);
    expect(peak).toBeGreaterThan(1);
  });
});
