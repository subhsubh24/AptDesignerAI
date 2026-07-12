import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { NextRequest } from "next/server";

// The public /api/shared/[token] endpoint is unauthenticated and addressable by
// a guessable-length token, so it is rate-limited per IP to slow enumeration.
// These tests assert the limiter is wired and keyed on the caller IP.
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { createClient } from "@/lib/supabase/server";
import { GET } from "@/app/api/shared/[token]/route";
import { RATE_LIMITS } from "@/lib/utils/rate-limiter";

const mockCreateClient = createClient as unknown as Mock;

/** Query stub whose maybeSingle resolves to `data` (null => 404). */
function clientReturning(data: unknown) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq"]) chain[m] = vi.fn().mockReturnValue(chain);
  chain.maybeSingle = vi.fn().mockResolvedValue({ data, error: null });
  return { from: vi.fn(() => chain) };
}

const TOKEN = "a".repeat(24);

function reqFrom(ip: string): NextRequest {
  return new NextRequest(new URL(`https://app.example.com/api/shared/${TOKEN}`), {
    headers: { "x-forwarded-for": ip },
  });
}

function call(ip: string) {
  return GET(reqFrom(ip), { params: Promise.resolve({ token: TOKEN }) });
}

beforeEach(() => {
  mockCreateClient.mockReset();
  mockCreateClient.mockResolvedValue(clientReturning(null));
});
afterEach(() => vi.restoreAllMocks());

describe("GET /api/shared/[token] — per-IP rate limiting", () => {
  it("allows requests within the limit (does not 429)", async () => {
    // A fresh IP's first request is always allowed; it falls through to the
    // lookup (404 here since the stub returns no row) — never 429.
    const res = await call("203.0.113.10");
    expect(res.status).not.toBe(429);
    expect(res.status).toBe(404);
  });

  it("429s once an IP exceeds the window, with a Retry-After header", async () => {
    const ip = "203.0.113.20";
    const max = RATE_LIMITS.sharedDesign.maxRequests;
    // Exhaust the window.
    for (let i = 0; i < max; i++) {
      const ok = await call(ip);
      expect(ok.status).not.toBe(429);
    }
    // The next request from the same IP is blocked.
    const blocked = await call(ip);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBeTruthy();
    expect(await blocked.json()).toEqual({ error: "Too many requests" });
  });

  it("keys the limit per IP — a different IP is unaffected by another's exhaustion", async () => {
    const busy = "203.0.113.30";
    const max = RATE_LIMITS.sharedDesign.maxRequests;
    for (let i = 0; i <= max; i++) await call(busy); // push busy over the limit
    expect((await call(busy)).status).toBe(429);
    // A separate IP still gets through.
    expect((await call("203.0.113.31")).status).not.toBe(429);
  });
});
