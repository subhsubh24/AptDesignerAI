import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The share-link read path (issue #708).
 *
 * Migration 020 tried to make the share token a database-level credential with
 * `USING (is_public = true AND share_token IS NOT NULL)`. A Postgres USING
 * clause is evaluated per row against ROW DATA and cannot require the caller's
 * WHERE filter, so anon — holding the browser-shipped
 * NEXT_PUBLIC_SUPABASE_ANON_KEY — could read EVERY shared design straight off
 * PostgREST. Migration 030 drops that policy; this module is what replaces it.
 *
 * These tests pin the properties the policy cannot express, so a future edit
 * that reintroduces the hole fails here rather than in production:
 *  - under DATA_BACKEND=supabase the read uses the SERVICE-ROLE client (anon
 *    now has no policy, so the anon client would return 0 rows for every valid
 *    link — a silently dead share feature);
 *  - BOTH `share_token` and `is_public` are always bound;
 *  - the credential (`share_token`) and the owner (`user_id`) never appear in
 *    the selected columns;
 *  - a short/absent token never reaches the database.
 */

// vi.hoisted: the vi.mock factories below are lifted above these declarations,
// so the spies have to be created in the hoisted scope to be referenceable.
const { getAdminClient, createClient } = vi.hoisted(() => ({
  getAdminClient: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ getAdminClient }));
vi.mock("@/lib/supabase/server", () => ({
  createClient,
  // Read the env var at call time so each test can pick the backend.
  supabaseDataBackendEnabled: () => process.env.DATA_BACKEND === "supabase",
}));

import {
  MIN_SHARE_TOKEN_LENGTH,
  isWellFormedShareToken,
  readSharedDesignByToken,
} from "@/lib/supabase/public-share";

const TOKEN = "a".repeat(32);

const ROW = {
  id: "design-1",
  title: "Warm living room",
  room_type: "living_room",
  stage: "full",
  thumbnail_url: null,
  snapshot: { assessment: {} },
  created_at: "2026-01-01T00:00:00.000Z",
};

/**
 * Records the filters a caller applied so a test can assert on them. `select`
 * captures the requested column list; `eq` captures every bound predicate.
 */
function recordingClient(data: unknown) {
  const calls = { columns: "" as string, eq: [] as Array<[string, unknown]> };
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn((cols: string) => {
    calls.columns = cols;
    return chain;
  });
  chain.eq = vi.fn((col: string, val: unknown) => {
    calls.eq.push([col, val]);
    return chain;
  });
  chain.maybeSingle = vi.fn().mockResolvedValue({ data, error: null });
  const from = vi.fn(() => chain);
  return { client: { from }, calls, from };
}

const ORIGINAL_BACKEND = process.env.DATA_BACKEND;

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.DATA_BACKEND;
});

afterEach(() => {
  if (ORIGINAL_BACKEND === undefined) delete process.env.DATA_BACKEND;
  else process.env.DATA_BACKEND = ORIGINAL_BACKEND;
});

describe("readSharedDesignByToken — which client serves the read", () => {
  it("uses the SERVICE-ROLE client under DATA_BACKEND=supabase", async () => {
    process.env.DATA_BACKEND = "supabase";
    const admin = recordingClient(ROW);
    getAdminClient.mockReturnValue(admin.client);

    const row = await readSharedDesignByToken(TOKEN);

    expect(row).toEqual(ROW);
    expect(getAdminClient).toHaveBeenCalledTimes(1);
    // The anon client must NOT serve this read: migration 030 leaves anon with
    // no policy on saved_designs, so it would return 0 rows for a valid link.
    expect(createClient).not.toHaveBeenCalled();
  });

  it("FAILS LOUD under DATA_BACKEND=supabase when the service-role key is absent", async () => {
    process.env.DATA_BACKEND = "supabase";
    // getAdminClient() returns null when SUPABASE_SERVICE_ROLE_KEY is unset.
    getAdminClient.mockReturnValue(null);

    // Silently falling back to the anon client would 404 every valid share
    // link — a broken feature that looks like "design not found". A
    // misconfiguration must surface instead of degrading.
    await expect(readSharedDesignByToken(TOKEN)).rejects.toThrow(
      /SUPABASE_SERVICE_ROLE_KEY/,
    );
    expect(createClient).not.toHaveBeenCalled();
  });

  it("uses the request client on the default (memory) backend", async () => {
    const memory = recordingClient(ROW);
    createClient.mockResolvedValue(memory.client);

    const row = await readSharedDesignByToken(TOKEN);

    expect(row).toEqual(ROW);
    expect(createClient).toHaveBeenCalledTimes(1);
    // No RLS to bypass in the memory store, so there is nothing to escalate to.
    expect(getAdminClient).not.toHaveBeenCalled();
  });
});

