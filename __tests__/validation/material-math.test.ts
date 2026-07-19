/**
 * Tests for lib/validation/material-math.ts
 *
 * computeMaterialBalance: wood-species conflict detection, metal-finish
 * warm/cool mixing, soft-to-hard ratio against ideal room-type bands,
 * material property variance, and cross-room constraint propagation.
 *
 * All assertions are unconditional — no if(condition){expect} patterns.
 */

import { describe, it, expect } from "vitest";
import { computeMaterialBalance } from "../../lib/validation/material-math";

// ─── Helpers ────────────────────────────────────────────────────

function emptyAnalysis(): Record<string, unknown> {
  return {};
}

function ctx(roomType = "living_room") {
  return { roomType };
}

// ─── Output shape and bounds ─────────────────────────────────────

describe("computeMaterialBalance — output shape and bounds", () => {
  it("returns all required fields for an empty analysis", () => {
    const result = computeMaterialBalance(emptyAnalysis(), ctx());
    expect(result.material_balance).toBeGreaterThanOrEqual(0);
    expect(result.material_balance).toBeLessThanOrEqual(1);
    expect(result.wood_coherence).toBeGreaterThanOrEqual(0);
    expect(result.wood_coherence).toBeLessThanOrEqual(1);
    expect(result.metal_coherence).toBeGreaterThanOrEqual(0);
    expect(result.metal_coherence).toBeLessThanOrEqual(1);
    expect(result.soft_hard_ratio).toBeGreaterThanOrEqual(0);
    expect(result.soft_hard_ratio).toBeLessThanOrEqual(1);
    expect(Array.isArray(result.conflicts)).toBe(true);
  });

  it("returns neutral defaults for an empty analysis", () => {
    const result = computeMaterialBalance(emptyAnalysis(), ctx());
    // material_balance falls back to 0.7 when < 2 materials resolved
    expect(result.material_balance).toBe(0.7);
    // No wood or metal → fully coherent
    expect(result.wood_coherence).toBe(1.0);
    expect(result.metal_coherence).toBe(1.0);
    // No items → softHardRatio stays at default 0.7
    expect(result.soft_hard_ratio).toBe(0.7);
    // No conflicts
    expect(result.conflicts).toHaveLength(0);
  });
});

// ─── Wood species coherence ──────────────────────────────────────

describe("wood coherence", () => {
  it("returns 1.0 when there is one wood species in recommended_materials", () => {
    const result = computeMaterialBalance(
      { recommended_materials: ["walnut"] },
      ctx(),
    );
    expect(result.wood_coherence).toBe(1.0);
    expect(result.conflicts).toHaveLength(0);
  });

  it("returns 1.0 when there are exactly two wood species", () => {
    const result = computeMaterialBalance(
      { recommended_materials: ["walnut", "oak"] },
      ctx(),
    );
    expect(result.wood_coherence).toBe(1.0);
    expect(result.conflicts.filter((c) => /wood species/i.test(c.issue))).toHaveLength(0);
  });

  it("penalizes and adds a conflict when there are 3 wood species", () => {
    // walnut + oak (via recommended_materials) + maple (via what_it_needs specs)
    const result = computeMaterialBalance(
      {
        recommended_materials: ["walnut", "oak"],
        what_it_needs: [
          { category: "nightstand", specs: "solid maple with brass hardware" },
        ],
      },
      ctx(),
    );
    expect(result.wood_coherence).toBeLessThan(1.0);
    expect(result.conflicts.some((c) => /3 wood species/i.test(c.issue))).toBe(true);
  });

  it("applies a progressive penalty for 4 wood species", () => {
    const threeResult = computeMaterialBalance(
      { recommended_materials: ["walnut", "oak", "maple"] },
      ctx(),
    );
    const fourResult = computeMaterialBalance(
      { recommended_materials: ["walnut", "oak", "maple", "cherry"] },
      ctx(),
    );
    expect(fourResult.wood_coherence).toBeLessThan(threeResult.wood_coherence);
  });

  it("detects wood species in what_it_needs specs (not just recommended_materials)", () => {
    const result = computeMaterialBalance(
      {
        recommended_materials: ["walnut", "oak"],
        what_it_needs: [
          { category: "desk", specs: "ash wood frame with steel legs" },
        ],
      },
      ctx(),
    );
    // ash = 3rd species → conflict
    expect(result.wood_coherence).toBeLessThan(1.0);
  });
});

// ─── Metal finish coherence ──────────────────────────────────────

