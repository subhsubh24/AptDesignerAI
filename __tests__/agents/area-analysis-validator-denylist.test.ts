import { describe, it, expect } from "vitest";
import { validateAreaAnalysis } from "@/lib/agents/area-analysis-validator";

describe("area-analysis-validator: keep-keyword denylist", () => {
  it("does not match 'plastic storage bins' to a 'bookshelf' keep item via the 'storage' keyword", () => {
    // Reproduces the bug: extractKeepCategoriesLLM returned overly-broad
    // keywords ["bookshelf", "shelving", "bookcase", "shelf", "storage"] for a
    // bookshelf keep item, and the validator then deleted "Plastic storage
    // bins" from what_should_go via the 'storage' word match.
    const analysis = {
      summary: "Studio apartment with hardwood floors and a wooden bookshelf in the corner.",
      what_works: ["Wooden bookshelf — modular fits the corner"],
      what_should_go: [
        "Plastic under-bed/floor storage bins — visible clutter",
        "Black metal TV stand — undersized",
      ],
      what_it_needs: [
        { category: "area_rug", search_title: "Wool area rug" },
      ],
    };

    const result = validateAreaAnalysis(
      analysis,
      ["bookshelf"],
      undefined,
      null,
      {
        expandedExclusions: null,
        keepItemCategories: [
          {
            item: "bookshelf",
            // The LLM returned these overly-broad keywords. The denylist must
            // strip "storage" and "shelf" so they don't false-match.
            category_keywords: ["bookshelf", "shelving", "bookcase", "shelf", "storage"],
            location_phrase: "",
          },
        ],
        architecturalInWorks: null,
        invalidInRemove: null,
      },
    );

    const removes = result.patched.what_should_go as string[];
    expect(removes).toContainEqual(expect.stringContaining("storage bins"));
    expect(removes).toHaveLength(2);
    // The keep_item_in_remove issue should NOT have fired for storage bins
    const keepInRemoveIssues = result.issues.filter((i) => i.type === "keep_item_in_remove");
    expect(keepInRemoveIssues).toHaveLength(0);
  });

  it("still catches a real keep_item_in_remove conflict (specific category, not generic)", () => {
    const analysis = {
      summary: "Living room with a sectional sofa.",
      what_works: [],
      what_should_go: ["The grey fabric sofa — looks tired"],
      what_it_needs: [],
    };

    const result = validateAreaAnalysis(
      analysis,
      ["sofa"],
      undefined,
      null,
      {
        expandedExclusions: null,
        keepItemCategories: [
          {
            item: "sofa",
            category_keywords: ["sofa", "couch", "sectional"],
            location_phrase: "",
          },
        ],
        architecturalInWorks: null,
        invalidInRemove: null,
      },
    );

    const removes = result.patched.what_should_go as string[];
    expect(removes).toHaveLength(0); // sofa was correctly removed from what_should_go
    const keepInRemoveIssues = result.issues.filter((i) => i.type === "keep_item_in_remove");
    expect(keepInRemoveIssues).toHaveLength(1);
  });

  it("does not let a 'wood' keyword false-match unrelated wooden items", () => {
    const analysis = {
      summary: "Living room with a walnut coffee table.",
      what_works: [],
      what_should_go: [
        "Wooden picture frames on the shelf — mismatched gallery wall",
      ],
      what_it_needs: [],
    };

    const result = validateAreaAnalysis(
      analysis,
      ["coffee table"],
      undefined,
      null,
      {
        expandedExclusions: null,
        keepItemCategories: [
          {
            item: "coffee table",
            category_keywords: ["coffee table", "wood", "wooden"],
            location_phrase: "",
          },
        ],
        architecturalInWorks: null,
        invalidInRemove: null,
      },
    );

    const removes = result.patched.what_should_go as string[];
    expect(removes).toHaveLength(1);
    expect(removes[0]).toContain("picture frames");
  });

  it("does not block a table lamp recommendation when user keeps a floor lamp", () => {
    const analysis = {
      summary: "Living room with a floor lamp and sofa.",
      what_works: [],
      what_should_go: [],
      what_it_needs: [
        { category: "table_lamp", search_title: "Sculptural matte black table lamp with warm linen drum shade" },
      ],
    };

    const result = validateAreaAnalysis(
      analysis,
      ["black arc floor lamp"],
      undefined,
      null,
      {
        expandedExclusions: null,
        keepItemCategories: [
          {
            item: "black arc floor lamp",
            category_keywords: ["floor lamp", "arc lamp", "standing lamp", "lamp", "light"],
            location_phrase: "",
          },
        ],
        architecturalInWorks: null,
        invalidInRemove: null,
      },
    );

    const needs = result.patched.what_it_needs as Array<{ category: string }>;
    expect(needs).toHaveLength(1);
    expect(needs[0].category).toBe("table_lamp");
    const replaced = result.issues.filter((i) => i.type === "keep_item_replaced");
    expect(replaced).toHaveLength(0);
  });
});
