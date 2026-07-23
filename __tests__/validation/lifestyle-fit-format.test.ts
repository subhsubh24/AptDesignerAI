import { describe, it, expect } from "vitest";
import {
  formatLifestyleFitForPrompt,
  type LifestyleFitResult,
} from "@/lib/validation/durability-map";

// Covers formatLifestyleFitForPrompt — the prompt-rendering surface that feeds
// a product's lifestyle-durability evidence to the diagnosis/scoring LLM. The
// scoring fn (scoreLifestyleFit) is covered in durability-map.test.ts; this
// pins the FORMATTER's distinct behaviors so a rendering regression can't
// silently corrupt (or over-report) the durability signal the model reads:
//  - the score header uses two-decimal formatting,
//  - the axes line renders EXACTLY the four decision-relevant axes
//    (pet/kid/traffic/clean) and deliberately OMITS moisture/fade,
//  - each issue becomes its own "- ISSUE:" line, and an empty issues array
//    emits NO issue lines (no spurious trailing evidence).

function makeResult(overrides: Partial<LifestyleFitResult> = {}): LifestyleFitResult {
  return {
    score: 0.75,
    axes: {
      pet_friendly: 0.8,
      kid_friendly: 0.6,
      high_traffic: 0.4,
      easy_clean: 0.9,
      moisture_resist: 0.5,
      fade_resist: 0.3,
    },
    issues: [],
    ...overrides,
  };
}

describe("formatLifestyleFitForPrompt", () => {
  it("renders the score header with two decimals", () => {
    const out = formatLifestyleFitForPrompt(makeResult({ score: 0.5 }));
    expect(out.split("\n")[0]).toBe("### Lifestyle Durability: 0.50/1.0");
  });

  it("rounds the header score to two decimals (toFixed)", () => {
    // 0.333 -> "0.33", 1 -> "1.00" — proves toFixed(2), not raw interpolation.
    expect(formatLifestyleFitForPrompt(makeResult({ score: 0.333 }))).toContain(
      "### Lifestyle Durability: 0.33/1.0",
    );
    expect(formatLifestyleFitForPrompt(makeResult({ score: 1 }))).toContain(
      "### Lifestyle Durability: 1.00/1.0",
    );
  });

  it("renders exactly the four decision axes, each to two decimals", () => {
    const out = formatLifestyleFitForPrompt(makeResult());
    expect(out.split("\n")[1]).toBe("- pet=0.80 kid=0.60 traffic=0.40 clean=0.90");
  });

  it("omits the moisture/fade axes from the rendered line", () => {
    // Both exist on the axes vector but are intentionally not surfaced in the
    // prompt line — a mutation that leaked them must fail here.
    const out = formatLifestyleFitForPrompt(
      makeResult({
        axes: {
          pet_friendly: 0.11,
          kid_friendly: 0.22,
          high_traffic: 0.33,
          easy_clean: 0.44,
          moisture_resist: 0.99,
          fade_resist: 0.98,
        },
      }),
    );
    expect(out).not.toContain("moisture");
    expect(out).not.toContain("fade");
    expect(out).not.toContain("0.99");
    expect(out).not.toContain("0.98");
  });

  it("emits no ISSUE lines when there are no issues", () => {
    const out = formatLifestyleFitForPrompt(makeResult({ issues: [] }));
    expect(out).not.toContain("ISSUE");
    // Exactly the header + axes line, nothing trailing.
    expect(out.split("\n")).toHaveLength(2);
  });

  it("renders one '- ISSUE:' line per issue, in order", () => {
    const out = formatLifestyleFitForPrompt(
      makeResult({
        issues: [
          "Light-colored linen fabric + pets — high risk of visible wear",
          "Low easy-clean score for a kid-heavy home",
        ],
      }),
    );
    const lines = out.split("\n");
    expect(lines).toHaveLength(4); // header + axes + 2 issues
    expect(lines[2]).toBe(
      "- ISSUE: Light-colored linen fabric + pets — high risk of visible wear",
    );
    expect(lines[3]).toBe("- ISSUE: Low easy-clean score for a kid-heavy home");
  });
});
