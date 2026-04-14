import { describe, it, expect } from "vitest";
import { computeErgonomics, getErgonomicsIssuesForItem } from "@/lib/validation/ergonomics";

describe("computeErgonomics", () => {
  it("fails desk depth < 24\"", () => {
    const analysis = {
      what_it_needs: [
        { category: "desk", specs: "48 x 18 x 30 inches" },
      ],
    };
    const result = computeErgonomics(analysis, { roomType: "home_office" });
    const deskRule = result.rule_results.find((r) => r.rule.includes("desk.depth"));
    expect(deskRule?.passed).toBe(false);
    expect(result.issues.some((i) => i.item === "desk")).toBe(true);
  });

  it("passes desk depth ≥ 24\"", () => {
    const analysis = {
      what_it_needs: [
        { category: "desk", specs: "60 x 30 x 30 inches" },
      ],
    };
    const result = computeErgonomics(analysis, { roomType: "home_office" });
    const deskRule = result.rule_results.find((r) => r.rule.includes("desk.depth"));
    expect(deskRule?.passed).toBe(true);
  });

  it("flags dining chair seat clearance outside 10-13\"", () => {
    const analysis = {
      what_it_needs: [
        { category: "dining_table", specs: "72 x 36 x 30 inches" },
        { category: "dining_chair", specs: "20 x 22 x 22 inches" }, // 30-22=8 (too low)
      ],
    };
    const result = computeErgonomics(analysis, { roomType: "dining_room" });
    const rule = result.rule_results.find((r) => r.rule.includes("dining_clearance"));
    expect(rule?.passed).toBe(false);
  });

  it("returns a score between 0 and 1", () => {
    const analysis = { what_it_needs: [] };
    const result = computeErgonomics(analysis);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });

  it("surfaces issues per item via getErgonomicsIssuesForItem", () => {
    const analysis = {
      what_it_needs: [
        { category: "desk", specs: "48 x 16 x 30 inches" },
      ],
    };
    const result = computeErgonomics(analysis, { roomType: "home_office" });
    const issues = getErgonomicsIssuesForItem(result, "desk");
    expect(issues.length).toBeGreaterThan(0);
  });
});
