import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Verifies the DATA_BACKEND selector in lib/supabase/server.ts — the wiring for
// the persistent-data cutover. The default (memory) behavior must be UNCHANGED,
// and DATA_BACKEND=supabase must route data through the real client (persistent
// Postgres + runtime RLS) or fail loud when misconfigured. The actual Postgres
// round-trip is a human-verified cutover step (apply migrations, set the Supabase
// env vars, flip the flag, verify a cold start); this test locks the selection
// logic that gates it.

// A sentinel "real" Supabase client so we can tell it apart from the memory store.
const realAuth = { getUser: vi.fn(async () => ({ data: { user: { id: "real-user" } } })) };
const realClient = {
  __real: true as const,
  auth: realAuth,
  from: () => "REAL_FROM",
  storage: { __real: true },
  rpc: () => "REAL_RPC",
};

vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => realClient),
}));

import { createClient, getCurrentUserId } from "@/lib/supabase/server";

const URL_KEY = "NEXT_PUBLIC_SUPABASE_URL";
const ANON_KEY = "NEXT_PUBLIC_SUPABASE_ANON_KEY";

function clearEnv() {
  delete process.env.DATA_BACKEND;
  delete process.env[URL_KEY];
  delete process.env[ANON_KEY];
}

beforeEach(() => {
  realAuth.getUser.mockClear();
  clearEnv();
});
afterEach(() => clearEnv());

describe("createClient — data backend selection", () => {
  it("default (no flag, no creds): returns the in-memory store for data", async () => {
    const client = await createClient();
    // Memory store's .from returns a QueryBuilder, not the real client.
    expect((client as { __real?: boolean }).__real).toBeUndefined();
    expect(client.from("rooms").constructor.name).toBe("QueryBuilder");
  });

  it("default hybrid (no flag, creds present): memory data + real auth", async () => {
    process.env[URL_KEY] = "https://x.supabase.co";
    process.env[ANON_KEY] = "anon-key";

    const client = await createClient();
    // Data still hits the memory store...
    expect(client.from("rooms").constructor.name).toBe("QueryBuilder");
    // ...but auth is the real Supabase auth (proxied on top).
    expect(client.auth).toBe(realAuth);
  });

  it("DATA_BACKEND=supabase + creds: routes ALL data through the real client", async () => {
    process.env.DATA_BACKEND = "supabase";
    process.env[URL_KEY] = "https://x.supabase.co";
    process.env[ANON_KEY] = "anon-key";

    const client = await createClient();
    expect((client as { __real?: boolean }).__real).toBe(true);
    expect(client.from("rooms")).toBe("REAL_FROM");
    expect(client.auth).toBe(realAuth);
  });

  it("DATA_BACKEND=supabase without creds: FAILS LOUD (no silent memory fallback)", async () => {
    process.env.DATA_BACKEND = "supabase";
    await expect(createClient()).rejects.toThrow(/DATA_BACKEND=supabase requires/);
  });
});

describe("getCurrentUserId", () => {
  it("returns the real user id when creds are present", async () => {
    process.env[URL_KEY] = "https://x.supabase.co";
    process.env[ANON_KEY] = "anon-key";
    expect(await getCurrentUserId()).toBe("real-user");
  });

  it("FAILS LOUD when DATA_BACKEND=supabase but creds are missing (no mock-user fallback)", async () => {
    process.env.DATA_BACKEND = "supabase";
    await expect(getCurrentUserId()).rejects.toThrow(/DATA_BACKEND=supabase requires/);
  });

  it("falls back to the mock id in local dev (no creds, not production)", async () => {
    const prev = process.env.NODE_ENV;
    // @ts-expect-error test override
    process.env.NODE_ENV = "test";
    expect(await getCurrentUserId()).toBe("00000000-0000-0000-0000-000000000001");
    // @ts-expect-error restore
    process.env.NODE_ENV = prev;
  });
});
