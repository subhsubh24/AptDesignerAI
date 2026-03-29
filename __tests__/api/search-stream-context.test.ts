import { describe, it, expect } from "vitest";

/**
 * Tests for the data flow logic in the search/stream API route.
 * Tests the extraction of spatial and environmental context from
 * diagnosis data and building research — without needing Supabase.
 */

// Replicate the extraction logic from app/api/search/stream/route.ts
function extractSpatialContext(diagnosisJson: Record<string, unknown> | undefined) {
  const spatialLayout = diagnosisJson?.spatial_layout as string | undefined;

  const placementMap: Record<string, string> = {};
  const whatItNeeds = diagnosisJson?.what_it_needs as
    | Array<{ category?: string; placement?: string }>
    | undefined;
  if (whatItNeeds) {
    for (const item of whatItNeeds) {
      if (item.category && item.placement) {
        placementMap[item.category] = item.placement;
      }
    }
  }

  return { spatialLayout, placementMap };
}

function extractEnvironmentalContext(diagnosisJson: Record<string, unknown> | undefined) {
  return {
    lightingConditions: diagnosisJson?.lighting_conditions as string | undefined,
    windowDoorPositions: diagnosisJson?.window_door_positions as string | undefined,
    outletPositions: diagnosisJson?.outlet_positions as string | undefined,
  };
}

function extractFloorPlan(buildingResearch: Record<string, unknown> | undefined) {
  return (buildingResearch?.floor_plan as Record<string, unknown>) || undefined;
}

describe("Spatial context extraction from diagnosis", () => {
  it("should extract spatial_layout from diagnosis", () => {
    const diagnosis = {
      spatial_layout: "L-shaped seating with dining zone behind the sofa",
      what_it_needs: [],
    };
    const { spatialLayout } = extractSpatialContext(diagnosis);
    expect(spatialLayout).toBe("L-shaped seating with dining zone behind the sofa");
  });

  it("should build placement map from what_it_needs", () => {
    const diagnosis = {
      what_it_needs: [
        { category: "coffee_table", placement: "Center of seating area, 18in from sofa" },
        { category: "area_rug", placement: "Under seating, extending 24in beyond" },
        { category: "floor_lamp", placement: "Left of sofa near window" },
      ],
    };
    const { placementMap } = extractSpatialContext(diagnosis);
    expect(Object.keys(placementMap)).toHaveLength(3);
    expect(placementMap.coffee_table).toContain("Center of seating area");
    expect(placementMap.area_rug).toContain("Under seating");
    expect(placementMap.floor_lamp).toContain("Left of sofa");
  });

  it("should skip items without placement in placement map", () => {
    const diagnosis = {
      what_it_needs: [
        { category: "coffee_table", placement: "Center of room" },
        { category: "throw_pillows" }, // no placement
        { category: "vase", placement: "" }, // empty placement
      ],
    };
    const { placementMap } = extractSpatialContext(diagnosis);
    expect(Object.keys(placementMap)).toHaveLength(1);
    expect(placementMap.coffee_table).toBeDefined();
  });

  it("should handle undefined diagnosis gracefully", () => {
    const { spatialLayout, placementMap } = extractSpatialContext(undefined);
    expect(spatialLayout).toBeUndefined();
    expect(Object.keys(placementMap)).toHaveLength(0);
  });

  it("should handle empty what_it_needs array", () => {
    const { placementMap } = extractSpatialContext({ what_it_needs: [] });
    expect(Object.keys(placementMap)).toHaveLength(0);
  });
});

describe("Environmental context extraction from diagnosis", () => {
  it("should extract all environmental fields", () => {
    const diagnosis = {
      lighting_conditions: "South-facing windows, bright afternoon sun",
      window_door_positions: "Large window south wall, entry door east",
      outlet_positions: "Outlets on south wall flanking window",
    };
    const env = extractEnvironmentalContext(diagnosis);
    expect(env.lightingConditions).toContain("South-facing");
    expect(env.windowDoorPositions).toContain("south wall");
    expect(env.outletPositions).toContain("flanking window");
  });

  it("should handle missing environmental fields", () => {
    const diagnosis = { summary: "Basic room analysis" };
    const env = extractEnvironmentalContext(diagnosis);
    expect(env.lightingConditions).toBeUndefined();
    expect(env.windowDoorPositions).toBeUndefined();
    expect(env.outletPositions).toBeUndefined();
  });

  it("should handle undefined diagnosis", () => {
    const env = extractEnvironmentalContext(undefined);
    expect(env.lightingConditions).toBeUndefined();
    expect(env.windowDoorPositions).toBeUndefined();
    expect(env.outletPositions).toBeUndefined();
  });
});

describe("Floor plan extraction from building research", () => {
  it("should extract floor plan from building research", () => {
    const br = {
      floor_plan: {
        total_sqft: 650,
        room_dimensions: { living_room: "12x15", bedroom: "10x12" },
        room_layout: "Open living/dining with galley kitchen",
        living_dining_combined: true,
        notable_spatial_features: ["open to kitchen", "column near dining area"],
      },
    };
    const fp = extractFloorPlan(br);
    expect(fp).toBeDefined();
    expect(fp!.total_sqft).toBe(650);
    expect(fp!.living_dining_combined).toBe(true);
  });

  it("should handle missing floor plan", () => {
    const br = { building_style: "Modern high-rise" };
    const fp = extractFloorPlan(br);
    expect(fp).toBeUndefined();
  });

  it("should handle undefined building research", () => {
    const fp = extractFloorPlan(undefined);
    expect(fp).toBeUndefined();
  });
});

describe("Full context assembly", () => {
  it("should produce complete AgentContext-compatible fields from real diagnosis", () => {
    const diagnosisJson = {
      summary: "Modern 1BR with walnut floors and gray sofa",
      spatial_layout: "L-shaped seating facing west wall TV, dining zone behind sofa",
      lighting_conditions: "South-facing floor-to-ceiling windows, bright",
      window_door_positions: "Floor-to-ceiling window south wall, entry east, bedroom north",
      outlet_positions: "South wall flanking window, north wall behind TV",
      what_it_needs: [
        {
          category: "area_rug",
          placement: "Under seating arrangement, 8x10, centered",
          search_title: "Hand-knotted wool rug 8x10 warm cream",
          priority: "high",
        },
        {
          category: "coffee_table",
          placement: "Center of seating area, 18in from sofa",
          search_title: "Round walnut coffee table 36in diameter",
          priority: "high",
        },
        {
          category: "floor_lamp",
          placement: "Right of accent chair near south wall outlet",
          search_title: "Brass arc floor lamp 72in",
          priority: "medium",
        },
      ],
    };

    const buildingResearch = {
      floor_plan: {
        total_sqft: 650,
        room_dimensions: { living_room: "12x15" },
      },
    };

    const { spatialLayout, placementMap } = extractSpatialContext(diagnosisJson);
    const env = extractEnvironmentalContext(diagnosisJson);
    const floorPlan = extractFloorPlan(buildingResearch);

    // All spatial fields populated
    expect(spatialLayout).toContain("L-shaped");
    expect(Object.keys(placementMap)).toHaveLength(3);
    expect(floorPlan?.total_sqft).toBe(650);

    // All environmental fields populated
    expect(env.lightingConditions).toContain("South-facing");
    expect(env.windowDoorPositions).toContain("Floor-to-ceiling");
    expect(env.outletPositions).toContain("South wall");
  });
});
