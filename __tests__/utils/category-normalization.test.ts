import { describe, expect, it } from "vitest";
import { normalizeMissingCategories } from "@/lib/utils/category-normalization";

describe("normalizeMissingCategories", () => {
  it("passes plain string categories through", () => {
    expect(normalizeMissingCategories(["rug", "coffee_table"], new Set())).toEqual([
      "rug",
      "coffee_table",
    ]);
  });

  it("extracts category from rich objects", () => {
    expect(
      normalizeMissingCategories(
        [{ category: "accent_chair" }, { category: "rug", search_title: "Wool rug" }],
        new Set(),
      ),
    ).toEqual(["accent_chair", "rug"]);
  });

  it("drops rich objects with a missing category field instead of crashing", () => {
    // Regression: a client-supplied object without `category` (e.g. only
    // `search_title`/`specs`) previously mapped to `undefined`, which then
    // threw on `.toLowerCase()` and turned a malformed request into an
    // unhandled 500 instead of being safely dropped.
    expect(
      normalizeMissingCategories(
        [{ category: "rug" }, { search_title: "Modern Sofa", specs: "4-seater" } as never],
        new Set(),
      ),
    ).toEqual(["rug"]);
  });

  it("drops rich objects with a non-string category field", () => {
    expect(
      normalizeMissingCategories([{ category: 42 as never }, "rug"], new Set()),
    ).toEqual(["rug"]);
  });

  it("drops empty-string categories", () => {
    expect(normalizeMissingCategories(["", "rug"], new Set())).toEqual(["rug"]);
  });

  it("filters out categories already covered by identified pieces (case-insensitive)", () => {
    expect(
      normalizeMissingCategories(
        ["Rug", "coffee_table", "accent_chair"],
        new Set(["rug"]),
      ),
    ).toEqual(["coffee_table", "accent_chair"]);
  });

  it("returns an empty array for an empty input", () => {
    expect(normalizeMissingCategories([], new Set())).toEqual([]);
  });
});
