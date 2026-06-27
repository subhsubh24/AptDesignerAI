import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/supabase/admin", () => ({ getAdminClient: vi.fn() }));

import { gatherGrowthMetrics } from "@/lib/growth/metrics";
import { getAdminClient } from "@/lib/supabase/admin";
import { GET } from "@/app/api/internal/growth-metrics/route";

const mockGetAdmin = getAdminClient as unknown as Mock;

interface Counts {
  waitlistTotal: number;
  waitlist7d: number;
  activeSubs: number;
  proSubs: number;
}

// Minimal Supabase-shaped fake: each query is a thenable that resolves to a
// { count, error } based on the table and which filters were applied.
function fakeAdmin(counts: Counts, error: unknown = null) {
  return {
    from(table: string) {
      const state = { table, dateFilter: false, proTier: false };
      const builder = {
        select: () => builder,
        gte: () => {
          state.dateFilter = true;
          return builder;
        },
        eq: (col: string, val: string) => {
          if (col === "tier" && val === "pro") state.proTier = true;
          return builder;
        },
        then(resolve: (v: { count: number | null; error: unknown }) => unknown) {
          let count = 0;
          if (state.table === "waitlist_emails") {
            count = state.dateFilter ? counts.waitlist7d : counts.waitlistTotal;
          } else if (state.table === "stripe_customers") {
            count = state.proTier ? counts.proSubs : counts.activeSubs;
          }
          return Promise.resolve(error ? { count: null, error } : { count, error: null }).then(resolve);
        },
      };
      return builder;
    },
  };
}

describe("gatherGrowthMetrics", () => {
  it("returns real counts keyed by table and filter", async () => {
    const admin = fakeAdmin({ waitlistTotal: 42, waitlist7d: 7, activeSubs: 5, proSubs: 3 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = await gatherGrowthMetrics(admin as any);
    expect(m.source).toBe("supabase");
    expect(m.funnel).toEqual({
      waitlist_signups_total: 42,
      waitlist_signups_7d: 7,
      active_subscribers: 5,
      paid_pro_subscribers: 3,
    });
    expect(typeof m.as_of).toBe("string");
  });

  it("throws when an underlying query errors", async () => {
    const admin = fakeAdmin({ waitlistTotal: 0, waitlist7d: 0, activeSubs: 0, proSubs: 0 }, {
      message: "db down",
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(gatherGrowthMetrics(admin as any)).rejects.toBeTruthy();
  });
});

function req(headers: Record<string, string>, ip = "1.2.3.4") {
  return new NextRequest("http://localhost/api/internal/growth-metrics", {
    headers: { "x-forwarded-for": ip, ...headers },
  });
}

describe("GET /api/internal/growth-metrics", () => {
  const orig = process.env.INTERNAL_METRICS_TOKEN;
  beforeEach(() => {
    mockGetAdmin.mockReset();
  });
  afterEach(() => {
    if (orig === undefined) delete process.env.INTERNAL_METRICS_TOKEN;
    else process.env.INTERNAL_METRICS_TOKEN = orig;
  });

  it("returns 503 when the token is not configured", async () => {
    delete process.env.INTERNAL_METRICS_TOKEN;
    const res = await GET(req({ authorization: "Bearer anything" }, "10.0.0.1"));
    expect(res.status).toBe(503);
  });

  it("returns 401 when the bearer token is wrong", async () => {
    process.env.INTERNAL_METRICS_TOKEN = "correct-secret-value";
    const res = await GET(req({ authorization: "Bearer wrong-secret-value" }, "10.0.0.2"));
    expect(res.status).toBe(401);
  });

  it("returns 401 when no Authorization header is present", async () => {
    process.env.INTERNAL_METRICS_TOKEN = "correct-secret-value";
    const res = await GET(req({}, "10.0.0.3"));
    expect(res.status).toBe(401);
  });

  it("returns 503 when the datastore is unavailable", async () => {
    process.env.INTERNAL_METRICS_TOKEN = "correct-secret-value";
    mockGetAdmin.mockReturnValue(null);
    const res = await GET(req({ authorization: "Bearer correct-secret-value" }, "10.0.0.4"));
    expect(res.status).toBe(503);
  });

  it("returns 200 with metrics for a valid token", async () => {
    process.env.INTERNAL_METRICS_TOKEN = "correct-secret-value";
    mockGetAdmin.mockReturnValue(
      fakeAdmin({ waitlistTotal: 11, waitlist7d: 2, activeSubs: 4, proSubs: 1 }),
    );
    const res = await GET(req({ authorization: "Bearer correct-secret-value" }, "10.0.0.5"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.funnel.waitlist_signups_total).toBe(11);
    expect(body.funnel.paid_pro_subscribers).toBe(1);
  });
});
