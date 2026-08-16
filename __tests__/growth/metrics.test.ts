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
  annualSubs: number;
  cancelledSubs: number;
  cancelled30d: number;
  active30dAgo: number;
}

// Minimal Supabase-shaped fake: each query is a thenable that resolves to a
// { count, error } based on the table and which filters were applied.
function fakeAdmin(counts: Counts, error: unknown = null) {
  return {
    from(table: string) {
      const state = {
        table,
        gteCol: null as string | null,
        lteCol: null as string | null,
        orFilter: null as string | null,
        annualTier: false,
        status: null as string | null,
      };
      const builder = {
        select: () => builder,
        gte: (col: string) => {
          state.gteCol = col;
          return builder;
        },
        lte: (col: string) => {
          state.lteCol = col;
          return builder;
        },
        or: (filter: string) => {
          state.orFilter = filter;
          return builder;
        },
        in: () => builder, // .in("tier", ["pro","pro_annual"]) — the multi-tier path
        eq: (col: string, val: string) => {
          if (col === "tier" && val === "pro_annual") state.annualTier = true;
          if (col === "status") state.status = val;
          return builder;
        },
        then(resolve: (v: { count: number | null; error: unknown }) => unknown) {
          let count = 0;
          if (state.table === "waitlist_emails") {
            count = state.gteCol === "created_at" ? counts.waitlist7d : counts.waitlistTotal;
          } else if (state.table === "stripe_customers") {
            if (state.orFilter) {
              // The active_30d_ago denominator query — created_at.lte + the
              // active-or-recently-cancelled .or() filter, no .eq("status", ...).
              count = counts.active30dAgo;
            } else if (state.status === "active") {
              count = state.annualTier ? counts.annualSubs : counts.activeSubs;
            } else if (state.status === "cancelled") {
              // The 30d query adds a gte on updated_at; the lifetime one doesn't.
              count = state.gteCol === "updated_at" ? counts.cancelled30d : counts.cancelledSubs;
            } else {
              // A dropped status filter surfaces every row (+100) and trips the
              // assertions, so the test actually guards that the filter is applied.
              count = (state.annualTier ? counts.annualSubs : counts.activeSubs) + 100;
            }
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
    const admin = fakeAdmin({
      waitlistTotal: 42,
      waitlist7d: 7,
      activeSubs: 5,
      annualSubs: 2,
      cancelledSubs: 9,
      cancelled30d: 3,
      active30dAgo: 30,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = await gatherGrowthMetrics(admin as any);
    expect(m.source).toBe("supabase");
    expect(m.funnel).toEqual({
      waitlist_signups_total: 42,
      waitlist_signups_7d: 7,
      active_subscribers: 5,
      annual_subscribers: 2,
      cancelled_subscribers: 9,
      cancelled_30d: 3,
      churn_rate_30d: 0.1, // 3 / 30
    });
    expect(typeof m.as_of).toBe("string");
  });

  it("returns churn_rate_30d as null when nobody was active 30 days ago (no denominator)", async () => {
    const admin = fakeAdmin({
      waitlistTotal: 0,
      waitlist7d: 0,
      activeSubs: 0,
      annualSubs: 0,
      cancelledSubs: 0,
      cancelled30d: 0,
      active30dAgo: 0,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = await gatherGrowthMetrics(admin as any);
    expect(m.funnel.churn_rate_30d).toBeNull();
  });

  it("throws when an underlying query errors", async () => {
    const admin = fakeAdmin(
      { waitlistTotal: 0, waitlist7d: 0, activeSubs: 0, annualSubs: 0, cancelledSubs: 0, cancelled30d: 0, active30dAgo: 0 },
      { message: "db down" },
    );
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
      fakeAdmin({
        waitlistTotal: 11,
        waitlist7d: 2,
        activeSubs: 4,
        annualSubs: 1,
        cancelledSubs: 6,
        cancelled30d: 2,
        active30dAgo: 20,
      }),
    );
    const res = await GET(req({ authorization: "Bearer correct-secret-value" }, "10.0.0.5"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.funnel.waitlist_signups_total).toBe(11);
    expect(body.funnel.active_subscribers).toBe(4);
    expect(body.funnel.annual_subscribers).toBe(1);
    expect(body.funnel.cancelled_subscribers).toBe(6);
    expect(body.funnel.cancelled_30d).toBe(2);
    expect(body.funnel.churn_rate_30d).toBe(0.1); // 2 / 20
  });

  it("rate-limits after the per-IP window is exceeded (429)", async () => {
    process.env.INTERNAL_METRICS_TOKEN = "correct-secret-value";
    mockGetAdmin.mockReturnValue(
      fakeAdmin({
        waitlistTotal: 1,
        waitlist7d: 0,
        activeSubs: 0,
        annualSubs: 0,
        cancelledSubs: 0,
        cancelled30d: 0,
        active30dAgo: 0,
      }),
    );
    const ip = "10.9.9.9";
    // Limit is 30/min/IP. Exhaust it, then expect a 429 on the next call.
    let last = 200;
    for (let i = 0; i < 31; i++) {
      const res = await GET(req({ authorization: "Bearer correct-secret-value" }, ip));
      last = res.status;
    }
    expect(last).toBe(429);
  });
});
