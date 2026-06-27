import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/supabase/admin", () => ({ getAdminClient: vi.fn() }));

import { getAdminClient } from "@/lib/supabase/admin";
import {
  isSocialDryRun,
  isSocialPlatform,
  publishPost,
  PLATFORM_MAX_BODY,
} from "@/lib/social";
import { GET, POST } from "@/app/api/internal/social-queue/route";

const mockGetAdmin = getAdminClient as unknown as Mock;

describe("lib/social provider abstraction", () => {
  const orig = { ...process.env };
  afterEach(() => {
    process.env = { ...orig };
  });

  it("is dry-run for every platform when no credentials are set", () => {
    delete process.env.X_API_KEY;
    delete process.env.GROWTH_SOCIAL_DRY_RUN;
    expect(isSocialDryRun("x")).toBe(true);
    expect(isSocialDryRun("reddit")).toBe(true);
  });

  it("force flag keeps dry-run even when a credential is present", () => {
    process.env.X_API_KEY = "key";
    process.env.GROWTH_SOCIAL_DRY_RUN = "1";
    expect(isSocialDryRun("x")).toBe(true);
  });

  it("isSocialPlatform guards unknown values", () => {
    expect(isSocialPlatform("x")).toBe(true);
    expect(isSocialPlatform("facebook")).toBe(false);
    expect(isSocialPlatform(42)).toBe(false);
  });

  it("publishPost returns dryRun for a valid post and never sends", async () => {
    const res = await publishPost({ platform: "x", body: "hello world" });
    expect(res.dryRun).toBe(true);
    expect(res.published).toBe(false);
  });

  it("publishPost rejects an empty body and an over-length body without a provider run", async () => {
    const empty = await publishPost({ platform: "x", body: "   " });
    expect(empty.error).toBeTruthy();
    expect(empty.dryRun).toBe(false);

    const tooLong = await publishPost({ platform: "x", body: "a".repeat(PLATFORM_MAX_BODY.x + 1) });
    expect(tooLong.error).toBeTruthy();
  });
});

// Minimal admin fake: tracks enqueue insert + status counts.
function fakeAdmin(opts: { insertId?: string; insertError?: { code?: string } } = {}) {
  return {
    from() {
      const builder: Record<string, unknown> = {};
      Object.assign(builder, {
        insert: () => builder,
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        or: () => builder,
        limit: () => Promise.resolve({ data: [], error: null }),
        update: () => builder,
        maybeSingle: () =>
          Promise.resolve(
            opts.insertError
              ? { data: null, error: opts.insertError }
              : { data: { id: opts.insertId ?? "post-1" }, error: null },
          ),
        then: (resolve: (v: unknown) => unknown) =>
          // Status-count head queries resolve to { count }.
          Promise.resolve({ count: 0, error: null }).then(resolve),
      });
      return builder;
    },
  };
}

function req(method: "GET" | "POST", token: string, jsonBody?: unknown, ip = "7.7.7.7") {
  return new NextRequest("http://localhost/api/internal/social-queue", {
    method,
    headers: {
      "x-forwarded-for": ip,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: jsonBody === undefined ? undefined : JSON.stringify(jsonBody),
  });
}

describe("/api/internal/social-queue", () => {
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
    const res = await GET(req("GET", "anything", undefined, "8.0.0.1"));
    expect(res.status).toBe(503);
  });

  it("returns 401 for a wrong bearer token", async () => {
    process.env.INTERNAL_METRICS_TOKEN = "correct-secret-value";
    const res = await GET(req("GET", "wrong-secret-value", undefined, "8.0.0.2"));
    expect(res.status).toBe(401);
  });

  it("GET returns queue status for a valid token", async () => {
    process.env.INTERNAL_METRICS_TOKEN = "correct-secret-value";
    mockGetAdmin.mockReturnValue(fakeAdmin());
    const res = await GET(req("GET", "correct-secret-value", undefined, "8.0.0.3"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toMatchObject({ pending: 0, published: 0, failed: 0 });
  });

  it("POST enqueue rejects an unknown platform with 400", async () => {
    process.env.INTERNAL_METRICS_TOKEN = "correct-secret-value";
    mockGetAdmin.mockReturnValue(fakeAdmin());
    const res = await POST(
      req("POST", "correct-secret-value", { action: "enqueue", platform: "myspace", body: "hi" }, "8.0.0.4"),
    );
    expect(res.status).toBe(400);
  });

  it("POST enqueue stores a valid draft and returns its id", async () => {
    process.env.INTERNAL_METRICS_TOKEN = "correct-secret-value";
    mockGetAdmin.mockReturnValue(fakeAdmin({ insertId: "post-42" }));
    const res = await POST(
      req("POST", "correct-secret-value", { action: "enqueue", platform: "x", body: "Launch soon!" }, "8.0.0.5"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.id).toBe("post-42");
  });

  it("POST with an unknown action returns 400", async () => {
    process.env.INTERNAL_METRICS_TOKEN = "correct-secret-value";
    mockGetAdmin.mockReturnValue(fakeAdmin());
    const res = await POST(
      req("POST", "correct-secret-value", { action: "explode" }, "8.0.0.6"),
    );
    expect(res.status).toBe(400);
  });
});
