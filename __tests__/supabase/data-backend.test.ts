import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Verifies the DATA_BACKEND selector in lib/supabase/server.ts — the wiring for
// the persistent-data cutover. The default (memory) behavior must be UNCHANGED,
// and DATA_BACKEND=supabase must route data through the real client (persistent
// Postgres + runtime RLS) or fail loud when misconfigured. The actual Postgres
// round-trip is a human-verified cutover step (apply migrations, set the Supabase
// env vars, flip the flag, verify a cold start); this test locks the selection
// logic that gates it.

// A sentinel "real" Supabase client so we can tell it apart from the memory store.
// `user` is nullable on purpose: a signed-out request is a real case these
// tests exercise, and the mock must be able to represent it.
type GetUserResult = { data: { user: { id: string } | null } };
const realAuth = {
  getUser: vi.fn(async (): Promise<GetUserResult> => ({ data: { user: { id: "real-user" } } })),
};
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

// The fixed dev identity must never be handed out where requests are real.
// Doing so silently merges every unauthenticated visitor into ONE account: they
// read and write each other's saved_designs rows through it, and a real user's
// save can land under an identity they can never sign in as.
describe("getCurrentUserId — no fallback identity outside local dev", () => {
  const MOCK_ID = "00000000-0000-0000-0000-000000000001";

  beforeEach(() => {
    process.env[URL_KEY] = "https://x.supabase.co";
    process.env[ANON_KEY] = "anon-key";
  });

  it("returns null (not the mock id) for a signed-out request under DATA_BACKEND=supabase", async () => {
    process.env.DATA_BACKEND = "supabase";
    realAuth.getUser.mockResolvedValueOnce({ data: { user: null } });
    expect(await getCurrentUserId()).toBeNull();
  });

  /** try/finally so an unexpected throw can't leak NODE_ENV into later tests. */
  async function inProduction<T>(fn: () => Promise<T>): Promise<T> {
    const prev = process.env.NODE_ENV;
    // @ts-expect-error test override
    process.env.NODE_ENV = "production";
    try {
      return await fn();
    } finally {
      // @ts-expect-error restore
      process.env.NODE_ENV = prev;
    }
  }

  it("returns null (not the mock id) for a signed-out request in production", async () => {
    realAuth.getUser.mockResolvedValueOnce({ data: { user: null } });
    const id = await inProduction(() => getCurrentUserId());
    expect(id).toBeNull();
    expect(id).not.toBe(MOCK_ID);
  });

  it("returns null (not the mock id) when the auth call THROWS in production", async () => {
    realAuth.getUser.mockRejectedValueOnce(new Error("auth service unreachable"));
    expect(await inProduction(() => getCurrentUserId())).toBeNull();
  });

  it("returns null when the auth call THROWS under DATA_BACKEND=supabase", async () => {
    // Same branch reached by the other strict-identity entry point — an outage
    // must not degrade into the shared fallback identity there either.
    process.env.DATA_BACKEND = "supabase";
    realAuth.getUser.mockRejectedValueOnce(new Error("auth service unreachable"));
    expect(await getCurrentUserId()).toBeNull();
  });

  it("still falls back to the mock id in local dev, so nothing changes there", async () => {
    realAuth.getUser.mockResolvedValueOnce({ data: { user: null } });
    expect(await getCurrentUserId()).toBe(MOCK_ID);

    realAuth.getUser.mockRejectedValueOnce(new Error("offline"));
    expect(await getCurrentUserId()).toBe(MOCK_ID);
  });
});
