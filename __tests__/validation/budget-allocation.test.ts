import { describe, it, expect } from "vitest";
import { computeBudgetAllocation } from "@/lib/validation/budget-allocation";

describe("computeBudgetAllocation", () => {
  it("flags under-investment on sofa", () => {
    const result = computeBudgetAllocation(
      {},
      {
        roomType: "living_room",
        bundle: [
          { category: "sofa", price: 500 },      // 8% of 6200 — under 22% minimum
          { category: "area_rug", price: 1500 },
          { category: "coffee_table", price: 700 },
          { category: "floor_lamp", price: 500 },
          { category: "wall_art", price: 3000 }, // massively over-spent
        ],
      },
    );
    const sofaRow = result.per_category.find((p) => p.category === "sofa");
    expect(sofaRow?.status).toBe("under");
    expect(result.issues.some((i) => i.category === "sofa")).toBe(true);
  });

  it("reports within-range for balanced allocations", () => {
    const result = computeBudgetAllocation(
      {},
      {
        roomType: "living_room",
        bundle: [
          { category: "sofa", price: 2000 },         // ~33% of 6000
          { category: "area_rug", price: 800 },      // ~13%
          { category: "coffee_table", price: 500 },  // ~8%
          { category: "media_console", price: 600 }, // ~10%
          { category: "accent_chair", price: 700 },  // ~12%
          { category: "floor_lamp", price: 300 },    // ~5%
          { category: "wall_art", price: 500 },      // ~8%
        ],
      },
    );
    expect(result.score).toBeGreaterThan(0.6);
  });

  it("warns when no prices available", () => {
    const result = computeBudgetAllocation(
      { what_it_needs: [{ category: "sofa" }] },
      { roomType: "living_room" },
    );
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("returns non-fatal default for unknown room types", () => {
    const result = computeBudgetAllocation(
      {},
      { roomType: "atrium", bundle: [{ category: "plant", price: 200 }] },
    );
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });
});
