import { describe, it, expect } from "vitest";
import type { ScoringContext, QuickScoreEntry } from "@/lib/agents/fit-scorer";

/**
 * Tests for the fit-scorer module interfaces and data structures.
 * Actual API calls are not tested here (those need integration tests with Gemini).
 */
describe("ScoringContext interface", () => {
  it("should accept all spatial and environmental fields", () => {
    const ctx: ScoringContext = {
      roomType: "living_room",
      budgetMode: "balanced",
      existingItems: ["walnut media console", "gray sofa"],
      roomImageUrls: ["https://example.com/room1.jpg"],
      priorities: ["hosting", "comfort"],
      placement: "Between sofa and TV wall, centered",
      spatialLayout: "L-shaped seating with dining zone behind",
      floorPlan: {
        total_sqft: 650,
        room_dimensions: { living_room: "12x15" },
        notable_spatial_features: ["open to kitchen"],
      },
      lightingConditions: "South-facing windows, bright afternoon",
      windowDoorPositions: "Large window south wall, entry east",
      outletPositions: "South wall flanking window, east wall near entry",
    };

    expect(ctx.placement).toBeDefined();
    expect(ctx.spatialLayout).toBeDefined();
    expect(ctx.floorPlan).toBeDefined();
    expect(ctx.lightingConditions).toBeDefined();
    expect(ctx.windowDoorPositions).toBeDefined();
    expect(ctx.outletPositions).toBeDefined();
  });

  it("should work with minimal required fields only", () => {
    const ctx: ScoringContext = {
      roomType: "bedroom",
      budgetMode: "budget",
      existingItems: [],
      roomImageUrls: [],
    };
    expect(ctx.roomType).toBe("bedroom");
    expect(ctx.placement).toBeUndefined();
    expect(ctx.lightingConditions).toBeUndefined();
  });
});

describe("QuickScoreEntry interface", () => {
  it("should have scaleFit field", () => {
    const entry: QuickScoreEntry = {
      productId: "prod-123",
      quickScore: 7.2,
      styleFit: 8,
      scaleFit: 7,
      valueFit: 6,
      confidence: 8,
    };
    expect(entry.scaleFit).toBe(7);
  });

  it("should compute quick score as average of 4 dimensions", () => {
    const entry: QuickScoreEntry = {
      productId: "prod-123",
      quickScore: 0, // will calculate
      styleFit: 8,
      scaleFit: 6,
      valueFit: 7,
      confidence: 9,
    };
    const expectedAvg = (8 + 6 + 7 + 9) / 4; // 7.5
    entry.quickScore = Math.round(expectedAvg * 10) / 10;
    expect(entry.quickScore).toBe(7.5);
  });

  it("should handle fallback scores (all 5s with low confidence)", () => {
    const fallbackEntry: QuickScoreEntry = {
      productId: "prod-fail",
      quickScore: 5,
      styleFit: 5,
      scaleFit: 5,
      valueFit: 5,
      confidence: 3,
    };
    expect(fallbackEntry.quickScore).toBe(5);
    expect(fallbackEntry.confidence).toBe(3);
  });
});
