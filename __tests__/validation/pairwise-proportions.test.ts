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
});
