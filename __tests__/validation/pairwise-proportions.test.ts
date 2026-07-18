import { describe, it, expect } from "vitest";
import {
  computePairwiseProportions,
  getPairwiseIssuesForItem,
} from "@/lib/validation/pairwise-proportions";

describe("computePairwiseProportions", () => {
  it("passes when coffee table is ~2/3 of sofa width", () => {
    const analysis = {
      what_it_needs: [
        { category: "sofa", specs: "90\"W x 38\"D x 32\"H" },
        { category: "coffee_table", specs: "54\"W x 24\"D x 18\"H" }, // 60% of 90
      ],
    };
    const result = computePairwiseProportions(analysis);
    const rule = result.rule_results.find((r) => r.rule.includes("coffee_table.width"));
    expect(rule?.passed).toBe(true);
  });

  it("fails when coffee table is way too small for the sofa", () => {
    const analysis = {
      what_it_needs: [
        { category: "sofa", specs: "90\"W x 38\"D x 32\"H" },
        { category: "coffee_table", specs: "24\"W x 24\"D x 18\"H" }, // only 27% of 90
      ],
    };
    const result = computePairwiseProportions(analysis);
    const rule = result.rule_results.find((r) => r.rule.includes("coffee_table.width"));
    expect(rule?.passed).toBe(false);
    expect(result.issues.some((i) => i.primary === "coffee_table")).toBe(true);
  });

  it("flags rug narrower than sofa+12\"", () => {
    const analysis = {
      what_it_needs: [
        { category: "sofa", specs: "90\"W x 38\"D x 32\"H" },
        { category: "area_rug", specs: "60\"W x 96\"D" }, // rug 60 < 90+12=102
      ],
    };
    const result = computePairwiseProportions(analysis);
    const rugRule = result.rule_results.find((r) => r.rule.includes("rug.width"));
    expect(rugRule?.passed).toBe(false);
  });

  it("flags TV wider than console - 8\"", () => {
    const analysis = {
      what_it_needs: [
        { category: "media_console", specs: "60\"W x 18\"D x 24\"H" },
        { category: "tv", specs: "65\"W x 3\"D x 38\"H" }, // 65 > 60-8=52
      ],
    };
    const result = computePairwiseProportions(analysis);
    const tvRule = result.rule_results.find((r) => r.rule.includes("tv.width"));
    expect(tvRule?.passed).toBe(false);
  });

  it("returns a default score when no applicable pairs found", () => {
    const analysis = {
      what_it_needs: [
        { category: "wall_art", specs: "30\"W x 40\"D" },
      ],
    };
    const result = computePairwiseProportions(analysis);
    expect(result.rule_results.length).toBe(0);
    expect(result.score).toBeGreaterThan(0);
  });

  it("surfaces item-specific issues", () => {
    const analysis = {
      what_it_needs: [
        { category: "sofa", specs: "90\"W x 38\"D x 32\"H" },
        { category: "coffee_table", specs: "24\"W x 24\"D x 18\"H" },
      ],
    };
    const result = computePairwiseProportions(analysis);
    const issues = getPairwiseIssuesForItem(result, "coffee_table");
    expect(issues.length).toBeGreaterThan(0);
  });

  // ─── dining_table.length ≥ 24" × chairs (long-side seating) ───────────────
  // Chair count = how many times "dining_chair" appears in what_it_needs.
  // perSideCount = max(1, ceil((chairs-2)/2)); minLen = perSideCount * 24;
  // length = max(width, depth); passed = length >= minLen.
  // (Height-independent rules use explicit `dimensions` so the length math is
  //  exercised faithfully — the "W x D x H" specs regex only yields width.)
  it("passes a dining table exactly at the required length for its chairs", () => {
    // 6 chairs → perSideCount = ceil(4/2) = 2 → minLen = 48; length max(48,40)=48 = boundary.
    const analysis = {
      what_it_needs: [
        { category: "dining_table", dimensions: { width: 48, depth: 40, height: 30 } },
        ...Array.from({ length: 6 }, () => ({
          category: "dining_chair",
          dimensions: { width: 18, depth: 20, height: 34 },
        })),
      ],
    };
    const result = computePairwiseProportions(analysis);
    const rule = result.rule_results.find((r) => r.rule.includes("dining_table.length"));
    // The rule must apply (both table + chairs present) and pass AT the boundary —
    // kills `>=` → `>` and mis-derived seat math (chairs-1 / chairs → minLen 72 > 48).
    expect(rule).toBeDefined();
    expect(rule?.passed).toBe(true);
  });

  it("fails a dining table too short for its chair count", () => {
    // 6 chairs → minLen 48; length max(40,36)=40 < 48 → fail + surfaced issue.
    const analysis = {
      what_it_needs: [
        { category: "dining_table", dimensions: { width: 40, depth: 36, height: 30 } },
        ...Array.from({ length: 6 }, () => ({
          category: "dining_chair",
          dimensions: { width: 18, depth: 20, height: 34 },
        })),
      ],
    };
    const result = computePairwiseProportions(analysis);
    const rule = result.rule_results.find((r) => r.rule.includes("dining_table.length"));
    expect(rule?.passed).toBe(false);
    expect(result.issues.some((i) => i.primary === "dining_table")).toBe(true);
  });

  it("enforces the 1-seat-per-side floor for a tiny two-seat table", () => {
    // 1 chair → chairs = max(count, 2) = 2 → ceil(0/2)=0 → max(1, 0)=1 → minLen 24.
    // A 20" table is below 24 and must fail — kills removal of the `max(1, …)` floor
    // (without it minLen would be 0 and every table would pass).
    const analysis = {
      what_it_needs: [
        { category: "dining_table", dimensions: { width: 20, depth: 18, height: 30 } },
        { category: "dining_chair", dimensions: { width: 18, depth: 20, height: 34 } },
      ],
    };
    const result = computePairwiseProportions(analysis);
    const rule = result.rule_results.find((r) => r.rule.includes("dining_table.length"));
    expect(rule?.passed).toBe(false);
  });

  it("fails a 5-chair table below the odd-seat-count minimum length", () => {
    // 5 chairs → perSideCount = ceil((5-2)/2) = ceil(1.5) = 2 → minLen 48; a 40"
    // table must fail. This is the odd count the 6-chair cases can't reach:
    // ceil((6-2)/2) = ceil((6-3)/2) = 2, so a (chairs-2)→(chairs-3) off-by-one
    // survives every even-count test; at 5 chairs the mutant drops to minLen 24
    // and would wrongly PASS this 40" table — so this test kills that mutation.
    const analysis = {
      what_it_needs: [
        { category: "dining_table", dimensions: { width: 40, depth: 36, height: 30 } },
        ...Array.from({ length: 5 }, () => ({
          category: "dining_chair",
          dimensions: { width: 18, depth: 20, height: 34 },
        })),
      ],
    };
    const result = computePairwiseProportions(analysis);
    const rule = result.rule_results.find((r) => r.rule.includes("dining_table.length"));
    expect(rule?.passed).toBe(false);
    expect(result.issues.some((i) => i.primary === "dining_table")).toBe(true);
  });

  // ─── nightstand.height ≈ bed top (bed.height − 3, tolerance ±4") ───────────
  it("passes a nightstand exactly at the ±4\" height tolerance from the bed top", () => {
    // bed height 36 → bedTop 33; nightstand 29 → deviation |29-33| = 4 = boundary.
    // Kills `<= 4` → `< 4` and `<= 3` (the code tolerance is 4, not the ±3 comment).
    const analysis = {
      what_it_needs: [
        { category: "bed", dimensions: { width: 60, depth: 80, height: 36 } },
        { category: "nightstand", dimensions: { width: 18, depth: 16, height: 29 } },
      ],
    };
    const result = computePairwiseProportions(analysis);
    const rule = result.rule_results.find((r) => r.rule.includes("nightstand.height"));
    expect(rule).toBeDefined();
    expect(rule?.passed).toBe(true);
  });

  it("fails a nightstand well above the bed-top tolerance", () => {
    // bed height 36 → bedTop 33; nightstand 26 → deviation 7 > 4 → fail + issue.
    const analysis = {
      what_it_needs: [
        { category: "bed", dimensions: { width: 60, depth: 80, height: 36 } },
        { category: "nightstand", dimensions: { width: 18, depth: 16, height: 26 } },
      ],
    };
    const result = computePairwiseProportions(analysis);
    const rule = result.rule_results.find((r) => r.rule.includes("nightstand.height"));
    expect(rule?.passed).toBe(false);
    expect(result.issues.some((i) => i.primary === "nightstand")).toBe(true);
  });

  // ─── side_table.height ≈ sofa arm (sofa.height − 10, tolerance ±3") ────────
  it("passes a side table exactly at the ±3\" sofa-arm tolerance", () => {
    // sofa height 32 → armHeight 22; side_table 25 → deviation |25-22| = 3 = boundary.
    // Kills `<= 3` → `< 3` and `<= 2`.
    const analysis = {
      what_it_needs: [
        { category: "sofa", dimensions: { width: 90, depth: 38, height: 32 } },
        { category: "side_table", dimensions: { width: 22, depth: 22, height: 25 } },
      ],
    };
    const result = computePairwiseProportions(analysis);
    const rule = result.rule_results.find((r) => r.rule.includes("side_table.height"));
    expect(rule).toBeDefined();
    expect(rule?.passed).toBe(true);
  });

  it("fails a side table far from the sofa-arm height", () => {
    // sofa height 32 → armHeight 22; side_table 28 → deviation 6 > 3 → fail + issue.
    const analysis = {
      what_it_needs: [
        { category: "sofa", dimensions: { width: 90, depth: 38, height: 32 } },
        { category: "side_table", dimensions: { width: 22, depth: 22, height: 28 } },
      ],
    };
    const result = computePairwiseProportions(analysis);
    const rule = result.rule_results.find((r) => r.rule.includes("side_table.height"));
    expect(rule?.passed).toBe(false);
    expect(result.issues.some((i) => i.primary === "side_table")).toBe(true);
  });
});
