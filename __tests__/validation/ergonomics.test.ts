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

  // ── TV viewing distance: 1.5–2.5 × diagonal ──────────────────────────
  // A 55" TV wants 82.5"–137.5" (≈7–11.5 ft) of viewing distance; a 65" TV
  // wants 97.5"–162.5". Distance is parsed from an "N feet from/away" hint in
  // the tv or sofa placement, else a 120" (10 ft) fallback.

  it("passes TV distance parsed from a placement hint inside the 1.5–2.5× band", () => {
    const analysis = {
      what_it_needs: [
        { category: "tv", specs: "55 x 4 x 32 inches" },
        // 9 ft = 108", inside [82.5, 137.5] for a 55" set. 108 ≠ the 120" fallback,
        // so a green result here proves the placement hint (not the fallback) drove it.
        { category: "sofa", specs: "84 x 38 x 34 inches", placement: "9 feet from the TV" },
      ],
    };
    const result = computeErgonomics(analysis, { roomType: "living_room" });
    const tvRule = result.rule_results.find((r) => r.rule.includes("tv_distance"));
    expect(tvRule?.passed).toBe(true);
    expect(tvRule?.actual).toContain("9 ft");
    expect(result.issues.some((i) => i.item === "tv")).toBe(false);
  });

  it("flags a TV that is too CLOSE (distance below 1.5× diagonal)", () => {
    const analysis = {
      what_it_needs: [
        // 65" set placed 4 ft (48") away — below the 97.5" minimum.
        { category: "tv", specs: "65 x 4 x 37 inches", placement: "4 feet from the wall" },
        { category: "sofa", specs: "84 x 38 x 34 inches" },
      ],
    };
    const result = computeErgonomics(analysis, { roomType: "living_room" });
    const tvRule = result.rule_results.find((r) => r.rule.includes("tv_distance"));
    expect(tvRule?.passed).toBe(false);
    const issue = result.issues.find((i) => i.item === "tv");
    expect(issue?.issue).toContain("too close");
  });

  it("flags a TV that is too FAR (distance above 2.5× diagonal)", () => {
    const analysis = {
      what_it_needs: [
        { category: "tv", specs: "55 x 4 x 32 inches" },
        // 15 ft = 180", beyond the 137.5" maximum for a 55" set.
        { category: "sofa", specs: "84 x 38 x 34 inches", placement: "15 feet away" },
      ],
    };
    const result = computeErgonomics(analysis, { roomType: "living_room" });
    const tvRule = result.rule_results.find((r) => r.rule.includes("tv_distance"));
    expect(tvRule?.passed).toBe(false);
    const issue = result.issues.find((i) => i.item === "tv");
    expect(issue?.issue).toContain("too far");
  });

  it("uses the 120\" (10 ft) fallback distance when no placement hint is given", () => {
    const analysis = {
      what_it_needs: [
        // 60" set, no distance hint → 120" fallback, inside [90, 150] → passes.
        { category: "tv", specs: "60 x 4 x 34 inches" },
        { category: "sofa", specs: "84 x 38 x 34 inches" },
      ],
    };
    const result = computeErgonomics(analysis, { roomType: "living_room" });
    const tvRule = result.rule_results.find((r) => r.rule.includes("tv_distance"));
    expect(tvRule?.passed).toBe(true);
    expect(tvRule?.actual).toContain("10 ft");
  });

  it("does not apply the TV rule when there is no seating to view from", () => {
    const analysis = {
      what_it_needs: [{ category: "tv", specs: "55 x 4 x 32 inches" }],
    };
    const result = computeErgonomics(analysis, { roomType: "living_room" });
    expect(result.rule_results.some((r) => r.rule.includes("tv_distance"))).toBe(false);
  });

  // Boundary cases that pin the exact 1.5×/2.5× multipliers and their inclusive
  // comparison — a 60" set gives clean edges at 90" (7.5 ft) and 150" (12.5 ft).
  const tvRulePassed = (sofaPlacement: string) =>
    computeErgonomics(
      {
        what_it_needs: [
          { category: "tv", specs: "60 x 4 x 34 inches" },
          { category: "sofa", specs: "84 x 38 x 34 inches", placement: sofaPlacement },
        ],
      },
      { roomType: "living_room" },
    ).rule_results.find((r) => r.rule.includes("tv_distance"))?.passed;

  it("treats 1.5× (min) and 2.5× (max) as INCLUSIVE boundaries", () => {
    // Exactly at the edges must pass — guards the >= / <= against a > / < flip.
    expect(tvRulePassed("7.5 feet from the TV")).toBe(true); // 90" == 60×1.5
    expect(tvRulePassed("12.5 feet away")).toBe(true); // 150" == 60×2.5
  });

  it("pins the 1.5×/2.5× constants — distances just outside the band fail", () => {
    // 88.8" (< 90) is too close and 151.2" (> 150) is too far under the true
    // 1.5–2.5× band, yet BOTH would fall inside a drifted 1.3–2.7× band — so a
    // coefficient regression would silently pass without these assertions.
    expect(tvRulePassed("7.4 feet from the TV")).toBe(false); // 88.8"
    expect(tvRulePassed("12.6 feet away")).toBe(false); // 151.2"
  });
});
