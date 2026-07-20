import { beforeEach, afterEach, describe, expect, it, vi, type Mock } from "vitest";

// Regression guard for a cross-tenant read IDOR on the saved-designs save path.
// The route accepts an optional client-supplied `project_id` and copies the
// project's name + building_name into the caller's saved_designs.metadata (later
// readable back via GET /api/saved-designs/[id]). It previously fetched the
// project by id ALONE (no user bind), so a caller could pass ANOTHER tenant's
// project_id and exfiltrate that project's name + building_name into their own
// saved design. Under the default (inert-RLS) memory store the app-layer bind is
// the SOLE tenant boundary, so this was a real cross-tenant leak.
//
// The fix binds the fetch with .eq("user_id", userId) (mirroring userOwnsProject)
// and uses .maybeSingle(), so a non-owned/absent project yields NO metadata
// rather than leaking or erroring. These tests assert that behaviour by making
// the projects stub honour the user_id filter the way Postgres+RLS would.

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(), getCurrentUserId: vi.fn() }));
vi.mock("@/lib/auth/ownership", () => ({ userOwnsRoom: vi.fn() }));
vi.mock("@/lib/utils/rate-limiter", () => ({ checkRateLimit: vi.fn(() => ({ allowed: true })) }));
vi.mock("@/lib/entitlements/web", () => ({
  hasProEntitlementWeb: vi.fn(async () => true),
  FREE_SAVE_LIMIT_WEB: 3,
}));

import { createClient, getCurrentUserId } from "@/lib/supabase/server";
import { userOwnsRoom } from "@/lib/auth/ownership";
import { POST as savedDesignsPost } from "@/app/api/saved-designs/route";

const mockCreateClient = createClient as unknown as Mock;
const mockGetCurrentUserId = getCurrentUserId as unknown as Mock;
const mockUserOwnsRoom = userOwnsRoom as unknown as Mock;

const CALLER = "user-1";
const OWNED_PROJECT = { id: "proj-owned", user_id: CALLER, name: "My Loft", building_name: "My Building" };
const OTHER_PROJECT = { id: "proj-other", user_id: "user-2", name: "Victim Loft", building_name: "Victim Tower" };

type QueryResult = { data?: unknown; error?: unknown };

function makeQuery(result: QueryResult) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "limit", "in", "update", "insert"]) {
    chain[m] = vi.fn(() => chain);
  }
  chain.single = vi.fn(() => Promise.resolve(result));
  chain.maybeSingle = vi.fn(() => Promise.resolve(result));
  chain.then = (resolve: (v: QueryResult) => unknown) => Promise.resolve(result).then(resolve);
  return chain;
}

// A projects query stub that mimics the RLS/user_id filter: it collects .eq()
// filters and only resolves the row when both id AND user_id match a known
// project. This is exactly the guard the route must apply — an unbound query
// (id only) that returns another tenant's row is the bug under test.
function makeProjectsQuery(projects: Array<Record<string, unknown>>) {
  const filters: Record<string, unknown> = {};
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn((col: string, val: unknown) => {
    filters[col] = val;
    return chain;
  });
  const resolve = () => {
    const match = projects.find((p) =>
      Object.entries(filters).every(([k, v]) => p[k] === v),
    );
    return { data: match ?? null, error: null };
  };
  chain.single = vi.fn(() => Promise.resolve(resolve()));
  chain.maybeSingle = vi.fn(() => Promise.resolve(resolve()));
  return chain;
}

function makeClient(projectsRows: Array<Record<string, unknown>>, captured: { snapshot?: unknown }) {
  const results: Record<string, QueryResult> = {
    rooms: { data: { name: "Living Room", room_type: "living_room" }, error: null },
    room_diagnoses: {
      data: { diagnosis_json: { what_it_needs: [], summary: "s" }, design_direction_json: {} },
      error: null,
    },
    saved_designs: { data: null, error: null }, // no existing row → INSERT path
  };
  return {
    from: vi.fn((table: string) => {
      if (table === "projects") return makeProjectsQuery(projectsRows);
      if (table === "saved_designs") {
        // capture what the route tries to INSERT so we can assert on metadata
        const chain: Record<string, unknown> = {};
        chain.select = vi.fn(() => chain);
        chain.eq = vi.fn(() => chain);
        chain.maybeSingle = vi.fn(() => Promise.resolve({ data: null, error: null }));
        chain.single = vi.fn(() => Promise.resolve({ data: { id: "sd-1" }, error: null }));
        chain.insert = vi.fn((row: unknown) => {
          captured.snapshot = row;
          return chain;
        });
        chain.update = vi.fn(() => chain);
        chain.then = (r: (v: QueryResult) => unknown) => Promise.resolve({ data: { id: "sd-1" }, error: null }).then(r);
        return chain;
      }
      return makeQuery(results[table] ?? { data: null, error: null });
    }),
  };
}

function jsonReq(body: unknown): Request {
  return new Request("http://localhost/api/saved-designs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function metadataOf(captured: { snapshot?: unknown }): Record<string, unknown> {
  const row = captured.snapshot as { snapshot?: { metadata?: Record<string, unknown> } } | undefined;
  return row?.snapshot?.metadata ?? {};
}

beforeEach(() => {
  mockCreateClient.mockReset();
  mockGetCurrentUserId.mockReset();
  mockUserOwnsRoom.mockReset();
  mockGetCurrentUserId.mockResolvedValue(CALLER);
  mockUserOwnsRoom.mockResolvedValue(true);
});
afterEach(() => vi.restoreAllMocks());

describe("saved-designs POST — project_id cross-tenant IDOR", () => {
  it("does NOT copy another tenant's project name/building into metadata", async () => {
    const captured: { snapshot?: unknown } = {};
    mockCreateClient.mockResolvedValue(makeClient([OWNED_PROJECT, OTHER_PROJECT], captured));

    const res = await savedDesignsPost(
      jsonReq({ room_id: "room-1", project_id: OTHER_PROJECT.id, stage: "assessment" }) as never,
    );

    expect(res.status).toBe(201);
    const meta = metadataOf(captured);
    expect(meta.project_name).toBeUndefined();
    expect(meta.building_name).toBeUndefined();
    // The victim's fields must never appear anywhere in the persisted row.
    expect(JSON.stringify(captured.snapshot)).not.toContain("Victim");
  });

  it("still records the caller's OWN project name/building into metadata", async () => {
    const captured: { snapshot?: unknown } = {};
    mockCreateClient.mockResolvedValue(makeClient([OWNED_PROJECT, OTHER_PROJECT], captured));

    const res = await savedDesignsPost(
      jsonReq({ room_id: "room-1", project_id: OWNED_PROJECT.id, stage: "assessment" }) as never,
    );

    expect(res.status).toBe(201);
    const meta = metadataOf(captured);
    expect(meta.project_name).toBe("My Loft");
    expect(meta.building_name).toBe("My Building");
  });
});
