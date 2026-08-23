import { describe, it, expect } from "vitest";
import {
  computeBudgetAllocation,
  formatBudgetAllocationForPrompt,
  getBudgetIssuesForItem,
  type BudgetAllocationResult,
} from "@/lib/validation/budget-allocation";

describe("computeBudgetAllocation", () => {
  it("flags under-investment on sofa", () => {
    const result = computeBudgetAllocation(
      {},
      {
        roomType: "living_room",
        bundle: [
          { category: "sofa", price: 500 },      // 8% of 6200 — under 22% minimum
          { category: "area_rug", price: 1500 },
          { category: "coffee_table", price: 700 },
          { category: "floor_lamp", price: 500 },
          { category: "wall_art", price: 3000 }, // massively over-spent
        ],
      },
    );
    const sofaRow = result.per_category.find((p) => p.category === "sofa");
    expect(sofaRow?.status).toBe("under");
    expect(result.issues.some((i) => i.category === "sofa")).toBe(true);
  });

  it("does NOT flag an under-spent accent category (accentOnly suppresses under)", () => {
    // floor_lamp is accentOnly: cheaping out on a lamp is fine, so an under-share
    // must NOT produce an issue even though the row status is still "under".
    const result = computeBudgetAllocation(
      {},
      {
        roomType: "living_room",
        bundle: [
          { category: "sofa", price: 2200 },   // ~44% — anchor present
          { category: "area_rug", price: 1200 },
          { category: "coffee_table", price: 800 },
          { category: "accent_chair", price: 780 },
          { category: "floor_lamp", price: 40 }, // <1% — under its 3-15% band
        ],
      },
    );
    const lampRow = result.per_category.find((p) => p.category === "floor_lamp");
    expect(lampRow?.status).toBe("under");
    // Suppressed: no under-issue for the accent category. Removing the
    // `!target.accentOnly` guard would surface one here.
    expect(result.issues.some((i) => i.category === "floor_lamp")).toBe(false);
  });

  it("DOES flag an over-spent accent category (accentOnly suppresses under, not over)", () => {
    // wall_art is accentOnly, so under is suppressed — but blowing the budget on
    // art is still a real over-allocation and MUST be flagged.
    const result = computeBudgetAllocation(
      {},
      {
        roomType: "living_room",
        bundle: [
          { category: "sofa", price: 800 },
          { category: "area_rug", price: 700 },
          { category: "wall_art", price: 4000 }, // ~72% — far over its 2-15% band
        ],
      },
    );
    const artRow = result.per_category.find((p) => p.category === "wall_art");
    expect(artRow?.status).toBe("over");
    expect(result.issues.some((i) => i.category === "wall_art")).toBe(true);
  });

  it("reports within-range for balanced allocations", () => {
    const result = computeBudgetAllocation(
      {},
      {
        roomType: "living_room",
        bundle: [
          { category: "sofa", price: 2000 },         // ~33% of 6000
          { category: "area_rug", price: 800 },      // ~13%
          { category: "coffee_table", price: 500 },  // ~8%
          { category: "media_console", price: 600 }, // ~10%
          { category: "accent_chair", price: 700 },  // ~12%
          { category: "floor_lamp", price: 300 },    // ~5%
          { category: "wall_art", price: 500 },      // ~8%
        ],
      },
    );
    expect(result.score).toBeGreaterThan(0.6);
  });

  it("warns when no prices available", () => {
    const result = computeBudgetAllocation(
      { what_it_needs: [{ category: "sofa" }] },
      { roomType: "living_room" },
    );
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("returns non-fatal default for unknown room types", () => {
    const result = computeBudgetAllocation(
      {},
      { roomType: "atrium", bundle: [{ category: "plant", price: 200 }] },
    );
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });
});

describe("formatBudgetAllocationForPrompt", () => {
  // Fixed literal so every rendering branch is exercised deterministically:
  // one row per status (within/under/over) + an "n/a" row that MUST be skipped,
  // a positive total_spend, a warning, and an issue.
  const mixed: BudgetAllocationResult = {
    score: 0.42,
    total_spend: 6200,
    per_category: [
      { category: "area_rug", aliases: [], spend: 800, share: 0.13, target: [0.1, 0.18], status: "within", item_count: 1 },
      { category: "sofa", aliases: [], spend: 500, share: 0.08, target: [0.22, 0.4], status: "under", item_count: 1 },
      { category: "wall_art", aliases: [], spend: 3000, share: 0.48, target: [0.02, 0.15], status: "over", item_count: 1 },
      { category: "misc_widget", aliases: [], spend: 0, share: 0, target: [0, 0], status: "n/a", item_count: 0 },
    ],
    issues: [{ category: "sofa", issue: "sofa under-invested", suggestion: "allocate more to the sofa" }],
    warnings: ["prices are estimates"],
  };

  it("renders a distinct mark per status and skips n/a rows", () => {
    const out = formatBudgetAllocationForPrompt(mixed);
    expect(out).toContain("✓ area_rug"); // within
    expect(out).toContain("↓ sofa"); // under
    expect(out).toContain("↑ wall_art"); // over
    // n/a rows are `continue`d — the category must not appear as a rendered row.
    expect(out).not.toContain("misc_widget");
  });

  it("renders share/target percentages and dollar spend", () => {
    const out = formatBudgetAllocationForPrompt(mixed);
    // sofa: 8% ($500) vs target 22-40%
    expect(out).toContain("8% ($500) vs target 22-40%");
  });

  it("includes total spend only when > 0", () => {
    expect(formatBudgetAllocationForPrompt(mixed)).toContain("- Total spend: $6200");
    const noSpend: BudgetAllocationResult = { ...mixed, total_spend: 0, per_category: [], issues: [], warnings: [] };
    expect(formatBudgetAllocationForPrompt(noSpend)).not.toContain("Total spend");
  });

  it("renders warnings as NOTE lines and issues as FIX lines", () => {
    const out = formatBudgetAllocationForPrompt(mixed);
    expect(out).toContain("- NOTE: prices are estimates");
    expect(out).toContain("- FIX: sofa — allocate more to the sofa");
  });
});

describe("getBudgetIssuesForItem", () => {
  // Feeds per-item budget FIX context into the diagnosis LLM prompt. It fuzzy-
  // matches the requested category against each issue's (already-normalized)
  // category and returns the `issue` text. The four sibling helpers
  // (access/outlet/ergonomics/pairwise) are tested; this one was not.
  const base: BudgetAllocationResult = {
    score: 0,
    total_spend: 0,
    per_category: [],
    warnings: [],
    issues: [
      { category: "sofa", issue: "sofa is under-invested", suggestion: "spend more" },
      { category: "dining_table", issue: "dining table over budget", suggestion: "trim it" },
    ],
  };

  it("returns the issue text on an exact category match", () => {
    expect(getBudgetIssuesForItem(base, "sofa")).toEqual(["sofa is under-invested"]);
  });

  it("normalizes the input category (spaces/hyphens → underscore, lowercased)", () => {
    // A mutation dropping normalizeCategory on the input would fail this: the
    // raw "Dining Table" would never equal the stored "dining_table".
    expect(getBudgetIssuesForItem(base, "Dining Table")).toEqual(["dining table over budget"]);
    expect(getBudgetIssuesForItem(base, "dining-table")).toEqual(["dining table over budget"]);
  });

  it("matches when the requested category CONTAINS the issue category", () => {
    // cat.includes(i.category): "sectional_sofa" contains "sofa".
    expect(getBudgetIssuesForItem(base, "sectional sofa")).toEqual(["sofa is under-invested"]);
  });

  it("matches when the issue category CONTAINS the requested category", () => {
    // i.category.includes(cat): "dining_table" contains "table".
    expect(getBudgetIssuesForItem(base, "table")).toEqual(["dining table over budget"]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(getBudgetIssuesForItem(base, "rug")).toEqual([]);
    expect(getBudgetIssuesForItem({ ...base, issues: [] }, "sofa")).toEqual([]);
  });

  it("matches a target's SECONDARY alias, not just its display-name category", () => {
    // Regression guard: computeBudgetAllocation always names an issue's
    // `category` after aliases[0] (e.g. "sofa" for the sofa/sectional
    // target), but a real what_it_needs item can be categorized under any
    // alias in that target (e.g. "sectional"). Before `aliases` was carried
    // on each issue, "sectional" never equaled "sofa" and this silently
    // never matched — the item's own budget issue was dropped.
    const withAliases: BudgetAllocationResult = {
      ...base,
      issues: [
        { category: "sofa", aliases: ["sofa", "sectional"], issue: "sofa is under-invested", suggestion: "spend more" },
      ],
    };
    expect(getBudgetIssuesForItem(withAliases, "sectional")).toEqual(["sofa is under-invested"]);
  });

  it("falls back to matching bare `category` when `aliases` is absent (hand-built fixtures)", () => {
    // `base` above has no `aliases` field on its issues — confirms the
    // fallback path (not just the new aliases-aware path) still works.
    expect(getBudgetIssuesForItem(base, "sofa")).toEqual(["sofa is under-invested"]);
  });

  it("surfaces the kitchen bar_stools issue via its canonical PLURAL slug (APT-61 review follow-up)", () => {
    // lib/config/pipeline.ts's kitchen `essential` list and
    // area-analysis-validator.ts's matchTerms both use "bar_stools" (plural)
    // as the canonical category slug, while this target's own aliases only
    // listed "bar_stool" (singular). Under the OLD substring check,
    // "bar_stools".includes("bar_stool") accidentally papered over the
    // mismatch; the whole-token rewrite (categoriesShareToken) no longer
    // does, so "bar_stools" must be a real alias, not rely on substring luck.
    const result = computeBudgetAllocation(
      {},
      {
        roomType: "kitchen",
        bundle: [
          { category: "pendant_light", price: 1200 },
          { category: "bar_stools", price: 100 }, // far under the 10-30% target share
        ],
      },
    );
    const issue = result.issues.find((i) => i.category === "bar_stool");
    expect(issue).toBeDefined();
    expect(getBudgetIssuesForItem(result, "bar_stools")).toEqual([issue!.issue]);
  });

  it("does NOT cross-match a nightstand against an unrelated bed issue (APT-61)", () => {
    // Under the old cat.includes(a)/a.includes(cat) substring check,
    // "bedside_table".includes("bed") was true, so an item categorized
    // "bedside_table" (the nightstand target's second alias) wrongly picked
    // up an unrelated "bed" issue. Whole-token matching must not.
    const bedOnly: BudgetAllocationResult = {
      ...base,
      issues: [{ category: "bed", issue: "bed is under-invested", suggestion: "spend more" }],
    };
    expect(getBudgetIssuesForItem(bedOnly, "bedside_table")).toEqual([]);
  });

  it("resolves real dining-room-tuned targets for roomType 'dining_area' (APT-63)", () => {
    // The `rooms` table's DB CHECK constraint and every web-app write path only
    // ever produce "dining_area" (never "dining_room") — ROOM_TARGETS must be
    // keyed to match, or every dining room silently falls through to "no
    // allocation targets defined" and skips this check entirely.
    const result = computeBudgetAllocation(
      {},
      {
        roomType: "dining_area",
        bundle: [
          { category: "dining_table", price: 200 }, // far under its 22-40% target share
          { category: "area_rug", price: 800 },
        ],
      },
    );
    expect(result.warnings.some((w) => w.includes("No allocation targets defined"))).toBe(false);
    const tableRow = result.per_category.find((p) => p.category === "dining_table");
    expect(tableRow?.status).toBe("under");
    expect(result.issues.some((i) => i.category === "dining_table")).toBe(true);
  });
});
