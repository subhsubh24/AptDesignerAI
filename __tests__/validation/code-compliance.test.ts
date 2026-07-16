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

  // ── Egress window (IRC R310.2.1): ≥24" H, ≥20" W, ≥5.7 sq ft openable ──
  it("passes a bedroom egress window meeting all three minimums", () => {
    const result = computeCodeCompliance(
      {},
      {
        roomType: "bedroom",
        floorPlan: { window_height: 24, window_width: 20, egress_window_area: 5.7 },
      },
    );
    const check = result.checks.find((c) => c.code.includes("R310.2.1"));
    expect(check?.passed).toBe(true);
    expect(result.violations.find((v) => v.code === "IRC R310.2.1")).toBeUndefined();
  });

  it("flags an egress window whose height is below 24\"", () => {
    // Height 23 fails (< 24); width + area pass. Proves the `heightOK &&` term:
    // an `&&`→`||` mutation would let this pass on the two OK dimensions.
    const result = computeCodeCompliance(
      {},
      {
        roomType: "bedroom",
        floorPlan: { window_height: 23, window_width: 20, egress_window_area: 5.7 },
      },
    );
    const check = result.checks.find((c) => c.code.includes("R310.2.1"));
    expect(check?.passed).toBe(false);
    expect(result.violations.find((v) => v.code === "IRC R310.2.1")).toBeDefined();
  });

  it("flags an egress window whose width is below 20\"", () => {
    // Width 19 fails (< 20); height + area pass. Together with the height- and
    // area-failure cases this proves all three terms are load-bearing in the
    // `heightOK && widthOK && areaOK` conjunction — a mutant that drops the
    // widthOK term would otherwise pass undetected.
    const result = computeCodeCompliance(
      {},
      {
        roomType: "bedroom",
        floorPlan: { window_height: 24, window_width: 19, egress_window_area: 5.7 },
      },
    );
    const check = result.checks.find((c) => c.code.includes("R310.2.1"));
    expect(check?.passed).toBe(false);
    expect(result.violations.find((v) => v.code === "IRC R310.2.1")).toBeDefined();
  });

  it("flags an egress window whose openable area is below 5.7 sq ft", () => {
    const result = computeCodeCompliance(
      {},
      {
        roomType: "bedroom",
        floorPlan: { egress_window_height: 30, egress_window_width: 24, openable_window_area: 5.6 },
      },
    );
    const check = result.checks.find((c) => c.code.includes("R310.2.1"));
    expect(check?.passed).toBe(false);
  });

  it("skips the egress-window check when no window data is present", () => {
    const result = computeCodeCompliance({}, { roomType: "bedroom", floorPlan: { door_width: 36 } });
    expect(result.checks.find((c) => c.code.includes("R310.2.1"))).toBeUndefined();
  });

  // Partial window data: the check runs (at least one dimension present), and the
  // ABSENT dimensions get benefit-of-the-doubt via the `winX === null ||` guards.
  // The all-present cases above never exercise those null guards. Together these
  // two cases pin all three: dropping `winWidth === null ||` or `winOpenable ===
  // null ||` fails the only-height case; dropping `winHeight === null ||` fails
  // the only-width case. (They also pin the outer `||` guard — a mutant making it
  // `&&` would skip the check entirely on single-dimension data, so `check` would
  // be undefined rather than passing.)
  it("passes a window with only height present (width + area absent are not held against it)", () => {
    // Removing `winWidth === null ||` OR `winOpenable === null ||` makes this fail.
    const result = computeCodeCompliance(
      {},
      { roomType: "bedroom", floorPlan: { window_height: 30 } },
    );
    const check = result.checks.find((c) => c.code.includes("R310.2.1"));
    expect(check?.passed).toBe(true);
    expect(result.violations.find((v) => v.code === "IRC R310.2.1")).toBeUndefined();
  });

  it("passes a window with only width present (height + area absent are not held against it)", () => {
    // Removing `winHeight === null ||` OR `winOpenable === null ||` makes this fail.
    const result = computeCodeCompliance(
      {},
      { roomType: "bedroom", floorPlan: { window_width: 24 } },
    );
    const check = result.checks.find((c) => c.code.includes("R310.2.1"));
    expect(check?.passed).toBe(true);
  });

  // ── Kitchen counter outlet spacing (NEC 210.52(C)): outlets every ≤48" ──
  it("flags a kitchen counter with too few outlets for its length", () => {
    // 100" counter → ceil(100/48) = 3 required; only 2 present → fail. The
    // divisor is load-bearing: ceil(100/50) would require just 2 and pass.
    const result = computeCodeCompliance(
      { kitchen_outlet_count: 2 },
      { roomType: "kitchen", floorPlan: { counter_length: 100 } },
    );
    const check = result.checks.find((c) => c.code.includes("210.52"));
    expect(check?.passed).toBe(false);
    expect(result.violations.find((v) => v.code === "NEC 210.52(C)")).toBeDefined();
  });

  it("passes a kitchen counter with exactly enough outlets", () => {
    // 96" → ceil(96/48) = 2 required; exactly 2 present → pass. Guards the `>=`
    // boundary: a `>`-mutation would fail this equal case.
    const result = computeCodeCompliance(
      { kitchen_outlet_count: 2 },
      { roomType: "kitchen", floorPlan: { countertop_length: 96 } },
    );
    const check = result.checks.find((c) => c.code.includes("210.52"));
    expect(check?.passed).toBe(true);
    expect(result.violations.find((v) => v.code === "NEC 210.52(C)")).toBeUndefined();
  });

  it("skips the kitchen outlet check when counter or outlet data is missing", () => {
    const result = computeCodeCompliance(
      {},
      { roomType: "kitchen", floorPlan: { counter_length: 100 } }, // no outlet count
    );
    expect(result.checks.find((c) => c.code.includes("210.52"))).toBeUndefined();
  });
});
