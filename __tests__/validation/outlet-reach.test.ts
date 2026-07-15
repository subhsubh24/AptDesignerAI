import { describe, it, expect } from "vitest";
import { computeOutletReach, getOutletReachIssuesForItem } from "@/lib/validation/outlet-reach";

describe("computeOutletReach", () => {
  it("flags a lamp placed on a wall with no outlets", () => {
    const analysis = {
      outlet_positions: "outlets on north wall flanking window",
      what_it_needs: [
        { category: "floor_lamp", placement: "south wall, next to accent chair" },
      ],
    };
    const result = computeOutletReach(analysis);
    expect(result.per_item.length).toBe(1);
    expect(result.per_item[0].reachable).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it("passes a TV placed on the same wall as an outlet", () => {
    const analysis = {
      outlet_positions: "north wall has 2 outlets near window",
      what_it_needs: [
        { category: "tv", placement: "north wall, mounted above media console" },
      ],
    };
    const result = computeOutletReach(analysis);
    expect(result.per_item[0].reachable).toBe(true);
  });

  it("skips items with no outlet_positions context", () => {
    const analysis = {
      what_it_needs: [{ category: "floor_lamp", placement: "south wall" }],
    };
    const result = computeOutletReach(analysis);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("does not check non-powered items (e.g., sofa)", () => {
    const analysis = {
      outlet_positions: "north wall outlets",
      what_it_needs: [{ category: "sofa", placement: "south wall" }],
    };
    const result = computeOutletReach(analysis);
    // sofa is not powered, should not appear
    expect(result.per_item.find((p) => p.category === "sofa")).toBeUndefined();
  });

  it("surfaces issues per item", () => {
    const analysis = {
      outlet_positions: "north wall near window",
      what_it_needs: [
        { category: "floor_lamp", placement: "south wall corner" },
      ],
    };
    const result = computeOutletReach(analysis);
    expect(getOutletReachIssuesForItem(result, "floor_lamp").length).toBeGreaterThan(0);
  });

  it("does not require an outlet for a hardwired fixture (chandelier)", () => {
    // A chandelier is POWERED but HARDWIRED — it draws from a ceiling junction
    // box, not a wall outlet — so it must be skipped even when its placement
    // shares no zone with any outlet. Guards the `|| isHardwired` skip clause:
    // dropping it would flag the chandelier as unreachable.
    const analysis = {
      outlet_positions: "north wall outlets near window",
      what_it_needs: [
        { category: "chandelier", placement: "south wall, center of ceiling" },
      ],
    };
    const result = computeOutletReach(analysis);
    expect(result.per_item.find((p) => p.category.includes("chandelier"))).toBeUndefined();
    expect(result.issues.find((i) => i.category.includes("chandelier"))).toBeUndefined();
  });

  it("treats a soft-anchor outlet (corner) as reachable from a wall placement", () => {
    // Outlet zone is purely a soft anchor (corner) and the item is on a cardinal
    // wall with no shared zone. zonesIntersect falls back to `aSoft || bSoft` and
    // gives the benefit of the doubt. Guards that OR: mutating it to `aSoft &&
    // bSoft` would mark the lamp unreachable.
    const analysis = {
      outlet_positions: "outlet in the corner",
      what_it_needs: [
        { category: "floor_lamp", placement: "north wall, beside the sofa" },
      ],
    };
    const result = computeOutletReach(analysis);
    const item = result.per_item.find((p) => p.category.includes("floor_lamp"));
    expect(item?.reachable).toBe(true);
    expect(result.issues.length).toBe(0);
  });

  it("gives vague placements the benefit of the doubt (no hard penalty)", () => {
    // Powered, non-hardwired item whose placement tokenizes to zero zones: the
    // checker must surface a soft, non-penalizing entry (reachable: true) rather
    // than flag an unreachable issue.
    const analysis = {
      outlet_positions: "north wall outlets",
      what_it_needs: [
        { category: "table_lamp", placement: "somewhere convenient" },
      ],
    };
    const result = computeOutletReach(analysis);
    const item = result.per_item.find((p) => p.category.includes("table_lamp"));
    expect(item?.reachable).toBe(true);
    expect(item?.placement_zones).toEqual([]);
    expect(item?.reason).toMatch(/vague/i);
    expect(result.issues.length).toBe(0);
  });
});
