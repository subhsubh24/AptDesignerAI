import { describe, it, expect } from "vitest";
import { computeProportionScores } from "@/lib/validation/proportion-math";

// Helper: build a `what_it_needs` analysis object the scorer consumes.
function analysis(items: Array<{ category: string; specs?: string; placement?: string }>) {
  return { what_it_needs: items } as Record<string, unknown>;
}

describe("computeProportionScores — defaults & empty input", () => {
  it("returns neutral defaults when nothing is provided", () => {
    const r = computeProportionScores({}, {});
    // No rug → 0.8 default; no height-checkable items → 0.8; balance is a constant.
    expect(r.rug_coverage).toBe(0.8);
    expect(r.height_relationships).toBe(0.8);
    expect(r.visual_balance).toBe(0.8);
    expect(r.issues).toEqual([]);
  });

  it("treats a missing what_it_needs array the same as empty", () => {
    const r = computeProportionScores({ what_it_needs: undefined }, { roomType: "living_room" });
    expect(r.rug_coverage).toBe(0.8);
    expect(r.height_relationships).toBe(0.8);
    expect(r.issues).toHaveLength(0);
  });
});

describe("computeProportionScores — rug coverage", () => {
  it("keeps full coverage when the rug extends well beyond the sofa and coffee table", () => {
    const r = computeProportionScores(
      analysis([
        { category: "area rug", specs: "120x96 inches" },
        { category: "sofa", specs: "84x36 inches" },
        // Rule keys are underscored ("coffee_table"); the match is a substring
        // include, so the category must use that exact token to be checked.
        { category: "coffee_table", specs: "40x20x18 inches" },
      ]),
      { roomType: "living_room" },
    );
    // sofa ext = min((120-84)/2, (96-36)/2) = 18 ≥ 6; coffee_table ext =
    // min((120-40)/2, (96-20)/2) = 38 ≥ 12 → both pass, no penalty.
    expect(r.rug_coverage).toBe(1);
    expect(r.issues.find((i) => i.item.includes("rug"))).toBeUndefined();
  });

  it("penalizes and flags a rug that barely extends past the sofa", () => {
    const r = computeProportionScores(
      analysis([
        { category: "rug", specs: "90x40 inches" },
        { category: "sofa", specs: "84x36 inches" },
      ]),
      { roomType: "living_room" },
    );
    // width ext = (90-84)/2 = 3 < 6 → -0.2 → 0.8, and an issue is recorded.
    expect(r.rug_coverage).toBeCloseTo(0.8, 5);
    expect(r.issues.length).toBeGreaterThan(0);
    expect(r.issues[0].issue).toMatch(/extends only/i);
  });

  it("leaves coverage at the default when the rug has no parseable specs", () => {
    const r = computeProportionScores(
      analysis([
        { category: "rug", specs: "a nice big one" },
        { category: "sofa", specs: "84x36 inches" },
      ]),
      { roomType: "living_room" },
    );
    expect(r.rug_coverage).toBe(0.8);
    expect(r.issues).toHaveLength(0);
  });

  it("applies one −0.2 penalty per undersized related item", () => {
    const r = computeProportionScores(
      analysis([
        // Rug smaller than all three living-room rule items (sofa/chair/coffee_table)
        // → three −0.2 penalties: 1.0 − 0.6 = 0.4 (still above the 0.3 floor).
        { category: "rug", specs: "50x40 inches" },
        { category: "sofa", specs: "84x36 inches" },
        { category: "chair", specs: "60x36 inches" },
        { category: "coffee_table", specs: "48x30 inches" },
      ]),
      { roomType: "living_room" },
    );
    expect(r.rug_coverage).toBeCloseTo(0.4, 5);
    expect(r.issues.length).toBe(3);
    expect(r.rug_coverage).toBeGreaterThanOrEqual(0.3);
  });
});

