import { describe, it, expect } from "vitest";
import { createMemoryClient } from "@/lib/store/memory-store";

/**
 * `createMemoryClient()` is the `DATA_BACKEND=memory` stand-in for Supabase
 * used in local dev and any test that doesn't set DATA_BACKEND=supabase — it
 * must replicate supabase-js's real `.single()` contract, or a bug that only
 * shows up when `.single()` finds zero rows can pass here and still ship.
 * Real supabase-js resolves `{data: null, error: <PGRST116-shaped error>}`
 * when `.single()` matches no rows; this mock previously always resolved
 * `error: null`, silently hiding that divergence from anything that checked
 * `error` rather than `data`.
 */
describe("memory-store QueryBuilder.single()", () => {
  it("returns a PGRST116-coded error when no row matches, mirroring supabase-js", async () => {
    const client = createMemoryClient();
    const { data, error } = await client
      .from("projects")
      .select("*")
      .eq("id", "does-not-exist")
      .single();

    expect(data).toBeNull();
    expect(error).not.toBeNull();
    // Real supabase-js's zero-row .single() error carries this exact code —
    // app/api/rooms/[roomId]/route.ts branches 404-vs-500 on it, so a
    // differently-shaped error here silently turns a 404 into a 500 under
    // DATA_BACKEND=memory.
    expect(error?.code).toBe("PGRST116");
  });

  it("returns the row with no error when exactly one row matches", async () => {
    const client = createMemoryClient();
    const { data: inserted } = await client
      .from("projects")
      .insert({ name: "Test Project" })
      .select()
      .single();

    const { data, error } = await client
      .from("projects")
      .select("*")
      .eq("id", inserted.id)
      .single();

    expect(error).toBeNull();
    expect(data.id).toBe(inserted.id);
  });

  it("maybeSingle() still returns no error on zero rows (distinct contract from single())", async () => {
    const client = createMemoryClient();
    const { data, error } = await client
      .from("projects")
      .select("*")
      .eq("id", "does-not-exist")
      .maybeSingle();

    expect(data).toBeNull();
    expect(error).toBeNull();
  });
});
