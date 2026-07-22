import { describe, it, expect } from "vitest";
import {
  computeErgonomics,
  getErgonomicsIssuesForItem,
  formatErgonomicsForPrompt,
  type ErgonomicsResult,
} from "@/lib/validation/ergonomics";

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

  // Pendant-over-surface height rule (30-36" bottom-to-surface). Whole rule was
  // previously unexercised — it only fires when a pendant/chandelier AND a
  // dining_table/island (with a parsed height) are both present and the pendant
  // placement text encodes a numeric "N above" clearance. Both out-of-band
  // branches (too-low < 30, too-high > 36) are asserted so a mutation of either
  // the 30/36 thresholds or the </> operator is caught.
  it("flags a pendant hung too low (< 30\") over the dining table", () => {
    const analysis = {
      what_it_needs: [
        { category: "dining_table", specs: "72 x 36 x 30 inches" },
        { category: "pendant_light", placement: "hung 28 in above the dining table" },
      ],
    };
    const result = computeErgonomics(analysis, { roomType: "dining_room" });
    const rule = result.rule_results.find((r) => r.rule.includes("pendant.height"));
    expect(rule?.passed).toBe(false);
    expect(result.issues.some((i) => /too low/i.test(i.issue))).toBe(true);
  });

  it("flags a pendant hung too high (> 36\") over the dining table", () => {
    const analysis = {
      what_it_needs: [
        { category: "dining_table", specs: "72 x 36 x 30 inches" },
        { category: "pendant_light", placement: "hung 40 in above the dining table" },
      ],
    };
    const result = computeErgonomics(analysis, { roomType: "dining_room" });
    const rule = result.rule_results.find((r) => r.rule.includes("pendant.height"));
    expect(rule?.passed).toBe(false);
    expect(result.issues.some((i) => /too high/i.test(i.issue))).toBe(true);
  });

  it("passes a pendant hung within 30-36\" of the surface", () => {
    const analysis = {
      what_it_needs: [
        { category: "dining_table", specs: "72 x 36 x 30 inches" },
        { category: "pendant_light", placement: "hung 32 in above the dining table" },
      ],
    };
    const result = computeErgonomics(analysis, { roomType: "dining_room" });
    const rule = result.rule_results.find((r) => r.rule.includes("pendant.height"));
    expect(rule?.passed).toBe(true);
  });

  // Counter → upper-cabinet gap rule (15-20"). Whole rule was previously
  // unexercised. Asserts both out-of-band branches (too-low < 15, too-high > 20)
  // so a mutation of the 15/20 thresholds or the </> operator is caught.
  it("flags an upper cabinet mounted too low (< 15\") above the counter", () => {
    const analysis = {
      what_it_needs: [
        { category: "upper_cabinet", placement: "13 in above the counter" },
      ],
    };
    const result = computeErgonomics(analysis, { roomType: "kitchen" });
    const rule = result.rule_results.find((r) => r.rule.includes("upper_cabinet"));
    expect(rule?.passed).toBe(false);
    expect(result.issues.some((i) => /too low/i.test(i.issue))).toBe(true);
  });

  it("flags an upper cabinet mounted too high (> 20\") above the counter", () => {
    const analysis = {
      what_it_needs: [
        { category: "upper_cabinet", placement: "22 in above the counter" },
      ],
    };
    const result = computeErgonomics(analysis, { roomType: "kitchen" });
    const rule = result.rule_results.find((r) => r.rule.includes("upper_cabinet"));
    expect(rule?.passed).toBe(false);
    expect(result.issues.some((i) => /too high/i.test(i.issue))).toBe(true);
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

describe("formatErgonomicsForPrompt", () => {
  it("short-circuits to an insufficient-data note when no rules applied", () => {
    // rule_results empty → the guard returns BEFORE the issues loop, so even a
    // populated `issues` array must not surface a FIX line. Removing the early
    // return would leak the FIX line here.
    const result: ErgonomicsResult = {
      score: 0.7,
      rule_results: [],
      issues: [{ scope: "tv+sofa", item: "tv", issue: "too close", suggestion: "move the sofa back" }],
    };
    const out = formatErgonomicsForPrompt(result);
    expect(out).toContain("- No applicable ergonomics rules (insufficient data)");
    expect(out).not.toContain("FIX");
  });

  it("marks passing rules ✓, failing rules ✗, and lists FIX suggestions", () => {
    const result: ErgonomicsResult = {
      score: 0.5,
      rule_results: [
        { rule: "tv viewing distance", scope: "tv+sofa", passed: true, actual: '9ft', expected: '8-12ft' },
        { rule: "desk depth", scope: "desk", passed: false, actual: '20in', expected: '≥24in' },
      ],
      issues: [{ scope: "desk", item: "desk", issue: "too shallow", suggestion: "use a 24in-deep desk" }],
    };
    const out = formatErgonomicsForPrompt(result);
    expect(out).toContain("✓ tv viewing distance: 9ft (expected 8-12ft)");
    expect(out).toContain("✗ desk depth: 20in (expected ≥24in)");
    expect(out).toContain("- FIX: desk — use a 24in-deep desk");
  });
});
