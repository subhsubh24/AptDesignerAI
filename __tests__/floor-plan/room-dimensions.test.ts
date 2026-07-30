import { describe, it, expect } from "vitest";
import {
  buildRoomDimensionMap,
  lookupRoomDimension,
  normalizeRoomTypeKey,
} from "@/lib/floor-plan/room-dimensions";
import { computeSpatialConstraints } from "@/lib/validation/spatial-math";

/**
 * The bug class this module exists to close: a type-keyed `room_dimensions`
 * map cannot answer "how big is THIS room?" when the type is absent (there is
 * no entry) or duplicated (a two-bedroom apartment). Every test below asserts
 * the same rule from a different angle — when we cannot attribute a number to
 * the room being asked about, we return nothing rather than another room's.
 */
describe("lookupRoomDimension", () => {
  const dims = { living_room: "14x20", bedroom: "10x12" };

  it("returns the entry for the room asked about", () => {
    expect(lookupRoomDimension(dims, "bedroom")).toBe("10x12");
    expect(lookupRoomDimension(dims, "living_room")).toBe("14x20");
  });

  it("returns undefined — NOT the living room — for a type with no entry", () => {
    // The regression. `dims[roomType] || dims.living_room` answered this "14x20",
    // which then reached the render prompt and the oversize veto as fact.
    expect(lookupRoomDimension(dims, "home_office")).toBeUndefined();
    expect(lookupRoomDimension(dims, "nursery")).toBeUndefined();
  });

  it("normalises spacing and case to the map's key convention", () => {
    expect(lookupRoomDimension(dims, "Living Room")).toBe("14x20");
    expect(lookupRoomDimension(dims, "living-room")).toBe("14x20");
    expect(normalizeRoomTypeKey("  Home Office ")).toBe("home_office");
  });

  it("treats a missing map, missing room type, and blank value as unknown", () => {
    expect(lookupRoomDimension(undefined, "bedroom")).toBeUndefined();
    expect(lookupRoomDimension(dims, undefined)).toBeUndefined();
    expect(lookupRoomDimension(dims, "")).toBeUndefined();
    expect(lookupRoomDimension({ bedroom: "   " }, "bedroom")).toBeUndefined();
    expect(lookupRoomDimension({ bedroom: 12 }, "bedroom")).toBeUndefined();
  });
});

describe("buildRoomDimensionMap", () => {
  it("keys each room by its normalised type", () => {
    expect(
      buildRoomDimensionMap([
        { room_type: "Living Room", dimensions_text: "14x20" },
        { room_type: "bedroom", dimensions_text: "10x12" },
      ]),
    ).toEqual({ living_room: "14x20", bedroom: "10x12" });
  });

  it("OMITS a type two rooms disagree on rather than letting the last one win", () => {
    // The two-bedroom apartment. The old loop assigned both, so the second
    // bedroom's size was shown and enforced on the first bedroom's page.
    const map = buildRoomDimensionMap([
      { room_type: "bedroom", dimensions_text: "14x16" },
      { room_type: "bedroom", dimensions_text: "9x10" },
      { room_type: "living_room", dimensions_text: "14x20" },
    ]);
    expect(map.bedroom).toBeUndefined();
    expect(map.living_room).toBe("14x20"); // unambiguous types are unaffected
  });

  it("is order-independent — neither bedroom wins by being written last", () => {
    const forward = buildRoomDimensionMap([
      { room_type: "bedroom", dimensions_text: "14x16" },
      { room_type: "bedroom", dimensions_text: "9x10" },
    ]);
    const reversed = buildRoomDimensionMap([
      { room_type: "bedroom", dimensions_text: "9x10" },
      { room_type: "bedroom", dimensions_text: "14x16" },
    ]);
    expect(forward).toEqual(reversed);
    expect(forward).toEqual({});
  });

  it("keeps a duplicated type when the rooms AGREE (no ambiguity to resolve)", () => {
    expect(
      buildRoomDimensionMap([
        { room_type: "bedroom", dimensions_text: "10x12" },
        { room_type: "bedroom", dimensions_text: "10x12" },
      ]),
    ).toEqual({ bedroom: "10x12" });
  });

  it("three rooms of a type stay omitted even if two of them agree", () => {
    expect(
      buildRoomDimensionMap([
        { room_type: "bedroom", dimensions_text: "10x12" },
        { room_type: "bedroom", dimensions_text: "10x12" },
        { room_type: "bedroom", dimensions_text: "8x9" },
      ]),
    ).toEqual({});
  });

  it("falls back to sqft text only when dimensions_text is absent", () => {
    expect(
      buildRoomDimensionMap([
        { room_type: "den", sqft: 120 },
        { room_type: "study", dimensions_text: "8x10", sqft: 80 },
      ]),
    ).toEqual({ den: "120 sqft", study: "8x10" });
  });

  it("skips rooms carrying neither a size nor a type", () => {
    expect(
      buildRoomDimensionMap([
        { room_type: "bedroom" },
        { room_type: null, dimensions_text: "10x12" },
        { room_type: "hall", dimensions_text: "" },
      ]),
    ).toEqual({});
    expect(buildRoomDimensionMap(null)).toEqual({});
  });
});

describe("spatial-math no longer measures a room against the living room", () => {
  const floorPlan = { room_dimensions: { living_room: "30x30", bedroom: "10x12" } };
  const analysis = {
    what_it_needs: [{ category: "sofa", specs: "84\" wide x 36\" deep 3-seat sofa" }],
  };

  it("uses the asked-for room's dimensions", () => {
    const bedroom = computeSpatialConstraints(analysis, { roomType: "bedroom", floorPlan });
    const living = computeSpatialConstraints(analysis, { roomType: "living_room", floorPlan });
    // Same 84x36 sofa fills far more of a 10x12 bedroom than of a 30x30 living
    // room, so the coverage ratio must differ — proof the lookup is per-room.
    expect(bedroom.room_coverage_ratio).toBeGreaterThan(living.room_coverage_ratio);
  });

  it("does NOT silently reuse the living room for a type with no entry", () => {
    const office = computeSpatialConstraints(analysis, { roomType: "home_office", floorPlan });
    const living = computeSpatialConstraints(analysis, { roomType: "living_room", floorPlan });
    // With no `home_office` entry and no total_sqft to estimate from, there is
    // no room area at all — which must not silently become the living room's.
    expect(office.room_coverage_ratio).not.toBe(living.room_coverage_ratio);
  });
});
