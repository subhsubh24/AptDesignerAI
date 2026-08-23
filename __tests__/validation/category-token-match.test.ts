import { describe, it, expect } from "vitest";
import { categoriesShareToken } from "@/lib/validation/category-token-match";

// APT-61: the get*IssuesForItem helpers used plain substring .includes(),
// which cross-matches whenever one category's normalized name happens to
// contain another's as a raw substring (e.g. "bedside_table".includes("bed")
// is true even though a nightstand has nothing to do with a bed issue).
// categoriesShareToken replaces that with whole `_`-token matching.
describe("categoriesShareToken", () => {
  it("matches identical categories", () => {
    expect(categoriesShareToken("sofa", "sofa")).toBe(true);
  });

  it("matches when a compound category shares a whole token with a simple one", () => {
    // "sectional_sofa" and "sofa" share the whole token "sofa".
    expect(categoriesShareToken("sectional_sofa", "sofa")).toBe(true);
    expect(categoriesShareToken("sofa", "sectional_sofa")).toBe(true);
    // "dining_table" and "table" share the whole token "table".
    expect(categoriesShareToken("dining_table", "table")).toBe(true);
    expect(categoriesShareToken("table", "dining_table")).toBe(true);
  });

  it("does NOT cross-match a substring that isn't a whole token (the APT-61 case)", () => {
    // "bedside_table".includes("bed") was true under the old substring check;
    // neither shares the whole token "bed".
    expect(categoriesShareToken("bedside_table", "bed")).toBe(false);
    expect(categoriesShareToken("bed", "bedside_table")).toBe(false);
  });

  it("does not match unrelated categories with no shared token", () => {
    expect(categoriesShareToken("rug", "sofa")).toBe(false);
    expect(categoriesShareToken("floor_lamp", "dining_table")).toBe(false);
  });

  it("does NOT cross-match two unrelated COMPOUND categories that share only a generic sub-token", () => {
    // A pure set-intersection over both sides' tokens would wrongly match
    // these — "table_lamp" and "coffee_table" both contain "table";
    // "wall_sconce" and "wall_art" both contain "wall" — even though neither
    // pair is the same item. This is the same bug class categoriesShareToken
    // exists to fix, one level up: only match when at least one side is a
    // SINGLE token (a simple category matching one component of a compound
    // one), never two multi-token compounds sharing a generic sub-token.
    expect(categoriesShareToken("table_lamp", "coffee_table")).toBe(false);
    expect(categoriesShareToken("wall_sconce", "wall_art")).toBe(false);
  });
});
