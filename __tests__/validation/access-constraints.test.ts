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
});
