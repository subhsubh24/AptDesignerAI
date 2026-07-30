import { describe, it, expect } from "vitest";
import {
  buildLegacyRoomDimensions,
  mergeLegacyRoomDimensions,
} from "@/lib/floor-plan/legacy-room-dimensions";

/**
 * The property under test is NOT "the map is built" — it is that the map never
 * answers with a DIFFERENT room's size. Every reader looks this map up by room
 * type (mockups, search, search/stream, the focus page), and the mockup reader
 * states the invariant explicitly: "do NOT fall back to another room's dims".
 * A two-bedroom apartment is the case that breaks a naive last-write-wins map.
 */
describe("buildLegacyRoomDimensions", () => {
  it("keeps a room type that resolves to exactly one size", () => {
    const { dimensions, ambiguousTypes } = buildLegacyRoomDimensions([
      { room_type: "living_room", dimensions_text: "16 × 20 ft" },
      { room_type: "bedroom", dimensions_text: "10 × 12 ft" },
    ]);
    expect(dimensions).toEqual({
      living_room: "16 × 20 ft",
      bedroom: "10 × 12 ft",
    });
    expect(ambiguousTypes).toEqual([]);
  });

  it("DROPS a type whose rooms disagree instead of letting the last one win", () => {
    const { dimensions, ambiguousTypes } = buildLegacyRoomDimensions([
      { room_type: "bedroom", dimensions_text: "10 × 12 ft" },
      { room_type: "bedroom", dimensions_text: "12 × 14 ft" },
      { room_type: "kitchen", dimensions_text: "8 × 10 ft" },
    ]);
    // The first bedroom must not be told it is 12 × 14, nor the second 10 × 12.
    expect(dimensions).not.toHaveProperty("bedroom");
    expect(dimensions).toEqual({ kitchen: "8 × 10 ft" });
    expect(ambiguousTypes).toEqual(["bedroom"]);
  });

  it("keeps a duplicated type when both rooms report the SAME size", () => {
    // Collapsing identical values loses nothing, so the hint is still correct.
    const { dimensions, ambiguousTypes } = buildLegacyRoomDimensions([
      { room_type: "bedroom", dimensions_text: "10 × 12 ft" },
      { room_type: "bedroom", dimensions_text: "10 × 12 ft" },
    ]);
    expect(dimensions).toEqual({ bedroom: "10 × 12 ft" });
    expect(ambiguousTypes).toEqual([]);
  });

  it("treats whitespace-only differences as the same size", () => {
    const { dimensions, ambiguousTypes } = buildLegacyRoomDimensions([
      { room_type: "bedroom", dimensions_text: "10 × 12 ft" },
      { room_type: "bedroom", dimensions_text: "  10 × 12 ft  " },
    ]);
    expect(dimensions).toEqual({ bedroom: "10 × 12 ft" });
    expect(ambiguousTypes).toEqual([]);
  });

  it("ignores rooms with no dimensions rather than counting them as a disagreement", () => {
    // A plan that labels one bedroom and leaves the other unmeasured still has
    // exactly one known size — suppressing it would lose a correct hint.
    const { dimensions, ambiguousTypes } = buildLegacyRoomDimensions([
      { room_type: "bedroom", dimensions_text: "10 × 12 ft" },
      { room_type: "bedroom" },
      { room_type: "bedroom", dimensions_text: "   " },
    ]);
    expect(dimensions).toEqual({ bedroom: "10 × 12 ft" });
    expect(ambiguousTypes).toEqual([]);
  });

  it("skips rooms with a blank room_type", () => {
    const { dimensions } = buildLegacyRoomDimensions([
      { room_type: "  ", dimensions_text: "10 × 12 ft" },
    ]);
    expect(dimensions).toEqual({});
  });

  it("returns an empty map for missing/empty input", () => {
    expect(buildLegacyRoomDimensions(undefined)).toEqual({
      dimensions: {},
      ambiguousTypes: [],
    });
    expect(buildLegacyRoomDimensions([])).toEqual({
      dimensions: {},
      ambiguousTypes: [],
    });
  });
});

describe("mergeLegacyRoomDimensions", () => {
  it("preserves stored entries the new extraction did not see", () => {
    const merged = mergeLegacyRoomDimensions(
      { balcony: "4 × 8 ft" },
      [{ room_type: "kitchen", dimensions_text: "8 × 10 ft" }],
    );
    expect(merged).toEqual({ balcony: "4 × 8 ft", kitchen: "8 × 10 ft" });
  });

  it("overwrites a stored entry with the newly extracted size", () => {
    const merged = mergeLegacyRoomDimensions(
      { kitchen: "7 × 9 ft" },
      [{ room_type: "kitchen", dimensions_text: "8 × 10 ft" }],
    );
    expect(merged).toEqual({ kitchen: "8 × 10 ft" });
  });

  it("REMOVES a stored entry for a type this extraction found ambiguous", () => {
    // The regression this closes: an earlier single-bedroom plan stored
    // bedroom: "10 × 12 ft". A re-upload reveals two bedrooms of different
    // sizes. Leaving the stored value in place would keep answering "10 × 12"
    // for BOTH bedrooms — the exact misattribution the drop is here to stop.
    const merged = mergeLegacyRoomDimensions({ bedroom: "10 × 12 ft" }, [
      { room_type: "bedroom", dimensions_text: "10 × 12 ft" },
      { room_type: "bedroom", dimensions_text: "12 × 14 ft" },
    ]);
    expect(merged).not.toHaveProperty("bedroom");
    expect(merged).toEqual({});
  });

  it("does not mutate the stored map it was handed", () => {
    const existing = { bedroom: "10 × 12 ft" };
    mergeLegacyRoomDimensions(existing, [
      { room_type: "bedroom", dimensions_text: "10 × 12 ft" },
      { room_type: "bedroom", dimensions_text: "12 × 14 ft" },
    ]);
    expect(existing).toEqual({ bedroom: "10 × 12 ft" });
  });

  it("tolerates a missing stored map", () => {
    expect(
      mergeLegacyRoomDimensions(undefined, [
        { room_type: "kitchen", dimensions_text: "8 × 10 ft" },
      ]),
    ).toEqual({ kitchen: "8 × 10 ft" });
  });
});
