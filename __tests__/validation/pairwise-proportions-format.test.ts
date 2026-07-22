import { describe, it, expect } from "vitest";
import { formatPairwiseProportionsForPrompt } from "@/lib/validation/pairwise-proportions";
import type { PairwiseResult } from "@/lib/validation/pairwise-proportions";

// Covers formatPairwiseProportionsForPrompt — the prompt-rendering surface fed
// into harmony-math's diagnostic block (harmony-math.ts). The scoring fn
// (computePairwiseProportions) is covered separately in pairwise-proportions.test.ts;
// this pins the FORMATTER's distinct branches so a rendering regression can't
// silently corrupt the proportion evidence the diagnosis LLM reads.

function makeResult(overrides: Partial<PairwiseResult> = {}): PairwiseResult {
  return {
    score: 0.75,
    rule_results: [],
    issues: [],
    ...overrides,
  };
}

describe("formatPairwiseProportionsForPrompt", () => {
  it("renders the score header with two decimals", () => {
    const out = formatPairwiseProportionsForPrompt(
      makeResult({
        score: 0.5,
        rule_results: [
          { rule: "coffee-to-sofa width", primary: "coffee_table", anchor: "sofa", passed: true, actual: "0.62", expected: "0.55-0.75" },
        ],
      }),
    );
    expect(out).toContain("### Pairwise Proportion Rules: 0.50/1.0");
  });

  it("takes the early return on empty rule_results BEFORE the issues loop fires", () => {
    // The guard must short-circuit even when issues are present: a broken guard
    // would leak a phantom FIX line with no backing rule evidence. Supply a
    // non-empty issues array so the assertion proves the guard fires first.
    const out = formatPairwiseProportionsForPrompt(
      makeResult({
        rule_results: [],
        issues: [
          { primary: "coffee_table", anchor: "sofa", issue: "too small", suggestion: "size up the coffee table" },
        ],
      }),
    );
    expect(out).toContain("No applicable pairwise pairs found (insufficient dimensional data)");
    // Guard fired before the issues loop → no FIX line leaked.
    expect(out).not.toContain("FIX:");
  });

  it("marks passing rules ✓ and failing rules ✗", () => {
    const out = formatPairwiseProportionsForPrompt(
      makeResult({
        rule_results: [
          { rule: "coffee-to-sofa width", primary: "coffee_table", anchor: "sofa", passed: true, actual: "0.62", expected: "0.55-0.75" },
          { rule: "rug-to-seating", primary: "rug", anchor: "sofa", passed: false, actual: "0.30", expected: ">=0.60" },
        ],
      }),
    );
    expect(out).toContain("✓ coffee-to-sofa width: 0.62 (expected 0.55-0.75)");
    expect(out).toContain("✗ rug-to-seating: 0.30 (expected >=0.60)");
  });

  it("renders each issue as a FIX line with the primary/anchor pair", () => {
    const out = formatPairwiseProportionsForPrompt(
      makeResult({
        rule_results: [
          { rule: "rug-to-seating", primary: "rug", anchor: "sofa", passed: false, actual: "0.30", expected: ">=0.60" },
        ],
        issues: [
          { primary: "rug", anchor: "sofa", issue: "rug too small for the seating group", suggestion: "use an 8x10 rug" },
        ],
      }),
    );
    expect(out).toContain("- FIX: rug vs sofa — use an 8x10 rug");
  });
});
