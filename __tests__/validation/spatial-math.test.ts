import { describe, it, expect } from "vitest";
import { parseDimensions, computeSpatialConstraints } from "@/lib/validation/spatial-math";

describe("parseDimensions", () => {
  it("parses W x D x H with an explicit inches unit", () => {
    expect(parseDimensions("72x36x30 inches")).toEqual({ width: 72, depth: 36, height: 30 });
  });

  it("parses W x D (no height) and leaves height undefined", () => {
    const d = parseDimensions("72 x 36");
    expect(d).toEqual({ width: 72, depth: 36 });
    expect(d?.height).toBeUndefined();
  });

  it("treats a single dimension as square-ish for area estimation", () => {
    expect(parseDimensions("60in")).toEqual({ width: 60, depth: 60 });
  });

  it("accepts the ×, x, and - separators interchangeably", () => {
    expect(parseDimensions("72×36")).toEqual({ width: 72, depth: 36 });
    expect(parseDimensions("72x36")).toEqual({ width: 72, depth: 36 });
    expect(parseDimensions("72-36")).toEqual({ width: 72, depth: 36 });
  });

  it("parses decimal values", () => {
    expect(parseDimensions("72.5x36.25")).toEqual({ width: 72.5, depth: 36.25 });
  });

  it("converts feet to inches (ft / feet / ')", () => {
    expect(parseDimensions("6ft")).toEqual({ width: 72, depth: 72 });
    expect(parseDimensions("6 feet")).toEqual({ width: 72, depth: 72 });
    expect(parseDimensions("6x4 ft")).toEqual({ width: 72, depth: 48 });
  });

  it("converts centimetres to inches", () => {
    const d = parseDimensions("100cm");
    expect(d?.width).toBeCloseTo(39.37, 1);
    expect(d?.depth).toBeCloseTo(39.37, 1);
  });

  it("converts millimetres to inches", () => {
    const d = parseDimensions("1000mm");
    expect(d?.width).toBeCloseTo(39.37, 1);
  });

  it("defaults to inches when no unit is given", () => {
    expect(parseDimensions("48x24")).toEqual({ width: 48, depth: 24 });
  });

  it("returns null when there is no numeric dimension", () => {
    expect(parseDimensions("a comfy linen sofa")).toBeNull();
    expect(parseDimensions("")).toBeNull();
  });

  it("is re-entrant — repeated calls do not drift via the shared regex lastIndex", () => {
    expect(parseDimensions("72x36")).toEqual({ width: 72, depth: 36 });
    expect(parseDimensions("10x10")).toEqual({ width: 10, depth: 10 });
    expect(parseDimensions("72x36")).toEqual({ width: 72, depth: 36 });
  });
});

describe("computeSpatialConstraints", () => {
  it("returns neutral defaults for an empty needs list with no floor plan", () => {
    const r = computeSpatialConstraints({ what_it_needs: [] }, { roomType: "living_room" });
    expect(r.room_coverage_ratio).toBe(0.7);
    expect(r.clearance_score).toBe(0.7); // no clearance checks ran → neutral
    expect(r.violations).toEqual([]);
    expect(r.placement_conflicts).toEqual([]);
    expect(r.per_item_spatial.size).toBe(0);
  });

  it("passes clearance neutrally when room dimensions are unknown", () => {
    const r = computeSpatialConstraints(
      { what_it_needs: [{ category: "sofa", specs: "84x36" }] },
      { roomType: "living_room" },
    );
    // sofa has clearance rules but with no room dims they can't be measured →
    // treated as neutral passes, so no violations and full clearance credit.
    expect(r.violations).toEqual([]);
    expect(r.clearance_score).toBe(1);
    expect(r.per_item_spatial.has("sofa")).toBe(true);
    const score = r.per_item_spatial.get("sofa")!;
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it("flags more than two non-paired items crowded into one placement zone", () => {
    const r = computeSpatialConstraints(
      {
        what_it_needs: [
          { category: "sofa", placement: "north wall" },
          { category: "desk", placement: "north wall" },
          { category: "bookcase", placement: "north wall" },
        ],
      },
      { roomType: "living_room" },
    );
    // 3 unrelated items in the same zone → every pair is a conflict (C(3,2)=3).
    expect(r.placement_conflicts.length).toBe(3);
    for (const c of r.placement_conflicts) expect(c.zone).toBe("north wall");
  });

  it("does not flag two items sharing a zone (a pair is allowed)", () => {
    const r = computeSpatialConstraints(
      {
        what_it_needs: [
          { category: "sofa", placement: "south wall" },
          { category: "desk", placement: "south wall" },
        ],
      },
      { roomType: "living_room" },
    );
    expect(r.placement_conflicts).toEqual([]);
  });

  it("exempts natural furniture pairs from the crowding conflict", () => {
    const r = computeSpatialConstraints(
      {
        what_it_needs: [
          { category: "dining_table", placement: "center" },
          { category: "dining_chair", placement: "center" },
          { category: "vase", placement: "center" },
        ],
      },
      { roomType: "dining_room" },
    );
    // dining_table|dining_chair and vase|dining_table are natural pairs; only
    // dining_chair|vase is left as a conflict.
    expect(r.placement_conflicts.length).toBe(1);
    const pair = [r.placement_conflicts[0].item1, r.placement_conflicts[0].item2].sort();
    expect(pair).toEqual(["dining_chair", "vase"]);
  });
});