describe("computeProportionScores — height relationships", () => {
  it("gives full marks when a coffee table sits at the target height", () => {
    const r = computeProportionScores(
      analysis([{ category: "coffee_table", specs: "40x20x18 inches" }]),
      { roomType: "living_room" },
    );
    // target 18 ±2, actual 18 → no deviation.
    expect(r.height_relationships).toBe(1);
    expect(r.issues).toHaveLength(0);
  });

  it("penalizes and flags a coffee table that is far too tall", () => {
    const r = computeProportionScores(
      analysis([{ category: "coffee_table", specs: "40x20x30 inches" }]),
      { roomType: "living_room" },
    );
    // deviation 12, tolerance 2 → penalty min(0.2, (12-2)/10) = 0.2 → 1.0 - 0.2 = 0.8.
    expect(r.height_relationships).toBeCloseTo(0.8, 5);
    expect(r.issues.some((i) => i.item === "coffee_table")).toBe(true);
  });

  it("normalizes hyphen/space category names to the rule key", () => {
    const ok = computeProportionScores(
      analysis([{ category: "side-table", specs: "20x20x26 inches" }]),
      {},
    );
    // side_table target 26 ±2, actual 26 → full marks (proves the normalization matched a rule).
    expect(ok.height_relationships).toBe(1);

    const bad = computeProportionScores(
      analysis([{ category: "side table", specs: "20x20x40 inches" }]),
      {},
    );
    expect(bad.height_relationships).toBeLessThan(1);
    expect(bad.issues.some((i) => i.item === "side table")).toBe(true);
  });

  it("does not flag a height sitting exactly on the tolerance boundary", () => {
    // side_table target 26 ±2; actual 28 → deviation is exactly 2 == tolerance.
    // The guard is `deviation > tolerance` (strict), so the boundary is in-spec:
    // no issue, full marks. (A `>=` mutant would emit a spurious issue here —
    // the score is unchanged because the penalty at deviation==tolerance is 0.)
    const r = computeProportionScores(
      analysis([{ category: "side_table", specs: "20x20x28 inches" }]),
      {},
    );
    expect(r.height_relationships).toBe(1);
    expect(r.issues.some((i) => i.item === "side_table")).toBe(false);
  });

  it("falls back to 0.8 when an item has a rule but no parseable height", () => {
    const r = computeProportionScores(
      analysis([{ category: "coffee_table", specs: "40x20 inches" }]), // width/depth only, no height
      {},
    );
    expect(r.height_relationships).toBe(0.8);
    expect(r.issues).toHaveLength(0);
  });

  it("clamps the height score to the 0.3 floor under many violations", () => {
    const r = computeProportionScores(
      analysis([
        { category: "coffee_table", specs: "40x20x40 inches" },
        { category: "dining_table", specs: "60x36x48 inches" },
        { category: "desk", specs: "48x24x50 inches" },
        { category: "nightstand", specs: "20x16x48 inches" },
      ]),
      {},
    );
    expect(r.height_relationships).toBe(0.3);
    expect(r.issues.length).toBeGreaterThanOrEqual(4);
  });

  it("ignores items with no height rule (e.g. a sofa) for the height score", () => {
    const r = computeProportionScores(
      analysis([{ category: "sofa", specs: "84x36x34 inches" }]),
      {},
    );
    // No height rule matched → heightChecks 0 → 0.8 default, not a penalty.
    expect(r.height_relationships).toBe(0.8);
  });
});

describe("computeProportionScores — output shape", () => {
  it("rounds scores to two decimals and always returns a constant visual balance", () => {
    const r = computeProportionScores(
      analysis([{ category: "coffee_table", specs: "40x20x23 inches" }]),
      {},
    );
    // deviation 5, penalty min(0.2, 3/10) = 0.2 → 0.8 (rounded).
    expect(r.height_relationships).toBe(0.8);
    expect(Number.isFinite(r.rug_coverage)).toBe(true);
    expect(r.visual_balance).toBe(0.8);
    // Two-decimal rounding invariant.
    expect(Math.round(r.rug_coverage * 100) / 100).toBe(r.rug_coverage);
    expect(Math.round(r.height_relationships * 100) / 100).toBe(r.height_relationships);
  });
});
