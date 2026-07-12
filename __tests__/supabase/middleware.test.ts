import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

// The auth-gating boundary in updateSession() decides, for every request,
// whether it is allowed through, redirected to /login, or 401'd. A bug in the
// public-path / public-API matching here can silently expose a protected route
// or lock out a public one, so it is worth exercising directly.

// Control what supabase.auth.getUser() returns per-test.
let userResult: { user: unknown } | "throw" = { user: null };
const getUser = vi.fn(async () => {
  if (userResult === "throw") throw new Error("supabase unreachable");
  return { data: userResult };
});

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({ auth: { getUser } })),
}));

import { updateSession } from "@/lib/supabase/middleware";

const SUPA_URL = "https://proj.supabase.co";
const SUPA_KEY = "anon-key";

function req(path: string, method = "GET"): NextRequest {
  return new NextRequest(new URL(`https://app.example.com${path}`), { method });
}

function locationOf(res: Response): string | null {
  const loc = res.headers.get("location");
  return loc ? new URL(loc).pathname : null;
}

describe("updateSession — auth-gating boundary", () => {
  const prevUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const prevKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const prevGate = process.env.SITE_GATE_PASSWORD;

  beforeEach(() => {
    userResult = { user: null };
    getUser.mockClear();
    // Site gate must be inert so we exercise the auth logic, not the gate.
    delete process.env.SITE_GATE_PASSWORD;
  });

  afterEach(() => {
    if (prevUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = prevUrl;
    if (prevKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = prevKey;
    if (prevGate === undefined) delete process.env.SITE_GATE_PASSWORD;
    else process.env.SITE_GATE_PASSWORD = prevGate;
  });

  function withSupabase() {
    process.env.NEXT_PUBLIC_SUPABASE_URL = SUPA_URL;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = SUPA_KEY;
  }

  function withoutSupabase() {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  }

  it("answers the CORS preflight (OPTIONS) for API routes with 204 before any auth", async () => {
    withSupabase();
    const res = await updateSession(req("/api/projects", "OPTIONS"));
    expect(res.status).toBe(204);
    expect(getUser).not.toHaveBeenCalled();
  });

  it("redirects the bare root to /dashboard", async () => {
    withSupabase();
    const res = await updateSession(req("/"));
    expect(res.status).toBe(307);
    expect(locationOf(res)).toBe("/dashboard");
  });

  describe("dev mode (no Supabase configured)", () => {
    it("redirects a public auth page to /dashboard", async () => {
      withoutSupabase();
      const res = await updateSession(req("/login"));
      expect(locationOf(res)).toBe("/dashboard");
      expect(getUser).not.toHaveBeenCalled();
    });

    it("lets a protected page through without auth", async () => {
      withoutSupabase();
      const res = await updateSession(req("/dashboard"));
      expect(res.status).toBe(200);
      expect(getUser).not.toHaveBeenCalled();
    });
  });

  describe("real auth, logged OUT", () => {
    beforeEach(withSupabase);

    it("redirects a protected page to /login", async () => {
      const res = await updateSession(req("/dashboard"));
      expect(locationOf(res)).toBe("/login");
    });

    it("401s a protected API route (JSON, not a redirect)", async () => {
      const res = await updateSession(req("/api/projects"));
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "Unauthorized" });
    });

    it("lets a public marketing page through (no redirect loop)", async () => {
      const res = await updateSession(req("/pricing"));
      expect(res.status).toBe(200);
      expect(locationOf(res)).toBeNull();
    });

    it("lets /guides sub-routes through via the prefix match", async () => {
      const res = await updateSession(req("/guides/color-palette-guide"));
      expect(res.status).toBe(200);
    });

    it("does NOT treat a lookalike prefix (/guidesX) as public", async () => {
      const res = await updateSession(req("/guidesX"));
      expect(locationOf(res)).toBe("/login");
    });

    it.each([
      "/api/shared/abc123",
      "/api/mobile/entitlements",
      "/api/internal/growth-metrics",
      "/api/billing/webhook",
      "/api/waitlist",
      "/api/auth/callback",
    ])("lets the public/bearer API path %s through unauthenticated", async (path) => {
      const res = await updateSession(req(path));
      expect(res.status).not.toBe(401);
    });

    it("treats a getUser() throw as unauthenticated instead of crashing", async () => {
      userResult = "throw";
      const res = await updateSession(req("/dashboard"));
      expect(locationOf(res)).toBe("/login");
    });
  });

  describe("real auth, logged IN", () => {
    beforeEach(() => {
      withSupabase();
      userResult = { user: { id: "u1" } };
    });

    it("redirects a logged-in user away from /login to /dashboard", async () => {
      const res = await updateSession(req("/login"));
      expect(locationOf(res)).toBe("/dashboard");
    });

    it("lets a logged-in user reach a protected page", async () => {
      const res = await updateSession(req("/dashboard"));
      expect(res.status).toBe(200);
      expect(locationOf(res)).toBeNull();
    });

    it("lets a logged-in user reach a protected API route", async () => {
      const res = await updateSession(req("/api/projects"));
      expect(res.status).not.toBe(401);
    });
  });
});
