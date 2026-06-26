import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { userOwnsRoom, userOwnsCandidateProduct } from "@/lib/auth/ownership";

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

// ── userOwnsRoom ──────────────────────────────────────────────────────────────

describe("userOwnsRoom", () => {
  it("returns true when the room exists and belongs to the user", async () => {
    const supabase = makeSupabase({ id: "room-1", projects: { user_id: "user-1" } });
    expect(await userOwnsRoom(supabase, "room-1", "user-1")).toBe(true);
  });

  it("returns false when the query returns no data (room not found or not owned)", async () => {
    const supabase = makeSupabase(null);
    expect(await userOwnsRoom(supabase, "room-99", "user-1")).toBe(false);
  });

  it("returns false when data is undefined", async () => {
    const supabase = makeSupabase(undefined);
    expect(await userOwnsRoom(supabase, "room-1", "user-1")).toBe(false);
  });

  it("queries the rooms table with correct filters", async () => {
    const { supabase, from, chain } = makeTrackedSupabase(null);

    await userOwnsRoom(supabase, "room-abc", "user-xyz");

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

// ── userOwnsCandidateProduct ──────────────────────────────────────────────────

describe("userOwnsCandidateProduct", () => {
  it("returns true when the product exists and belongs to the user", async () => {
    const supabase = makeSupabase({ id: "prod-1", rooms: { projects: { user_id: "user-1" } } });
    expect(await userOwnsCandidateProduct(supabase, "prod-1", "user-1")).toBe(true);
  });

  it("returns false when the query returns no data", async () => {
    const supabase = makeSupabase(null);
    expect(await userOwnsCandidateProduct(supabase, "prod-99", "user-1")).toBe(false);
  });

  it("returns false when data is undefined", async () => {
    const supabase = makeSupabase(undefined);
    expect(await userOwnsCandidateProduct(supabase, "prod-1", "user-1")).toBe(false);
  });

  it("queries the candidate_products table with correct filters", async () => {
    const { supabase, from, chain } = makeTrackedSupabase(null);

    await userOwnsCandidateProduct(supabase, "prod-abc", "user-xyz");

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