describe("readSharedDesignByToken — the filters ARE the security boundary", () => {
  it.each([
    ["supabase backend", "supabase"],
    ["memory backend", undefined],
  ])("binds both share_token and is_public (%s)", async (_label, backend) => {
    if (backend) process.env.DATA_BACKEND = backend;
    const rec = recordingClient(ROW);
    getAdminClient.mockReturnValue(rec.client);
    createClient.mockResolvedValue(rec.client);

    await readSharedDesignByToken(TOKEN);

    expect(rec.from).toHaveBeenCalledWith("saved_designs");
    // Dropping EITHER filter re-opens the hole: without share_token any public
    // design is readable; without is_public an un-shared design is.
    expect(rec.calls.eq).toContainEqual(["share_token", TOKEN]);
    expect(rec.calls.eq).toContainEqual(["is_public", true]);
  });

  it("never selects the credential or the owner", async () => {
    const rec = recordingClient(ROW);
    createClient.mockResolvedValue(rec.client);

    await readSharedDesignByToken(TOKEN);

    // Returning share_token would let one recipient re-derive another's link;
    // returning user_id deanonymises whose design it is.
    expect(rec.calls.columns).not.toMatch(/\bshare_token\b/);
    expect(rec.calls.columns).not.toMatch(/\buser_id\b/);
    // Still returns everything the public view actually renders.
    for (const col of ["id", "title", "room_type", "stage", "thumbnail_url", "snapshot", "created_at"]) {
      expect(rec.calls.columns).toMatch(new RegExp(`\\b${col}\\b`));
    }
  });

  it("returns null for a non-public or unknown token without leaking which", async () => {
    const rec = recordingClient(null);
    createClient.mockResolvedValue(rec.client);

    // Both cases are the same `null` here, so callers cannot render a
    // distinguishable response and turn the endpoint into a probe.
    await expect(readSharedDesignByToken(TOKEN)).resolves.toBeNull();
  });
});

describe("readSharedDesignByToken — malformed tokens never reach the database", () => {
  it.each([
    ["empty string", ""],
    ["one char below the floor", "a".repeat(MIN_SHARE_TOKEN_LENGTH - 1)],
  ])("short-circuits on %s", async (_label, token) => {
    const rec = recordingClient(ROW);
    createClient.mockResolvedValue(rec.client);

    // `.eq("share_token", "")` against a nullable column must never become a
    // wildcard scan, and a guessing client must not get free query budget.
    await expect(readSharedDesignByToken(token)).resolves.toBeNull();
    expect(createClient).not.toHaveBeenCalled();
    expect(getAdminClient).not.toHaveBeenCalled();
  });

  it("accepts a token exactly at the floor", async () => {
    const rec = recordingClient(ROW);
    createClient.mockResolvedValue(rec.client);

    await expect(
      readSharedDesignByToken("b".repeat(MIN_SHARE_TOKEN_LENGTH)),
    ).resolves.toEqual(ROW);
  });

  it("isWellFormedShareToken rejects null/undefined and short strings", () => {
    expect(isWellFormedShareToken(null)).toBe(false);
    expect(isWellFormedShareToken(undefined)).toBe(false);
    expect(isWellFormedShareToken("short")).toBe(false);
    expect(isWellFormedShareToken(TOKEN)).toBe(true);
  });
});
