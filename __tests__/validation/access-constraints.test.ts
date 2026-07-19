import { describe, it, expect } from "vitest";
import { computeAccessConstraints, getAccessIssuesForItem } from "@/lib/validation/access-constraints";

describe("computeAccessConstraints", () => {
  it("flags a sofa that cannot fit through a narrow entry door", () => {
    const analysis = {
      what_it_needs: [
        // A deep sectional; narrowest dim is 34" height, door is only 30"
        { category: "sectional", specs: "120 x 40 x 34 inches" },
      ],
    };
    const result = computeAccessConstraints(analysis, {
      buildingResearch: { entry_door_width: 30 },
    });
    expect(result.per_item.length).toBe(1);
    expect(result.per_item[0].passed).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it("passes a sofa whose narrowest dim fits the door", () => {
    const analysis = {
      what_it_needs: [
        { category: "sofa", specs: "84 x 35 x 32 inches" },
      ],
    };
    const result = computeAccessConstraints(analysis, {
      buildingResearch: { entry_door_width: 36 },
    });
    expect(result.per_item[0].passed).toBe(true);
  });

  it("warns when no access data is provided", () => {
    const analysis = {
      what_it_needs: [{ category: "sofa", specs: "84 x 35 x 32 inches" }],
    };
    const result = computeAccessConstraints(analysis, {});
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("parses entry_door_width from text like '32 inches'", () => {
    const analysis = {
      what_it_needs: [{ category: "sofa", specs: "84 x 40 x 32 inches" }],
    };
    const result = computeAccessConstraints(analysis, {
      buildingResearch: { entry_door_width: "32 inches" },
    });
    expect(result.per_item.length).toBeGreaterThan(0);
  });

  it("uses elevator width when it is tightest", () => {
    const analysis = {
      what_it_needs: [{ category: "sofa", specs: "84 x 38 x 40 inches" }],
    };
    const result = computeAccessConstraints(analysis, {
      buildingResearch: { entry_door_width: 42, elevator_width: 36 },
    });
    expect(result.per_item[0].reason).toContain("elevator");
  });

  it("surfaces issues per item", () => {
    const analysis = {
      what_it_needs: [{ category: "sectional", specs: "120 x 40 x 34 inches" }],
    };
    const result = computeAccessConstraints(analysis, {
      buildingResearch: { entry_door_width: 30 },
    });
    expect(getAccessIssuesForItem(result, "sectional").length).toBeGreaterThan(0);
  });

  // The walk-up (no-elevator) stairwell heuristic: a tight stair turn caps the
  // effective opening at 36" for a tilted sofa, EVEN when the entry door is wide.
  // This branch (constraints.stairwell_turn && has_elevator === false) is the
  // difference between a wide-door apartment that passes and a 5th-floor walk-up
  // that can't take delivery — silently wrong furniture recs if it regresses.
  it("applies the 36\" stairwell cap on a no-elevator walk-up despite a wide door", () => {
    const analysis = {
      // narrowest dim is 38" — clears a 42" door, but not a 36" stair turn
      what_it_needs: [{ category: "sofa", specs: "84 x 38 x 40 inches" }],
    };
    const result = computeAccessConstraints(analysis, {
      buildingResearch: { entry_door_width: 42, stairwell_turn: true, has_elevator: false },
    });
    expect(result.per_item[0].passed).toBe(false);
    expect(result.per_item[0].min_access_dim).toBe(36);
  });

  it("does NOT apply the stairwell cap when an elevator is present", () => {
    const analysis = {
      what_it_needs: [{ category: "sofa", specs: "84 x 38 x 40 inches" }],
    };
    const result = computeAccessConstraints(analysis, {
      // same tight stair, but the elevator makes the 36" heuristic irrelevant
      buildingResearch: { entry_door_width: 42, stairwell_turn: true, has_elevator: true },
    });
    expect(result.per_item[0].passed).toBe(true);
    expect(result.per_item[0].min_access_dim).toBe(42);
  });

  // The elevator-cab DIAGONAL check: a long sofa may clear the door/cab WIDTH yet
  // not lie down inside a shallow cab (needed depth ≈ 70% of the longest dim).
  // Depth values are pinned tight around the 84×0.7 = 58.8" needed-depth so the
  // pair also kills near-boundary mutations of the 0.7 diagonal factor (a cab of
  // 58" flags, 60" clears — bounding the factor to ~(0.69, 0.71]), not just the
  // gross "branch removed / comparison flipped" mutations.
  it("flags a long sofa that won't fit diagonally in a shallow elevator cab", () => {
    const analysis = {
      // fits the 60" opening on its 34" dim, but 84" long needs ~58.8" cab depth
      what_it_needs: [{ category: "sofa", specs: "84 x 38 x 34 inches" }],
    };
    const result = computeAccessConstraints(analysis, {
      buildingResearch: { elevator_width: 60, elevator_depth: 58 },
    });
    expect(result.per_item[0].passed).toBe(true); // width fits
    expect(result.issues.some((i) => /diagonally|elevator cab/.test(i.issue))).toBe(true);
  });

  it("does NOT flag the diagonal when the elevator cab is deep enough", () => {
    const analysis = {
      what_it_needs: [{ category: "sofa", specs: "84 x 38 x 34 inches" }],
    };
    const result = computeAccessConstraints(analysis, {
      buildingResearch: { elevator_width: 60, elevator_depth: 60 },
    });
    expect(result.issues.some((i) => /diagonally|elevator cab/.test(i.issue))).toBe(false);
  });

  it("returns the neutral 0.9 default score when no large items are checkable", () => {
    // A room whose needs are all SMALL accents (none in LARGE_ITEM_CATEGORIES) runs
    // zero delivery-fit checks, so the score falls to the neutral 0.9 default. This
    // is a common real input (styling passes, no furniture) and the default feeds
    // harmony-math's composite — pin it so a mutation of the 0.9 constant is caught.
    const analysis = {
      what_it_needs: [
        { category: "table_lamp", specs: "18 inches tall" },
        { category: "rug", specs: "60 x 96 inches" },
      ],
    };
    const result = computeAccessConstraints(analysis, {
      buildingResearch: { entry_door_width: 32 },
    });
    expect(result.per_item.length).toBe(0);
    expect(result.score).toBe(0.9);
  });
});