describe("metal coherence", () => {
  it("returns 1.0 when only warm metals are present", () => {
    // brass + copper — both warm
    const result = computeMaterialBalance(
      { recommended_materials: ["brass", "copper"] },
      ctx(),
    );
    expect(result.metal_coherence).toBe(1.0);
    expect(result.conflicts.filter((c) => /metal/i.test(c.issue))).toHaveLength(0);
  });

  it("returns 1.0 when only cool metals are present", () => {
    // brushed nickel + chrome — both cool
    const result = computeMaterialBalance(
      { recommended_materials: ["brushed nickel", "chrome"] },
      ctx(),
    );
    expect(result.metal_coherence).toBe(1.0);
    expect(result.conflicts.filter((c) => /metal/i.test(c.issue))).toHaveLength(0);
  });

  it("returns 0.6 and adds a conflict when warm and cool metals are mixed", () => {
    // brass (warm) + chrome (cool)
    const result = computeMaterialBalance(
      { recommended_materials: ["brass", "chrome"] },
      ctx(),
    );
    expect(result.metal_coherence).toBe(0.6);
    expect(result.conflicts.some((c) => /warm.*cool metals|mixing warm/i.test(c.issue))).toBe(true);
  });

  it("caps metal coherence at 0.5 when more than 3 metals are used", () => {
    // 4 warm metals (brass, copper, bronze, gold) — coherence would be 1.0 for all-warm,
    // but > 3 metals triggers the cap at 0.5
    const result = computeMaterialBalance(
      { recommended_materials: ["brass", "copper", "bronze", "gold"] },
      ctx(),
    );
    expect(result.metal_coherence).toBeLessThanOrEqual(0.5);
  });

  it("detects metal finishes from what_it_needs specs", () => {
    // brass in recommended + chrome in specs → warm+cool conflict
    const result = computeMaterialBalance(
      {
        recommended_materials: ["brass"],
        what_it_needs: [
          { category: "side_table", specs: "chrome base with marble top" },
        ],
      },
      ctx(),
    );
    expect(result.metal_coherence).toBe(0.6);
    expect(result.conflicts.some((c) => /metal/i.test(c.issue))).toBe(true);
  });
});

// ─── Soft-to-hard ratio ───────────────────────────────────────────

describe("soft-hard ratio", () => {
  it("returns 1.0 for a living room with 50% soft items (within 40-60% band)", () => {
    // 2 soft + 2 hard = 50% soft — ideal for living_room [0.40, 0.60]
    const result = computeMaterialBalance(
      {
        what_it_needs: [
          { category: "area_rug", specs: "" },        // soft (category match)
          { category: "throw_pillows", specs: "" },   // soft (category match)
          { category: "sofa", specs: "" },            // hard
          { category: "coffee_table", specs: "" },    // hard
        ],
      },
      ctx("living_room"),
    );
    expect(result.soft_hard_ratio).toBe(1.0);
  });

  it("returns below 1.0 for a living room with 0% soft items", () => {
    const result = computeMaterialBalance(
      {
        what_it_needs: [
          { category: "sofa", specs: "" },
          { category: "coffee_table", specs: "" },
          { category: "media_console", specs: "" },
        ],
      },
      ctx("living_room"),
    );
    // 0 soft / 3 total = 0% → below ideal [40-60%]
    expect(result.soft_hard_ratio).toBeLessThan(1.0);
    expect(result.soft_hard_ratio).toBeGreaterThanOrEqual(0.5);
  });

  it("uses bedroom ideal band [50-70%] for bedroom room type", () => {
    // bedroom: 2 soft + 2 hard = 50% → at the lower boundary of [0.50, 0.70]
    const result = computeMaterialBalance(
      {
        what_it_needs: [
          { category: "bedding", specs: "" },     // soft
          { category: "curtains", specs: "" },    // soft
          { category: "dresser", specs: "" },     // hard
          { category: "nightstand", specs: "" },  // hard
        ],
      },
      ctx("bedroom"),
    );
    expect(result.soft_hard_ratio).toBe(1.0);
  });

  it("returns 0.7 default when what_it_needs is empty", () => {
    const result = computeMaterialBalance(emptyAnalysis(), ctx());
    expect(result.soft_hard_ratio).toBe(0.7);
  });

  it("identifies soft items by material keyword in specs", () => {
    // sofa is not in SOFT_CATEGORIES, but its single-word spec "velvet" is in SOFT_MATERIALS
    // → counted as soft. With 1 soft + 1 hard the ratio hits 50%, within [40-60%] → 1.0.
    const withVelvet = computeMaterialBalance(
      {
        what_it_needs: [
          { category: "sofa", specs: "velvet" },
          { category: "coffee_table", specs: "" },
        ],
      },
      ctx("living_room"),
    );
    // With "oak" instead — oak is hard (not in SOFT_MATERIALS) → 0 soft, 2 hard → below band
    const withOak = computeMaterialBalance(
      {
        what_it_needs: [
          { category: "sofa", specs: "oak" },
          { category: "coffee_table", specs: "" },
        ],
      },
      ctx("living_room"),
    );
    expect(withVelvet.soft_hard_ratio).toBe(1.0);
    expect(withOak.soft_hard_ratio).toBeLessThan(1.0);
  });
});

