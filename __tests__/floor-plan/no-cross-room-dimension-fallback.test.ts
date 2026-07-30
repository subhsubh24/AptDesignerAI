import { describe, it, expect } from "vitest";
import { getMockupPrompt } from "@/lib/prompts/mockup";
import { computeSpatialConstraints } from "@/lib/validation/spatial-math";

/**
 * ONE property, asserted at the real consumers rather than at the helper.
 *
 * `building_research.floor_plan.room_dimensions` is keyed by ROOM TYPE. Four
 * readers used to answer a missing entry with `|| living_room` — so a bedroom
 * with no dimensions of its own was silently told it was the size of the living
 * room. That fallback also turned `legacy-room-dimensions.ts`'s deliberate
 * omission of an ambiguous type into something WORSE than the bug it fixed:
 * both bedrooms in a two-bedroom plan would have been handed the living room's
 * size.
 *
 * `legacy-room-dimensions.test.ts` covers the WRITER. This covers the READERS,
 * because removing a `||` is exactly the kind of one-line fix that silently
 * comes back.
 */
describe("no reader falls back to another room's dimensions", () => {
  const floorPlan = { room_dimensions: { living_room: "16 x 20 ft", kitchen: "8 x 10 ft" } };

  describe("the mockup render prompt", () => {
    it("states the room's OWN dimensions when it has them", () => {
      const prompt = getMockupPrompt("kitchen", "summary", ["a stool"], undefined, undefined, {
        floor_plan: floorPlan,
      });
      expect(prompt).toContain("8 x 10 ft");
    });

    it("says NOTHING about dimensions for a room with no entry of its own", () => {
      // `bedroom` is absent — either never extracted, or dropped as ambiguous
      // because two bedrooms disagreed. Either way the living room's 16 x 20 is
      // not an answer to the question, and a wrong size drives wrong furniture
      // scale in the generated image.
      const prompt = getMockupPrompt("bedroom", "summary", ["a bed"], undefined, undefined, {
        floor_plan: floorPlan,
      });
      expect(prompt).not.toContain("16 x 20 ft");
      expect(prompt).not.toMatch(/bedroom dimensions/i);
    });
  });

  describe("the spatial-constraint maths", () => {
    const analysis = { what_it_needs: [{ category: "bed", specs: "60 x 80 in" }] };

    it("computes a coverage ratio from the room's OWN area", () => {
      const withOwn = computeSpatialConstraints(analysis, {
        roomType: "kitchen",
        floorPlan,
      });
      const noPlan = computeSpatialConstraints(analysis, { roomType: "kitchen" });
      // A real area was used, not the "can't compute" default.
      expect(withOwn.room_coverage_ratio).not.toBe(noPlan.room_coverage_ratio);
    });

    it("does NOT silently score a bedroom against the living room's area", () => {
      // The failure this guards is invisible: a wrong area yields a plausible
      // but wrong coverage ratio, which skews the harmony score with nothing on
      // screen to indicate it. Falling back to the default is the honest answer.
      const bedroom = computeSpatialConstraints(analysis, {
        roomType: "bedroom",
        floorPlan,
      });
      const asLivingRoom = computeSpatialConstraints(analysis, {
        roomType: "living_room",
        floorPlan,
      });
      const noPlan = computeSpatialConstraints(analysis, { roomType: "bedroom" });
      expect(bedroom.room_coverage_ratio).not.toBe(asLivingRoom.room_coverage_ratio);
      // ...and it fell back to the honest "can't compute" default instead.
      expect(bedroom.room_coverage_ratio).toBe(noPlan.room_coverage_ratio);
    });
  });
});
