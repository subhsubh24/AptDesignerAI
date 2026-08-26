import { beforeEach, afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";

/**
 * The receiver for the Expo push token mobile/src/hooks/use-push-notifications.ts
 * collects on-device (APT-67). Previously untested (the endpoint didn't
 * exist). Pins: Bearer-token auth like the other /api/mobile/* routes, the
 * user id always comes from the validated JWT (never the request body), and
 * a bad/oversized token body is rejected before any DB write.
 */
vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/utils/rate-limiter", () => ({
  checkRateLimit: vi.fn(),
  RATE_LIMITS: { mobilePushTokenRegister: { maxRequests: 10, windowMs: 60_000 } },
}));

import { createClient } from "@supabase/supabase-js";
import { checkRateLimit } from "@/lib/utils/rate-limiter";
import { POST } from "@/app/api/mobile/push-tokens/route";

const mockCreateClient = createClient as unknown as Mock;
const mockRateLimit = checkRateLimit as unknown as Mock;

function req(body: unknown, token: string | null = "tok") {
  return new NextRequest("http://localhost/api/mobile/push-tokens", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

/** First createClient() call = JWT-validating anon client. */
function tokenResolvesTo(user: { id: string } | null) {
  mockCreateClient.mockReturnValueOnce({
    auth: { getUser: async () => ({ data: { user }, error: user ? null : { message: "bad jwt" } }) },
  });
}

/** Second createClient() call = the RLS-scoped authed client used for the upsert. */
function upsertResolvesTo(error: { message: string } | null) {
  const upsert = vi.fn(
    async (
      _row: { user_id: string; token: string; platform: string | null; updated_at: string },
      _opts: { onConflict: string },
    ) => ({ error }),
  );
  mockCreateClient.mockReturnValueOnce({ from: vi.fn(() => ({ upsert })) });
  return upsert;
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  mockCreateClient.mockReset();
  mockRateLimit.mockReset();
  mockRateLimit.mockReturnValue({ allowed: true });
});
afterEach(() => vi.restoreAllMocks());

describe("POST /api/mobile/push-tokens", () => {
  it("returns 401 without a Bearer token and never touches the DB", async () => {
    const res = await POST(req({ token: "ExponentPushToken[abc]" }, null));
    expect(res.status).toBe(401);
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it("returns 401 when the token does not resolve to a user", async () => {
    tokenResolvesTo(null);
    const res = await POST(req({ token: "ExponentPushToken[abc]" }));
    expect(res.status).toBe(401);
  });

  it("returns 429 when rate limited, before any DB write", async () => {
    tokenResolvesTo({ id: "u1" });
    mockRateLimit.mockReturnValue({ allowed: false, retryAfterMs: 60_000 });
    const res = await POST(req({ token: "ExponentPushToken[abc]" }));
    expect(res.status).toBe(429);
  });

  it("rejects a missing/non-string token before any DB write", async () => {
    tokenResolvesTo({ id: "u1" });
    const res = await POST(req({}));
    expect(res.status).toBe(400);
  });

  it("rejects an oversized token", async () => {
    tokenResolvesTo({ id: "u1" });
    const res = await POST(req({ token: "x".repeat(600) }));
    expect(res.status).toBe(400);
  });

  it("rejects an invalid platform value", async () => {
    tokenResolvesTo({ id: "u1" });
    const res = await POST(req({ token: "ExponentPushToken[abc]", platform: "windows" }));
    expect(res.status).toBe(400);
  });

  it("upserts on the JWT-derived user id (never a client-supplied id), keyed on the (user_id, token) pair", async () => {
    tokenResolvesTo({ id: "u1" });
    const upsert = upsertResolvesTo(null);

    const res = await POST(req({ token: "ExponentPushToken[abc]", platform: "ios", user_id: "attacker" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(upsert).toHaveBeenCalledTimes(1);
    const [row, opts] = upsert.mock.calls[0];
    expect(row.user_id).toBe("u1");
    expect(row.token).toBe("ExponentPushToken[abc]");
    expect(row.platform).toBe("ios");
    // NOT onConflict: "token" alone — a table-wide unique(token) would
    // conflict with the RLS policy when a second user registers the same
    // physical-device token after the first user logs out (shared/family
    // device). See supabase/migrations/034_push_tokens.sql for the full
    // reasoning; this pins the fix so it can't silently regress.
    expect(opts).toEqual({ onConflict: "user_id,token" });
  });

  it("returns 500 on a DB upsert error, without leaking the raw error message", async () => {
    tokenResolvesTo({ id: "u1" });
    upsertResolvesTo({ message: "duplicate key value violates constraint xyz" });

    const res = await POST(req({ token: "ExponentPushToken[abc]" }));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain("constraint xyz");
  });

  it("migration keeps the composite (user_id, token) unique key, not a table-wide unique(token)", () => {
    // Pins the shared-device fix at the schema level too — a well-meaning
    // future "simplify the constraint" edit to the migration would otherwise
    // silently reintroduce the RLS-vs-uniqueness conflict this route's own
    // onConflict depends on.
    const sql = fs.readFileSync(
      path.join(process.cwd(), "supabase/migrations/034_push_tokens.sql"),
      "utf8",
    );
    expect(sql).toMatch(/unique\s*\(\s*user_id\s*,\s*token\s*\)/i);
    expect(sql).not.toMatch(/token\s+text\s+not\s+null\s+unique\b/i);
  });
});
