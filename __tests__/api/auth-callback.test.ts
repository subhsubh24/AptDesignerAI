import { beforeEach, afterEach, describe, expect, it, vi, type Mock } from "vitest";

// Guards the OAuth callback route: it exchanges the `code` for a session and
// (a) redirects to the requested internal `next` on success, (b) constrains
// `next` to a known allow-list (no open redirect), and — the hardening this
// suite locks in — (c) NEVER surfaces a transient Supabase/network failure as
// an uncaught 500: a throw from createClient()/exchangeCodeForSession() must
// degrade to the graceful /login?error=auth redirect, same as a returned error.
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { createClient } from "@/lib/supabase/server";
import { GET } from "@/app/api/auth/callback/route";

const mockCreateClient = createClient as unknown as Mock;
const ORIGIN = "https://app.example.com";

function req(params: Record<string, string>) {
  const url = new URL(`${ORIGIN}/api/auth/callback`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Request(url.toString());
}

function locationOf(res: Response) {
  return res.headers.get("location");
}

beforeEach(() => mockCreateClient.mockReset());
afterEach(() => vi.restoreAllMocks());

describe("GET /api/auth/callback", () => {
  it("redirects to the requested internal next on a successful exchange", async () => {
    mockCreateClient.mockResolvedValue({
      auth: { exchangeCodeForSession: async () => ({ error: null }) },
    });
    const res = await GET(req({ code: "abc", next: "/settings" }));
    expect(res.status).toBe(307);
    expect(locationOf(res)).toBe(`${ORIGIN}/settings`);
  });

  it("clamps an unknown next to /dashboard (no open redirect)", async () => {
    mockCreateClient.mockResolvedValue({
      auth: { exchangeCodeForSession: async () => ({ error: null }) },
    });
    const res = await GET(req({ code: "abc", next: "https://evil.test/phish" }));
    expect(locationOf(res)).toBe(`${ORIGIN}/dashboard`);
  });

  it("redirects to /login?error=auth when the exchange returns an error", async () => {
    mockCreateClient.mockResolvedValue({
      auth: { exchangeCodeForSession: async () => ({ error: { message: "bad code" } }) },
    });
    const res = await GET(req({ code: "abc", next: "/dashboard" }));
    expect(locationOf(res)).toBe(`${ORIGIN}/login?error=auth`);
  });

  it("degrades to /login?error=auth when exchangeCodeForSession THROWS (no uncaught 500)", async () => {
    mockCreateClient.mockResolvedValue({
      auth: {
        exchangeCodeForSession: async () => {
          throw new Error("network unreachable");
        },
      },
    });
    // Must resolve, not reject — a throw here previously escaped as a 500.
    const res = await GET(req({ code: "abc", next: "/dashboard" }));
    expect(locationOf(res)).toBe(`${ORIGIN}/login?error=auth`);
  });

  it("redirects to /login?error=auth when no code is present", async () => {
    const res = await GET(req({}));
    expect(locationOf(res)).toBe(`${ORIGIN}/login?error=auth`);
    expect(mockCreateClient).not.toHaveBeenCalled();
  });
});
