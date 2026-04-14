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
});
