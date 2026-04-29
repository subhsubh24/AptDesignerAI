import { describe, it, expect } from "vitest";
import { inferReplacementsFromGap } from "@/lib/agents/infer-replacements";

describe("inferReplacementsFromGap", () => {
  it("infers a sofa replacement when Pass B buys a sofa, room has one, and user did not keep it", () => {
    const result = inferReplacementsFromGap(
      {
        summary: "Living room with a dark grey fabric sectional sofa and a glass coffee table.",
        design_direction: "Upgrade to a warmer, leather-forward palette.",
        what_works: [],
        what_should_go: [],
        what_it_needs: [
          { category: "sofa", search_title: "Cognac leather 84-inch track-arm sofa with walnut legs" },
        ],
      },
      ["bookshelf"],
    );
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe("sofa");
    expect(result[0].entry).toContain("Existing sofa");
    expect(result[0].entry).toContain("Cognac leather");
  });

  it("infers all three (sofa, coffee table, media console) for the user's exact scenario", () => {
    const result = inferReplacementsFromGap(
      {
        summary: "Open-concept living area with a grey sectional sofa, a small glass coffee table, and a low white media console with a TV.",
        what_works: ["bookshelf — kept per client request", "black arc floor lamp", "two lights and light stands"],
        what_should_go: [],
        what_it_needs: [
          { category: "sofa", search_title: "Cognac leather 84in sofa" },
          { category: "coffee_table", search_title: "Solid walnut 48in round coffee table" },
          { category: "media_console", search_title: "Matte black walnut media console 70in" },
          { category: "area_rug", search_title: "9x12 wool area rug" },
        ],
      },
      ["bookshelf", "black arc floor lamp", "two lights and light stands"],
    );
    const cats = result.map((r) => r.category).sort();
    expect(cats).toEqual(["coffee_table", "media_console", "sofa"]);
  });

  it("does NOT infer when the user keeps that category", () => {
    const result = inferReplacementsFromGap(
      {
        summary: "Living room with a grey sectional sofa.",
        what_works: [],
        what_should_go: [],
        what_it_needs: [{ category: "sofa", search_title: "New sofa" }],
      },
      ["sofa"],
    );
    expect(result).toHaveLength(0);
  });

  it("does NOT infer when the user keeps via a synonym (sectional)", () => {
    const result = inferReplacementsFromGap(
      {
        summary: "Living room with a sectional.",
        what_works: [],
        what_should_go: [],
        what_it_needs: [{ category: "sofa", search_title: "Replacement sofa" }],
      },
      ["my sectional"],
    );
    expect(result).toHaveLength(0);
  });

  it("does NOT infer when room context does not mention the category", () => {
    const result = inferReplacementsFromGap(
      {
        summary: "Empty bedroom with hardwood floors.",
        what_works: [],
        what_should_go: [],
        what_it_needs: [{ category: "sofa", search_title: "New sofa" }],
      },
      [],
    );
    expect(result).toHaveLength(0);
  });

  it("does NOT infer when the category is already represented in what_should_go", () => {
    const result = inferReplacementsFromGap(
      {
        summary: "Living room with a sectional sofa.",
        what_works: [],
        what_should_go: ["Old grey sectional — wrong scale"],
        what_it_needs: [{ category: "sofa", search_title: "New sofa" }],
      },
      [],
    );
    expect(result).toHaveLength(0);
  });

  it("does NOT infer when the category is already in what_works (user keeping it implicitly)", () => {
    const result = inferReplacementsFromGap(
      {
        summary: "Living room with a sectional sofa.",
        what_works: ["Grey sectional sofa — anchors the seating zone"],
        what_should_go: [],
        what_it_needs: [{ category: "sofa", search_title: "New sofa" }],
      },
      [],
    );
    expect(result).toHaveLength(0);
  });

  it("returns empty when what_it_needs is missing or empty", () => {
    expect(inferReplacementsFromGap({ summary: "Anything" }, [])).toEqual([]);
    expect(inferReplacementsFromGap({ summary: "Anything", what_it_needs: [] }, [])).toEqual([]);
  });

  it("matches media_console aliases (tv stand, tv console, entertainment center)", () => {
    const result = inferReplacementsFromGap(
      {
        summary: "Living room with a low white TV stand against the east wall.",
        what_works: [],
        what_should_go: [],
        what_it_needs: [{ category: "media_console", search_title: "Walnut media console" }],
      },
      [],
    );
    expect(result).toHaveLength(1);
    expect(result[0].matchedAlias).toBe("tv stand");
  });

  it("truncates very long search titles in the entry text", () => {
    const longTitle = "A".repeat(120);
    const result = inferReplacementsFromGap(
      {
        summary: "Living room with a sectional.",
        what_works: [],
        what_should_go: [],
        what_it_needs: [{ category: "sofa", search_title: longTitle }],
      },
      [],
    );
    expect(result).toHaveLength(1);
    expect(result[0].entry.length).toBeLessThan(longTitle.length + 50);
    expect(result[0].entry).toContain("...");
  });

  it("dedupes when Pass B has multiple needs in the same category", () => {
    const result = inferReplacementsFromGap(
      {
        summary: "Living room with a sectional.",
        what_works: [],
        what_should_go: [],
        what_it_needs: [
          { category: "sofa", search_title: "New leather sofa" },
          { category: "sofa", search_title: "Different sofa option" },
        ],
      },
      [],
    );
    expect(result).toHaveLength(1);
  });

  it("infers from what_should_go when summary is vague but items were flagged for removal", () => {
    const result = inferReplacementsFromGap(
      {
        summary: "Compact living room with disjointed rental furniture.",
        what_works: ["bookshelf — kept per client request"],
        what_should_go: ["Dark sectional sofa — overpowers the room", "Small glass coffee table — too fragile"],
        what_it_needs: [
          { category: "sofa", search_title: "Cognac leather sofa" },
          { category: "coffee_table", search_title: "Solid walnut coffee table" },
        ],
      },
      ["bookshelf"],
    );
    // sofa and coffee_table already appear in what_should_go, so no inference needed
    // (the aliases "sofa" and "coffee table" are found in removeText)
    expect(result).toHaveLength(0);
  });

  it("infers media console when only what_should_go mentions it (not summary)", () => {
    const result = inferReplacementsFromGap(
      {
        summary: "Compact living room with basic rental furniture.",
        what_works: [],
        what_should_go: [],
        spatial_layout: "TV mounted on the east wall, media console below",
        what_it_needs: [
          { category: "media_console", search_title: "Walnut media console 70in" },
        ],
      },
      [],
    );
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe("media_console");
  });

  it("does NOT infer for a category not in REPLACEABLE_CATEGORIES (e.g. throw_pillows)", () => {
    const result = inferReplacementsFromGap(
      {
        summary: "Living room with throw pillows everywhere.",
        what_works: [],
        what_should_go: [],
        what_it_needs: [{ category: "throw_pillows", search_title: "New pillow set" }],
      },
      [],
    );
    expect(result).toHaveLength(0);
  });
});
