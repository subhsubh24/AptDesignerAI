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

/**
 * APT-51: `resolveRelations()`'s `relationPattern` only matches a top-level
 * `table(...)` whose OWN content has no nested parens — so an outer relation
 * like `product_bundle_items(*, candidate_products(...))` (GET /api/bundles'
 * real select string) was never assigned onto the parent row at all, and the
 * nested-attachment pass silently no-opped on the missing key. Reproduces the
 * exact production select shape as a permanent regression test.
 */
describe("memory-store resolveRelations() nested embeds", () => {
  it("resolves an outer relation whose own content contains a nested table(...) call", async () => {
    const client = createMemoryClient();

    const { data: room } = await client.from("rooms").insert({ name: "Test Room" }).select().single();
    const { data: bundle } = await client
      .from("product_bundles")
      .insert({ room_id: room.id, name: "Test Bundle" })
      .select()
      .single();
    const { data: product } = await client
      .from("candidate_products")
      .insert({ room_id: room.id, title: "Test Sofa" })
      .select()
      .single();
    await client
      .from("product_bundle_items")
      .insert({ bundle_id: bundle.id, product_id: product.id, category: "sofa" });
    await client.from("bundle_evaluations").insert({ bundle_id: bundle.id });

    const { data, error } = await client
      .from("product_bundles")
      .select("*, product_bundle_items(*, candidate_products(id, title)), bundle_evaluations(*)")
      .eq("id", bundle.id)
      .single();

    expect(error).toBeNull();
    expect(Array.isArray(data.product_bundle_items)).toBe(true);
    expect(data.product_bundle_items).toHaveLength(1);
    expect(data.product_bundle_items[0].candidate_products).toBeTruthy();
    expect(data.product_bundle_items[0].candidate_products.id).toBe(product.id);
    expect(data.product_bundle_items[0].candidate_products.title).toBe("Test Sofa");
    // The sibling flat relation on the same select string must keep working.
    expect(Array.isArray(data.bundle_evaluations)).toBe(true);
    expect(data.bundle_evaluations).toHaveLength(1);
  });
});