// ─── Material distribution balance ───────────────────────────────

describe("material distribution balance", () => {
  it("returns 0.7 when there is only one resolved material", () => {
    const result = computeMaterialBalance(
      { recommended_materials: ["walnut"] },
      ctx(),
    );
    expect(result.material_balance).toBe(0.7);
  });

  it("returns 1.0 for materials with good variance across property axes", () => {
    // walnut (warm/rough/medium sheen/heavy) + marble (cool/smooth/very shiny/very heavy)
    // + linen (warm/rough/matte/light) — high variance → balance = 1.0
    const result = computeMaterialBalance(
      { recommended_materials: ["walnut", "marble", "linen"] },
      ctx(),
    );
    expect(result.material_balance).toBe(1.0);
  });

  it("returns below 1.0 for two near-identical materials (low variance)", () => {
    // white oak vs oak — very similar property vectors → variance < 0.03 → monotonous
    const result = computeMaterialBalance(
      { recommended_materials: ["oak", "white oak"] },
      ctx(),
    );
    // Low variance → 0.7 + 0.3*(avgVariance/0.03) which is < 1.0
    expect(result.material_balance).toBeLessThan(1.0);
    expect(result.material_balance).toBeGreaterThanOrEqual(0.7);
  });
});

// ─── Cross-room constraints ───────────────────────────────────────

describe("cross-room material constraints", () => {
  it("adds an apartment-wide wood conflict when other rooms already use 2 species", () => {
    // Other rooms: walnut + oak (2 species). This room introduces maple → 3 total
    const result = computeMaterialBalance(
      { recommended_materials: ["maple"] },
      {
        roomType: "bedroom",
        otherRooms: [{ materials: ["walnut", "oak"] }],
      },
    );
    expect(result.conflicts.some((c) => /apartment-wide.*wood species/i.test(c.issue))).toBe(true);
    // wood_coherence should be penalized
    expect(result.wood_coherence).toBeLessThan(1.0);
  });

  it("adds an apartment-wide metal conflict when this room's metals contradict other rooms", () => {
    // Other rooms: only brass (warm). This room introduces chrome (cool)
    const result = computeMaterialBalance(
      { recommended_materials: ["chrome"] },
      {
        roomType: "bedroom",
        otherRooms: [{ materials: ["brass"] }],
      },
    );
    expect(
      result.conflicts.some((c) => /apartment-wide.*metal.*inconsistent/i.test(c.issue)),
    ).toBe(true);
  });

  it("adds an apartment-wide metal conflict in the REVERSE direction (cool apartment, warm room)", () => {
    // Other rooms: only chrome (cool). This room introduces brass (warm).
    // Exercises the second arm of the OR in material-math (apartmentCool &&
    // !apartmentWarm && thisRoomWarm && !thisRoomCool) — the mirror of the case
    // above, previously uncovered so a mutation dropping that arm went unnoticed.
    const result = computeMaterialBalance(
      { recommended_materials: ["brass"] },
      {
        roomType: "bedroom",
        otherRooms: [{ materials: ["chrome"] }],
      },
    );
    expect(
      result.conflicts.some((c) => /apartment-wide.*metal.*inconsistent/i.test(c.issue)),
    ).toBe(true);
    // The offending metal message names this room as the warm one.
    expect(
      result.conflicts.some((c) => /this room uses warm metals/i.test(c.issue)),
    ).toBe(true);
  });

  it("does NOT add a cross-room conflict when metal temperatures are consistent", () => {
    // Other rooms: only brass (warm). This room: copper (warm) — same temperature
    const result = computeMaterialBalance(
      { recommended_materials: ["copper"] },
      {
        roomType: "bedroom",
        otherRooms: [{ materials: ["brass"] }],
      },
    );
    expect(
      result.conflicts.filter((c) => /apartment-wide.*metal/i.test(c.issue)),
    ).toHaveLength(0);
  });

  it("does NOT add a cross-room conflict when there are no other rooms", () => {
    const result = computeMaterialBalance(
      { recommended_materials: ["walnut", "oak", "maple"] },
      ctx(), // no otherRooms
    );
    // Only intra-room conflict (3 species), NOT an apartment-wide one
    const conflicts = result.conflicts.filter((c) => /apartment-wide/i.test(c.issue));
    expect(conflicts).toHaveLength(0);
  });
});
