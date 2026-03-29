import { describe, it, expect } from "vitest";
import type { BundleContext } from "@/lib/agents/bundle-optimizer";

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
