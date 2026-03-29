import { describe, it, expect } from "vitest";
import type { AgentContext, AgentResult } from "@/lib/agents/types";

/**
 * Type-level tests to ensure AgentContext has all required fields.
 * These tests verify that the interface contract hasn't been broken.
 */
describe("AgentContext interface", () => {
  it("should accept a fully populated context", () => {
    const ctx: AgentContext = {
      roomId: "room-123",
      roomType: "living_room",
      keepItems: ["walnut media console"],
      replaceItems: ["old rug"],
      priorities: ["hosting", "comfort"],
      budgetMode: "balanced",
      sourcingMode: "agentic",
      imageUrls: ["https://example.com/room.jpg"],
      designProfile: undefined,
      diagnosis: undefined,
      designDirection: undefined,
      userFeedbackContext: "User rejected chrome fixtures",
      spatialLayout: "L-shaped seating facing TV",
      placementMap: { coffee_table: "Center of seating area" },
      floorPlan: { total_sqft: 650, room_dimensions: { living_room: "12x15" } },
      lightingConditions: "South-facing, bright",
      windowDoorPositions: "Large window south wall",
      outletPositions: "Outlets on south wall",
    };

    // Verify all spatial fields exist
    expect(ctx.spatialLayout).toBeDefined();
    expect(ctx.placementMap).toBeDefined();
    expect(ctx.floorPlan).toBeDefined();

    // Verify all environmental fields exist
    expect(ctx.lightingConditions).toBeDefined();
    expect(ctx.windowDoorPositions).toBeDefined();
    expect(ctx.outletPositions).toBeDefined();
  });

  it("should accept minimal required context", () => {
    const ctx: AgentContext = {
      roomId: "room-123",
      roomType: "bedroom",
      keepItems: [],
      replaceItems: [],
      priorities: [],
      budgetMode: "budget",
      sourcingMode: "manual",
      imageUrls: [],
    };

    expect(ctx.roomId).toBe("room-123");
    // Optional fields should be undefined
    expect(ctx.spatialLayout).toBeUndefined();
    expect(ctx.placementMap).toBeUndefined();
    expect(ctx.floorPlan).toBeUndefined();
    expect(ctx.lightingConditions).toBeUndefined();
    expect(ctx.windowDoorPositions).toBeUndefined();
    expect(ctx.outletPositions).toBeUndefined();
  });

  it("should have placement map as Record<string, string>", () => {
    const ctx: AgentContext = {
      roomId: "r",
      roomType: "living_room",
      keepItems: [],
      replaceItems: [],
      priorities: [],
      budgetMode: "balanced",
      sourcingMode: "agentic",
      imageUrls: [],
      placementMap: {
        coffee_table: "Center of seating area",
        floor_lamp: "Left of sofa, near outlet",
        area_rug: "Under seating arrangement",
        dining_table: "Adjacent to kitchen peninsula",
      },
    };
    expect(Object.keys(ctx.placementMap!)).toHaveLength(4);
    expect(ctx.placementMap!.coffee_table).toBe("Center of seating area");
  });
});

describe("AgentResult interface", () => {
  it("should represent a successful result", () => {
    const result: AgentResult<{ score: number }> = {
      success: true,
      data: { score: 7.5 },
      tokensUsed: 1500,
      model: "gemini-3-flash-preview",
    };
    expect(result.success).toBe(true);
    expect(result.data?.score).toBe(7.5);
  });

  it("should represent a failed result", () => {
    const result: AgentResult = {
      success: false,
      error: "API timeout",
    };
    expect(result.success).toBe(false);
    expect(result.error).toBe("API timeout");
    expect(result.data).toBeUndefined();
  });
});
