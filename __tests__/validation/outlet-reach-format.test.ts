import { describe, it, expect } from "vitest";
import { formatOutletReachForPrompt } from "@/lib/validation/outlet-reach";
import type { OutletReachResult } from "@/lib/validation/outlet-reach";

// Covers formatOutletReachForPrompt — the prompt-rendering surface fed into
// harmony-math's diagnostic block. The scoring fn (computeOutletReach) is covered
// separately in outlet-reach.test.ts; this pins the FORMATTER's distinct branches
// so a rendering regression can't silently corrupt the powered-item reach
// evidence the diagnosis LLM reads.

function makeResult(overrides: Partial<OutletReachResult> = {}): OutletReachResult {
  return {
    score: 0.75,
    outlet_zones: [],
    per_item: [],
    issues: [],
    warnings: [],
    ...overrides,
  };
}

describe("formatOutletReachForPrompt", () => {
  it("renders the score header with two decimals", () => {
    const out = formatOutletReachForPrompt(makeResult({ score: 0.5 }));
    expect(out).toContain("### Outlet Reach: 0.50/1.0");
  });

  it("joins known outlet zones", () => {
    const out = formatOutletReachForPrompt(
      makeResult({ outlet_zones: ["north_wall", "near_desk"] }),
    );
    expect(out).toContain("- Outlet zones: north_wall, near_desk");
  });

  it("falls back to (unknown) when no outlet zones are detected", () => {
    // A naive `${zones.join(", ")}` on an empty array would render an empty
    // string, silently telling the LLM "outlet zones: " with no signal that the
    // data is missing vs. genuinely none. The "(unknown)" fallback is that signal.
    const out = formatOutletReachForPrompt(makeResult({ outlet_zones: [] }));
    expect(out).toContain("- Outlet zones: (unknown)");
  });

  it("marks reachable items ✓ and unreachable items ✗", () => {
    const out = formatOutletReachForPrompt(
      makeResult({
        per_item: [
          { category: "floor_lamp", placement_zones: ["near_sofa"], reachable: true, reason: "within cord reach" },
          { category: "desk_lamp", placement_zones: ["center"], reachable: false, reason: "no outlet within 6ft" },
        ],
      }),
    );
    expect(out).toContain("- ✓ floor_lamp: within cord reach");
    expect(out).toContain("- ✗ desk_lamp: no outlet within 6ft");
  });

  it("renders each warning as a NOTE line", () => {
    const out = formatOutletReachForPrompt(
      makeResult({ warnings: ["outlet positions inferred from room type"] }),
    );
    expect(out).toContain("- NOTE: outlet positions inferred from room type");
  });

  it("renders each issue as a FIX line with the category and suggestion", () => {
    const out = formatOutletReachForPrompt(
      makeResult({
        issues: [
          { category: "desk_lamp", issue: "out of reach", suggestion: "add a floor outlet or reposition the desk" },
        ],
      }),
    );
    expect(out).toContain("- FIX: desk_lamp — add a floor outlet or reposition the desk");
  });
});
