import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  requireRoomOwnership,
  requireProjectOwnership,
  requireCandidateProductOwnership,
} from "@/lib/auth/ownership";

// Direct unit coverage of the fetch*/ownershipVerdict query-building logic
// shared by every require*Ownership guard. `userOwnsRoom`/`userOwnsProject`/
// `userOwnsCandidateProduct` (removed — see APT-19) were dead code left behind
// by PR #859's migration to these require* guards; the query-shape assertions
// they carried are preserved here against the guards that actually ship.

function makeSupabase(data: unknown, error: unknown = null): SupabaseClient {
  const single = vi.fn().mockResolvedValue({ data, error });
  // Build a chainable object that returns itself from .eq() and .select()
  const chain: Record<string, unknown> = { single };
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.select = vi.fn().mockReturnValue(chain);
  const from = vi.fn().mockReturnValue(chain);
  return { from } as unknown as SupabaseClient;
}

function makeTrackedSupabase(data: unknown, error: unknown = null) {
  const single = vi.fn().mockResolvedValue({ data, error });
  const chain: Record<string, unknown> = { single };
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.select = vi.fn().mockReturnValue(chain);
  const from = vi.fn().mockReturnValue(chain);
  return { supabase: { from } as unknown as SupabaseClient, from, chain };
}

// ── requireRoomOwnership ─────────────────────────────────────────────────────

describe("requireRoomOwnership", () => {
  it("returns null (proceed) when the room exists and belongs to the user", async () => {
    const supabase = makeSupabase({ id: "room-1", projects: { user_id: "user-1" } });
    expect(await requireRoomOwnership(supabase, "room-1", "user-1")).toBeNull();
  });

  it("returns a 404 'Not found' response when the room is missing or not owned", async () => {
    const supabase = makeSupabase(null);
    const res = await requireRoomOwnership(supabase, "room-99", "user-1");
    expect(res).not.toBeNull();
    expect(res!.status).toBe(404);
    expect(await res!.json()).toEqual({ error: "Not found" });
  });

  it("queries the rooms table with correct filters", async () => {
    const { supabase, from, chain } = makeTrackedSupabase(null);

    await requireRoomOwnership(supabase, "room-abc", "user-xyz");

    expect(from).toHaveBeenCalledWith("rooms");
    expect(vi.mocked(chain.select as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      "id, projects!inner(user_id)"
    );
    expect(vi.mocked(chain.eq as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("id", "room-abc");
    expect(vi.mocked(chain.eq as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      "projects.user_id",
      "user-xyz"
    );
  });
});

// ── requireProjectOwnership ──────────────────────────────────────────────────

describe("requireProjectOwnership", () => {
  it("returns null (proceed) when the project exists and belongs to the user", async () => {
    const supabase = makeSupabase({ id: "proj-1" });
    expect(await requireProjectOwnership(supabase, "proj-1", "user-1")).toBeNull();
  });

  it("returns a 404 'Not found' response when the project is missing or not owned", async () => {
    const supabase = makeSupabase(null);
    const res = await requireProjectOwnership(supabase, "proj-99", "user-1");
    expect(res).not.toBeNull();
    expect(res!.status).toBe(404);
    expect(await res!.json()).toEqual({ error: "Not found" });
  });

  it("queries the projects table filtered by BOTH id and user_id", async () => {
    const { supabase, from, chain } = makeTrackedSupabase(null);

    await requireProjectOwnership(supabase, "proj-abc", "user-xyz");

    expect(from).toHaveBeenCalledWith("projects");
    expect(vi.mocked(chain.select as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("id");
    expect(vi.mocked(chain.eq as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("id", "proj-abc");
    // The user_id filter is the access-control boundary — assert it is applied.
    expect(vi.mocked(chain.eq as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      "user_id",
      "user-xyz",
    );
  });
});

// ── requireCandidateProductOwnership ─────────────────────────────────────────

describe("requireCandidateProductOwnership", () => {
  it("returns null (proceed) when the product exists and belongs to the user", async () => {
    const supabase = makeSupabase({ id: "prod-1", rooms: { projects: { user_id: "user-1" } } });
    expect(await requireCandidateProductOwnership(supabase, "prod-1", "user-1")).toBeNull();
  });

  it("returns a 404 'Not found' response when the product is missing or not owned", async () => {
    const supabase = makeSupabase(null);
    const res = await requireCandidateProductOwnership(supabase, "prod-99", "user-1");
    expect(res).not.toBeNull();
    expect(res!.status).toBe(404);
    expect(await res!.json()).toEqual({ error: "Not found" });
  });

  it("queries the candidate_products table with correct filters", async () => {
    const { supabase, from, chain } = makeTrackedSupabase(null);

    await requireCandidateProductOwnership(supabase, "prod-abc", "user-xyz");

    expect(from).toHaveBeenCalledWith("candidate_products");
    expect(vi.mocked(chain.select as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      "id, rooms!inner(projects!inner(user_id))"
    );
    expect(vi.mocked(chain.eq as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("id", "prod-abc");
    expect(vi.mocked(chain.eq as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      "rooms.projects.user_id",
      "user-xyz"
    );
  });
});

// ── ownershipVerdict — real DB error is never reported as 404 ───────────────
// (See APT-16 / ownership-error-classification.test.ts for coverage through
// real route callers; this exercises the guards directly.)

describe("require*Ownership — real DB error is not misreported as not-found", () => {
  it("requireRoomOwnership surfaces a real DB error as a 500, not a 404", async () => {
    const supabase = makeSupabase(null, { code: "53300", message: "too many connections" });
    const res = await requireRoomOwnership(supabase, "room-1", "user-1");
    expect(res).not.toBeNull();
    expect(res!.status).toBe(500);
  });
});
