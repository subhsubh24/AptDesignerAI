import { beforeEach, afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { NextRequest } from "next/server";

// Internal funnel-metrics read API. Exercise its auth model (closed-by-default
// 503, IP rate limit, Bearer-token gate, admin availability) and the success/
// error paths. The real token-compare (HMAC + timingSafeEqual) is kept; only the
// rate limiter and data layer are mocked.
vi.mock("@/lib/supabase/admin", () => ({ getAdminClient: vi.fn() }));
vi.mock("@/lib/growth/metrics", () => ({ gatherGrowthMetrics: vi.fn() }));
vi.mock("@/lib/utils/rate-limiter", () => ({ checkRateLimit: vi.fn() }));

import { getAdminClient } from "@/lib/supabase/admin";
import { gatherGrowthMetrics } from "@/lib/growth/metrics";
import { checkRateLimit } from "@/lib/utils/rate-limiter";
import { GET } from "@/app/api/internal/growth-metrics/route";

const mockGetAdmin = getAdminClient as unknown as Mock;
const mockGather = gatherGrowthMetrics as unknown as Mock;
const mockRateLimit = checkRateLimit as unknown as Mock;

const TOKEN = "test-internal-token";

function req(token?: string) {
  const headers: Record<string, string> = { "x-forwarded-for": "1.2.3.4" };
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  return new NextRequest("http://localhost/api/internal/growth-metrics", { headers });
}

beforeEach(() => {
  mockGetAdmin.mockReset();
  mockGather.mockReset();
  mockRateLimit.mockReset();
  process.env.INTERNAL_METRICS_TOKEN = TOKEN;
  mockRateLimit.mockReturnValue({ allowed: true });
  mockGetAdmin.mockReturnValue({});
});
afterEach(() => {
  delete process.env.INTERNAL_METRICS_TOKEN;
  vi.restoreAllMocks();
});

describe("GET /api/internal/growth-metrics", () => {
  it("returns 503 (closed by default) when the token is not configured", async () => {
    delete process.env.INTERNAL_METRICS_TOKEN;
    const res = await GET(req(TOKEN));
    expect(res.status).toBe(503);
    expect(mockRateLimit).not.toHaveBeenCalled();
  });

  it("returns 429 when rate limited (before any token check)", async () => {
    mockRateLimit.mockReturnValue({ allowed: false, retryAfterMs: 60_000 });
    const res = await GET(req(TOKEN));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
  });

  it("returns 401 when the Authorization header is missing", async () => {
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(mockGather).not.toHaveBeenCalled();
  });

  it("returns 401 on a wrong token", async () => {
    const res = await GET(req("wrong-token"));
    expect(res.status).toBe(401);
    expect(mockGather).not.toHaveBeenCalled();
  });

  it("returns 503 when the admin datastore is unavailable", async () => {
    mockGetAdmin.mockReturnValue(null);
    const res = await GET(req(TOKEN));
    expect(res.status).toBe(503);
  });

  it("returns the metrics on a valid token", async () => {
    mockGather.mockResolvedValue({ waitlist_total: 42, active_subscribers: 3 });
    const res = await GET(req(TOKEN));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ waitlist_total: 42, active_subscribers: 3 });
  });

  it("returns a generic 500 when gathering metrics throws (no raw error leak)", async () => {
    mockGather.mockRejectedValue(new Error("relation stripe_customers does not exist"));
    const res = await GET(req(TOKEN));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Failed to gather metrics.");
    expect(JSON.stringify(body)).not.toContain("stripe_customers");
  });
});
