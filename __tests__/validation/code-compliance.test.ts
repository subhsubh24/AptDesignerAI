import { describe, it, expect } from "vitest";
import { computeCodeCompliance } from "@/lib/validation/code-compliance";

describe("computeCodeCompliance", () => {
  it("flags bedroom door narrower than 32\"", () => {
    const result = computeCodeCompliance(
      {},
      {
        roomType: "bedroom",
        floorPlan: { door_width: 28 },
      },
    );
    const check = result.checks.find((c) => c.code.includes("R310.2.3"));
    expect(check?.passed).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
  });

  it("passes bedroom door ≥ 32\"", () => {
    const result = computeCodeCompliance(
      {},
      {
        roomType: "bedroom",
        floorPlan: { door_width: 36 },
      },
    );
    const check = result.checks.find((c) => c.code.includes("R310.2.3"));
    expect(check?.passed).toBe(true);
  });

  it("flags glazing short of 8% of floor area", () => {
    const result = computeCodeCompliance(
      {},
      {
        roomType: "bedroom",
        floorPlan: { total_sqft: 150, glazing_area: 5 }, // needs 12
      },
    );
    const check = result.checks.find((c) => c.code.includes("natural light"));
    expect(check?.passed).toBe(false);
  });

  it("flags ADA turning diameter < 60\" when accessibleUnit=true", () => {
    const result = computeCodeCompliance(
      {},
      {
        roomType: "bedroom",
        floorPlan: { clear_floor_diameter: 48 },
        accessibleUnit: true,
      },
    );
    const check = result.checks.find((c) => c.code.includes("304.3.1"));
    expect(check?.passed).toBe(false);
  });

  it("skips ADA checks when accessibleUnit is false", () => {
    const result = computeCodeCompliance(
      {},
      {
        roomType: "bedroom",
        floorPlan: { clear_floor_diameter: 40 },
        accessibleUnit: false,
      },
    );
    const check = result.checks.find((c) => c.code.includes("304.3.1"));
    expect(check).toBeUndefined();
  });

  it("warns when no checkable data is supplied", () => {
    const result = computeCodeCompliance({}, { roomType: "living_room" });
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
