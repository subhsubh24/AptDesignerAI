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

    // The dev-mode branch had the same over-broad bounce as the real-auth one:
    // it keyed on PUBLIC_PATHS, so every marketing, legal and support page
    // redirected to /dashboard for a local developer too. Without these the
    // dev-mode half of the fix is untested and can silently regress.
    it.each(["/pricing", "/terms", "/privacy", "/faq", "/support", "/gallery"])(
      "lets the public page %s through instead of bouncing it to /dashboard",
      async (path) => {
        withoutSupabase();
        const res = await updateSession(req(path));
        expect(res.status).toBe(200);
        expect(locationOf(res)).toBeNull();
      },
    );
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

    it.each(["/pricing", "/gallery"])(
      "lets the public marketing page %s through (no redirect loop)",
      async (path) => {
        const res = await updateSession(req(path));
        expect(res.status).toBe(200);
        expect(locationOf(res)).toBeNull();
      },
    );

    // Account recovery is only reachable by someone who is signed OUT — that is
    // the entire population it serves. Before these were listed as public, both
    // pages redirected to /login, so a user who forgot their password was
    // permanently locked out no matter how correct the pages themselves were.
    it.each(["/forgot-password", "/reset-password"])(
      "lets the signed-out recovery page %s through instead of bouncing to /login",
      async (path) => {
        const res = await updateSession(req(path));
        expect(res.status).toBe(200);
        expect(locationOf(res)).toBeNull();
      },
    );

    it("lets /guides sub-routes through via the prefix match", async () => {
      const res = await updateSession(req("/guides/color-palette-guide"));
      expect(res.status).toBe(200);
    });

    // A share link's entire audience is people who are NOT signed in. While the
    // page route was missing from the public prefixes, every shared design
    // 307'd its recipient to /login — the /api/shared/* prefix below was public
    // but the page itself was not.
    it("lets a public /shared/<token> design link through for a logged-out recipient", async () => {
      const res = await updateSession(req("/shared/abc123token"));
      expect(res.status).toBe(200);
      expect(locationOf(res)).toBeNull();
    });

    it("does NOT treat a lookalike prefix (/sharedX) as public", async () => {
      const res = await updateSession(req("/sharedX"));
      expect(locationOf(res)).toBe("/login");
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

    it.each(["/login", "/signup", "/waitlist", "/waitlist/confirmed"])(
      "redirects a logged-in user away from the auth/waitlist page %s to /dashboard",
      async (path) => {
        const res = await updateSession(req(path));
        expect(locationOf(res)).toBe("/dashboard");
      },
    );

    // The bounce above used to key on "is this path public?", which swept up
    // every marketing, legal and support page too. That made /terms and
    // /privacy — linked from /billing/upgrade, where Apple 3.1.2 and Play both
    // require them at the point of purchase — unreachable for the only people
    // who ever see that page, and dead-ended the "See all plans" upgrade CTA.
    it.each([
      "/pricing",
      "/terms",
      "/privacy",
      "/faq",
      "/support",
      "/gallery",
      "/guides",
      "/guides/color-palette-guide",
    ])("lets a logged-in user actually reach the public page %s", async (path) => {
      const res = await updateSession(req(path));
      expect(res.status).toBe(200);
      expect(locationOf(res)).toBeNull();
    });

    // /reset-password mints a session as it redeems the emailed token, so a
    // bounce keyed on "has a session" would break the flow at the exact moment
    // it starts working.
    it.each(["/forgot-password", "/reset-password"])(
      "lets a logged-in user complete recovery at %s instead of bouncing them",
      async (path) => {
        const res = await updateSession(req(path));
        expect(res.status).toBe(200);
        expect(locationOf(res)).toBeNull();
      },
    );

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
