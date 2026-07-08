import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertServiceRoleKey } from "@/lib/supabase/admin";

// The admin client memoizes a module-level singleton and reads env at call time,
// so each test imports the module FRESH after arranging env. We re-register the
// @supabase/supabase-js mock with vi.doMock() AFTER vi.resetModules() inside the
// loader — doMock is NOT hoisted, so it applies to the very next dynamic import,
// guaranteeing the freshly-imported admin module binds to OUR createClient mock
// (a real network client is never constructed).

const createClientMock = vi.fn((..._args: unknown[]) => ({ __isClient: true }));

const ENV_URL = "NEXT_PUBLIC_SUPABASE_URL";
const ENV_KEY = "SUPABASE_SERVICE_ROLE_KEY";

async function loadFresh() {
  vi.resetModules();
  vi.doMock("@supabase/supabase-js", () => ({
    createClient: (...args: unknown[]) => createClientMock(...args),
  }));
  return import("@/lib/supabase/admin");
}

describe("getAdminClient", () => {
  const orig = { url: process.env[ENV_URL], key: process.env[ENV_KEY] };

  beforeEach(() => {
    createClientMock.mockClear();
  });

  afterEach(() => {
    if (orig.url === undefined) delete process.env[ENV_URL];
    else process.env[ENV_URL] = orig.url;
    if (orig.key === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = orig.key;
  });

  it("returns null when the URL is absent (graceful degradation)", async () => {
    delete process.env[ENV_URL];
    process.env[ENV_KEY] = "service-role-key";
    const { getAdminClient } = await loadFresh();
    expect(getAdminClient()).toBeNull();
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("returns null when the service-role key is absent", async () => {
    process.env[ENV_URL] = "https://proj.supabase.co";
    delete process.env[ENV_KEY];
    const { getAdminClient } = await loadFresh();
    expect(getAdminClient()).toBeNull();
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("constructs a client with session persistence OFF when both env vars are present", async () => {
    process.env[ENV_URL] = "https://proj.supabase.co";
    process.env[ENV_KEY] = "service-role-key";
    const { getAdminClient } = await loadFresh();
    const client = getAdminClient();
    expect(client).not.toBeNull();
    expect(createClientMock).toHaveBeenCalledTimes(1);
    const [url, key, opts] = createClientMock.mock.calls[0] as unknown as [string, string, { auth: { persistSession: boolean; autoRefreshToken: boolean } }];
    expect(url).toBe("https://proj.supabase.co");
    expect(key).toBe("service-role-key");
    // A server-only client must not persist or refresh sessions.
    expect(opts.auth.persistSession).toBe(false);
    expect(opts.auth.autoRefreshToken).toBe(false);
  });

  it("memoizes the client across calls (createClient runs once)", async () => {
    process.env[ENV_URL] = "https://proj.supabase.co";
    process.env[ENV_KEY] = "service-role-key";
    const { getAdminClient } = await loadFresh();
    const a = getAdminClient();
    const b = getAdminClient();
    expect(a).toBe(b);
    expect(createClientMock).toHaveBeenCalledTimes(1);
  });

  it("throws in a browser context so the service-role key can never reach the client", async () => {
    process.env[ENV_URL] = "https://proj.supabase.co";
    process.env[ENV_KEY] = "service-role-key";
    const { getAdminClient } = await loadFresh();
    vi.stubGlobal("window", {});
    try {
      expect(() => getAdminClient()).toThrow(/browser context/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

// Build a legacy-format Supabase JWT ("header.payload.signature") whose payload
// carries the given `role` claim. The signature is never verified — assertion
// only decodes the payload — so a dummy signature segment is sufficient.
function jwtWithRole(role: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ role, iss: "supabase" })).toString("base64url");
  return `${header}.${payload}.dummy-signature`;
}

// The §28/§32 fail-loud guard: a present-but-WRONG SUPABASE_SERVICE_ROLE_KEY
// (the anon key pasted in, or a publishable key) constructs a client fine but
// makes every admin call fail with a cryptic "User not allowed" — which once
// fully blocked signup in prod. assertServiceRoleKey rejects such a key at
// construction with an actionable message. These tests lock that contract so a
// refactor can never silently reopen the hole.
describe("assertServiceRoleKey", () => {
  it("rejects an anon-role JWT (the classic wrong-key paste)", () => {
    expect(() => assertServiceRoleKey(jwtWithRole("anon"))).toThrow(/"anon"/);
    // The message must be actionable — name the fix, not just "invalid".
    expect(() => assertServiceRoleKey(jwtWithRole("anon"))).toThrow(/service_role/);
  });

  it("rejects any non-service_role JWT (e.g. authenticated)", () => {
    expect(() => assertServiceRoleKey(jwtWithRole("authenticated"))).toThrow(/"authenticated"/);
  });

  it("accepts a genuine service_role JWT", () => {
    expect(() => assertServiceRoleKey(jwtWithRole("service_role"))).not.toThrow();
  });

  it("rejects a publishable (sb_publishable_…) key", () => {
    expect(() => assertServiceRoleKey("sb_publishable_abc123")).toThrow(/publishable/);
  });

  it("accepts the newer sb_secret_… secret-key format (not a decodable JWT, not publishable)", () => {
    // jwtRole() returns null for the non-JWT sb_secret_ format, and it is not a
    // publishable key — so the guard must let it through to the runtime client.
    expect(() => assertServiceRoleKey("sb_secret_abc123")).not.toThrow();
  });

  it("accepts an opaque non-JWT key (unknown format falls through, not a false reject)", () => {
    // The guard only rejects keys it can PROVE are wrong; an undecodable key is
    // allowed through rather than blocking a valid but unrecognized format.
    expect(() => assertServiceRoleKey("service-role-key")).not.toThrow();
  });

  it("does not throw on a malformed three-segment token whose payload isn't valid base64 JSON", () => {
    // jwtRole() catches the decode failure and returns null → no false reject.
    expect(() => assertServiceRoleKey("a.b.c")).not.toThrow();
  });
});
