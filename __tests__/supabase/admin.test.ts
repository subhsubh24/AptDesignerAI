import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
