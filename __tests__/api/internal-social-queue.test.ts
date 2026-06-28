import { beforeEach, afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { NextRequest } from "next/server";

// Internal social publishing queue API (E7.3). Exercise the shared internal-auth
// model and the enqueue/flush control flow (validation, dedupe pass-through, the
// NaN/Infinity flush-limit guard). Data layer + platform check are mocked; the
// real token-compare is kept.
vi.mock("@/lib/supabase/admin", () => ({ getAdminClient: vi.fn() }));
vi.mock("@/lib/utils/rate-limiter", () => ({ checkRateLimit: vi.fn() }));
vi.mock("@/lib/social/queue", () => ({
  enqueuePost: vi.fn(),
  flushDueQueue: vi.fn(),
  getQueueStatus: vi.fn(),
}));
vi.mock("@/lib/social", () => ({
  isSocialPlatform: (p: unknown) => ["x", "instagram", "tiktok", "reddit"].includes(p as string),
}));

import { getAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit } from "@/lib/utils/rate-limiter";
import { enqueuePost, flushDueQueue, getQueueStatus } from "@/lib/social/queue";
import { GET, POST } from "@/app/api/internal/social-queue/route";

const mockGetAdmin = getAdminClient as unknown as Mock;
const mockRateLimit = checkRateLimit as unknown as Mock;
const mockEnqueue = enqueuePost as unknown as Mock;
const mockFlush = flushDueQueue as unknown as Mock;
const mockStatus = getQueueStatus as unknown as Mock;

const TOKEN = "test-internal-token";

function postReq(rawBody: string, token: string | undefined = TOKEN) {
  const headers: Record<string, string> = { "x-forwarded-for": "1.2.3.4", "content-type": "application/json" };
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  return new NextRequest("http://localhost/api/internal/social-queue", { method: "POST", headers, body: rawBody });
}
function getReq(token: string | undefined = TOKEN) {
  const headers: Record<string, string> = { "x-forwarded-for": "1.2.3.4" };
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  return new NextRequest("http://localhost/api/internal/social-queue", { headers });
}

beforeEach(() => {
  mockGetAdmin.mockReset();
  mockRateLimit.mockReset();
  mockEnqueue.mockReset();
  mockFlush.mockReset();
  mockStatus.mockReset();
  process.env.INTERNAL_METRICS_TOKEN = TOKEN;
  mockRateLimit.mockReturnValue({ allowed: true });
  mockGetAdmin.mockReturnValue({});
});
afterEach(() => {
  delete process.env.INTERNAL_METRICS_TOKEN;
  vi.restoreAllMocks();
});

describe("GET /api/internal/social-queue", () => {
  it("returns 503 when the token is not configured", async () => {
    delete process.env.INTERNAL_METRICS_TOKEN;
    const res = await GET(getReq());
    expect(res.status).toBe(503);
  });

  it("returns 401 on a wrong token", async () => {
    const res = await GET(getReq("nope"));
    expect(res.status).toBe(401);
  });

  it("returns queue status on a valid token", async () => {
    mockStatus.mockResolvedValue({ pending: 2, sent: 5 });
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: { pending: 2, sent: 5 } });
  });
});

describe("POST /api/internal/social-queue", () => {
  it("returns 401 on a wrong token (shared auth)", async () => {
    const res = await POST(postReq(JSON.stringify({ action: "flush" }), "nope"));
    expect(res.status).toBe(401);
  });

  it("returns 400 on malformed JSON", async () => {
    const res = await POST(postReq("{not json"));
    expect(res.status).toBe(400);
  });

  it("rejects an unknown platform on enqueue", async () => {
    const res = await POST(postReq(JSON.stringify({ action: "enqueue", platform: "myspace", body: "hi" })));
    expect(res.status).toBe(400);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("rejects a missing post body on enqueue", async () => {
    const res = await POST(postReq(JSON.stringify({ action: "enqueue", platform: "x" })));
    expect(res.status).toBe(400);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("enqueues a valid post and passes through dedupeKey + filtered media", async () => {
    mockEnqueue.mockResolvedValue({ ok: true, id: "q1" });
    const res = await POST(
      postReq(
        JSON.stringify({
          action: "enqueue",
          platform: "x",
          body: "launch post",
          mediaUrls: ["https://img/1.png", 42, "https://img/2.png"],
          dedupeKey: "launch-1",
        }),
      ),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, id: "q1" });
    const arg = mockEnqueue.mock.calls[0][1];
    expect(arg.platform).toBe("x");
    expect(arg.dedupeKey).toBe("launch-1");
    // Non-string media entries are filtered out before reaching the queue.
    expect(arg.mediaUrls).toEqual(["https://img/1.png", "https://img/2.png"]);
  });

  it("returns 400 when enqueue is rejected by the queue", async () => {
    mockEnqueue.mockResolvedValue({ ok: false, error: "body too long" });
    const res = await POST(postReq(JSON.stringify({ action: "enqueue", platform: "x", body: "x".repeat(99999) })));
    expect(res.status).toBe(400);
  });

  it("flushes with a finite limit", async () => {
    mockFlush.mockResolvedValue({ sent: 3, failed: 0 });
    const res = await POST(postReq(JSON.stringify({ action: "flush", limit: 10 })));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ summary: { sent: 3, failed: 0 } });
    expect(mockFlush.mock.calls[0][1]).toEqual({ limit: 10 });
  });

  it("guards a non-finite flush limit (passes undefined, not NaN/Infinity)", async () => {
    mockFlush.mockResolvedValue({ sent: 0, failed: 0 });
    // JSON has no Infinity literal; 1e500 parses to Infinity — the exact attack
    // the route's Number.isFinite guard exists to stop reaching Supabase .limit().
    const res = await POST(postReq('{"action":"flush","limit":1e500}'));
    expect(res.status).toBe(200);
    expect(mockFlush.mock.calls[0][1]).toEqual({ limit: undefined });
  });

  it("returns 400 on an unknown action", async () => {
    const res = await POST(postReq(JSON.stringify({ action: "explode" })));
    expect(res.status).toBe(400);
  });
});
