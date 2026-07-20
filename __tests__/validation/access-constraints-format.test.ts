import { describe, it, expect } from "vitest";
import {
  formatAccessConstraintsForPrompt,
  type AccessConstraintResult,
} from "@/lib/validation/access-constraints";

// formatAccessConstraintsForPrompt renders the delivery/access-feasibility block
// the LLM reads before sourcing large items. Its branches were previously
// untested even though a dropped or malformed constraint line here (an omitted
// tight-stair note, a wrong elevator dimension) can let the pipeline recommend
// furniture that physically cannot be delivered. These tests pin the exact
// prompt shape for each branch: the constraint "Path" line, the elevator-depth
// "?" fallback, the pass/fail marks, and the NOTE / FIX lines.

function baseResult(over: Partial<AccessConstraintResult> = {}): AccessConstraintResult {
  return {
    score: 0.8,
    constraints: {},
    per_item: [],
    issues: [],
    warnings: [],
    ...over,
  };
}

describe("formatAccessConstraintsForPrompt", () => {
  it("renders the score header rounded to two decimals", () => {
    const out = formatAccessConstraintsForPrompt(baseResult({ score: 0.5 }));
    expect(out.split("\n")[0]).toBe("### Delivery / Access Constraints: 0.50/1.0");
  });

  it("omits the Path line entirely when no constraints are set", () => {
    const out = formatAccessConstraintsForPrompt(baseResult({ constraints: {} }));
    expect(out).not.toContain("- Path:");
  });

  it("joins multiple constraints with the ' → ' separator in Path order", () => {
    const out = formatAccessConstraintsForPrompt(
      baseResult({
        constraints: {
          entry_door_width: 30,
          elevator_width: 40,
          elevator_depth: 50,
          stairwell_turn: true,
          hallway_width: 36,
        },
      }),
    );
    expect(out).toContain(
      '- Path: entry door 30" → elevator 40" × 50" → tight stairs → hallway 36"',
    );
  });

  it('shows "?" for elevator depth when width is known but depth is missing', () => {
    const out = formatAccessConstraintsForPrompt(
      baseResult({ constraints: { elevator_width: 42 } }),
    );
    expect(out).toContain('elevator 42" × ?"');
  });

  it("marks passed items with ✓ and failed items with ✗", () => {
    const out = formatAccessConstraintsForPrompt(
      baseResult({
        per_item: [
          { category: "sofa", passed: true, min_access_dim: 36, item_narrowest: 32, reason: "fits" },
          { category: "wardrobe", passed: false, min_access_dim: 30, item_narrowest: 40, reason: "too wide" },
        ],
      }),
    );
    expect(out).toContain("- ✓ sofa: fits");
    expect(out).toContain("- ✗ wardrobe: too wide");
  });

  it("renders warnings as NOTE lines and issues as FIX lines", () => {
    const out = formatAccessConstraintsForPrompt(
      baseResult({
        warnings: ["No access dimensions in building_research"],
        issues: [{ category: "wardrobe", issue: "won't fit", suggestion: "choose a knock-down model" }],
      }),
    );
    expect(out).toContain("- NOTE: No access dimensions in building_research");
    expect(out).toContain("- FIX: wardrobe — choose a knock-down model");
  });

  it("produces a header-only block when there are no constraints, items, warnings or issues", () => {
    const out = formatAccessConstraintsForPrompt(baseResult({ score: 0.9 }));
    expect(out).toBe("### Delivery / Access Constraints: 0.90/1.0");
  });
});
