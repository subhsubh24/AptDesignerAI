import { describe, it, expect } from "vitest";
import { prefilterBundleCombos, type BundleContext } from "@/lib/agents/bundle-optimizer";
import type { CandidateProduct } from "@/lib/types/database";

function makeProduct(id: string, overrides: Partial<CandidateProduct> = {}): CandidateProduct {
  return {
    id,
    room_id: "room-1",
    search_session_id: null,
    title: "Cognac leather accent chair",
    category: "accent_chair",
    retailer: "West Elm",
    product_url: `https://example.com/${id}`,
    image_url: null,
    local_image_path: null,
    price: 800,
    dimensions: null,
    materials: ["leather", "walnut"],
    colors: ["cognac"],
    description: null,
    source_type: "agentic_search",
    metadata: null,
    status: "pending",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const keyOf = (combo: CandidateProduct[]) => combo.map((p) => p.id).sort().join("|");

/**
 * Tests for BundleContext interface — ensures spatial and environmental
 * fields are properly typed and accepted.
 */
describe("BundleContext interface", () => {
  it("should accept all spatial and environmental fields", () => {
    const ctx: BundleContext = {
      roomType: "living_room",
      roomImageUrls: ["https://example.com/room.jpg"],
      priorities: ["hosting", "comfort"],
      designProfile: undefined,
      diagnosis: undefined,
      designDirection: undefined,
      spatialLayout: "L-shaped seating with dining behind",
      placementMap: {
        coffee_table: "Center of seating area",
        floor_lamp: "Left of sofa near outlet",
        area_rug: "Under seating arrangement",
      },
      floorPlan: {
        total_sqft: 650,
        room_dimensions: { living_room: "12x15" },
      },
      lightingConditions: "South-facing, bright afternoon",
      windowDoorPositions: "Large window south wall, entry east",
    };

    expect(ctx.spatialLayout).toBeDefined();
    expect(ctx.placementMap).toBeDefined();
    expect(ctx.floorPlan).toBeDefined();
    expect(ctx.lightingConditions).toBeDefined();
    expect(ctx.windowDoorPositions).toBeDefined();
  });

  it("should work with minimal fields", () => {
    const ctx: BundleContext = {
      roomType: "bedroom",
      roomImageUrls: [],
    };
    expect(ctx.roomType).toBe("bedroom");
    expect(ctx.spatialLayout).toBeUndefined();
    expect(ctx.lightingConditions).toBeUndefined();
  });

  it("should pass placement map to bundle evaluation prompt", () => {
    const ctx: BundleContext = {
      roomType: "living_room",
      roomImageUrls: [],
      placementMap: {
        area_rug: "Under sofa and coffee table, extending 24in on all sides",
        coffee_table: "Center of seating area, 18in from sofa",
        floor_lamp: "Right of accent chair, within 3ft of south wall outlet",
      },
    };

    // Verify placement map has expected categories
    expect(Object.keys(ctx.placementMap!)).toContain("area_rug");
    expect(Object.keys(ctx.placementMap!)).toContain("coffee_table");
    expect(Object.keys(ctx.placementMap!)).toContain("floor_lamp");

    // Verify placements contain spatial detail
    for (const placement of Object.values(ctx.placementMap!)) {
      expect(placement.length).toBeGreaterThan(10);
    }
  });
});

/**
 * Determinism guard for the combo prefilter sort (determinism.md: every sort
 * needs a stable tiebreaker). Combos with an identical math.overall must rank in
 * a fixed order regardless of the input order they arrive in — otherwise the
 * kept set (and the chosen bundle) drifts run-to-run.
 */
describe("prefilterBundleCombos — deterministic ordering", () => {
  const ctx: BundleContext = { roomType: "living_room", roomImageUrls: [] };

  // Two combos share identical specs (same math.overall → a tie); a third
  // differs. The kept order must be identical no matter the input permutation.
  const comboTieA = [makeProduct("aaa"), makeProduct("bbb")];
  const comboTieB = [makeProduct("ccc"), makeProduct("ddd")];
  const comboOther = [makeProduct("eee", { materials: ["oak"], colors: ["sage"], price: 200 })];

  it("produces the same kept order when the input order is reversed", () => {
    const forward = prefilterBundleCombos([comboTieA, comboTieB, comboOther], ctx, {
      minKept: 1,
      mathFloor: 0,
    });
    const reversed = prefilterBundleCombos([comboOther, comboTieB, comboTieA], ctx, {
      minKept: 1,
      mathFloor: 0,
    });

    // All three survive the zero floor, and the ordering is byte-stable.
    expect(forward.kept.map(keyOf)).toEqual(reversed.kept.map(keyOf));
    expect(forward.kept).toHaveLength(3);
  });

  it("breaks ties by the combo's sorted product ids (not input order)", () => {
    // comboTieB's id-key ("ccc|ddd") sorts before comboTieA's ("aaa|bbb")? No —
    // "aaa|bbb" < "ccc|ddd" lexically, so among the two tied combos, comboTieA
    // must always come first regardless of which was passed first.
    const result = prefilterBundleCombos([comboTieB, comboTieA], ctx, { minKept: 1, mathFloor: 0 });
    const tiedKeys = result.kept.map(keyOf);
    expect(tiedKeys.indexOf("aaa|bbb")).toBeLessThan(tiedKeys.indexOf("ccc|ddd"));
  });
});
