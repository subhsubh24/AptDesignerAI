import { describe, it, expect } from "vitest";
import { filterUnanchoredItems } from "@/lib/agents/self-correction";

const baseAnalysis = {
  summary:
    "A 450-sqft studio with grey LVP flooring and floor-to-ceiling windows. " +
    "Contains a grey fabric sectional, a small wooden coffee table, a " +
    "black metal TV stand, and blue plastic storage bins under the desk. " +
    "Built-in closet with sliding mirror doors.",
  style_name: "Nordic Charcoal",
  design_direction: "Cool-neutral canvas with warm accents.",
  recommended_palette: ["charcoal grey", "warm cream", "natural oak"],
  recommended_materials: ["solid oak", "linen", "brushed brass"],
  what_works: [
    "Grey fabric sectional — good scale for the room",
    "Wooden coffee table — warm tone balances grey floor",
  ],
  what_should_go: [
    "Black metal TV stand — undersized, cheap laminate finish",
    "Blue plastic storage bins — visual clutter under desk",
  ],
  what_it_needs: [
    {
      category: "area_rug",
      search_title: "Wool area rug warm cream",
      description: "Defines living zone, softens LVP",
      priority: "high",
      specs: "9x12 ft hand-tufted",
    },
    {
      category: "floor_lamp",
      search_title: "Matte black arc floor lamp",
      description: "Task lighting for reading corner",
      priority: "medium",
      specs: "60 inch tall",
    },
  ],
};

describe("filterUnanchoredItems", () => {
  it("keeps entries anchored in the summary", () => {
    const result = filterUnanchoredItems(baseAnalysis, []);
    expect(result.what_should_go).toContainEqual(
      expect.stringContaining("Black metal TV stand"),
    );
  });

  it("keeps entries anchored in keepItems", () => {
    const analysis = {
      ...baseAnalysis,
      what_should_go: ["Worn leather ottoman — cracked surface"],
    };
    const result = filterUnanchoredItems(analysis, ["leather ottoman"]);
    expect(result.what_should_go).toHaveLength(1);
  });

  it("drops cross-reference hallucinations (rug pattern)", () => {
    // The hallucinated rug entry has tokens that ALL match what_it_needs
    // categories (area, rug) but no anchor in summary or keepItems. This is
    // the classic "Pass A invents an existing item to mirror a recommended
    // purchase" pattern.
    const analysis = {
      ...baseAnalysis,
      what_should_go: [
        ...baseAnalysis.what_should_go,
        "Undersized, synthetic area rug — fails to ground the seating area",
      ],
    };
    const result = filterUnanchoredItems(analysis, []);
    const list = result.what_should_go as string[];
    expect(list).not.toContainEqual(
      expect.stringContaining("synthetic area rug"),
    );
    expect(list).toHaveLength(2);
  });

  it("TRUSTS Pass A on items not in summary but with concrete object names", () => {
    // The summary doesn't mention bean bag chair or polyester pillows, but
    // Pass A saw the photos and listed them. Self-corrector and filter
    // CANNOT see photos — they should NOT drop these.
    const analysis = {
      summary: "Studio apartment with grey LVP flooring and undersized juvenile furniture overall.",
      what_should_go: [
        "Bean bag chair — undersized, juvenile aesthetic",
        "Folding metal TV tray table — wrong material story",
        "Plastic storage crates — visible clutter",
        "Mismatched polyester throw pillows — competing patterns",
      ],
      what_it_needs: [
        { category: "sofa", description: "primary seating", priority: "high", specs: "..." },
        { category: "coffee_table", description: "anchors zone", priority: "high", specs: "..." },
      ],
    };
    const result = filterUnanchoredItems(analysis, []);
    expect(result.what_should_go).toHaveLength(4);
  });

  it("drops cross-reference hallucination but keeps unrelated what_should_go items", () => {
    const analysis = {
      summary: "Studio apartment with juvenile furniture.",
      what_should_go: [
        "Bean bag chair — wrong scale",
        "Undersized area rug — threadbare", // cross-ref: head "area rug" matches "area_rug"
      ],
      what_it_needs: [
        { category: "area_rug", description: "...", priority: "high", specs: "..." },
        { category: "sofa", description: "...", priority: "high", specs: "..." },
      ],
    };
    const result = filterUnanchoredItems(analysis, []);
    const list = result.what_should_go as string[];
    expect(list).toHaveLength(1);
    expect(list[0]).toContain("Bean bag chair");
  });

  it("keeps what_works entries anchored in summary", () => {
    const result = filterUnanchoredItems(baseAnalysis, []);
    expect(result.what_works).toHaveLength(2);
  });

  it("drops what_works entries not grounded anywhere", () => {
    const analysis = {
      ...baseAnalysis,
      what_works: [
        ...baseAnalysis.what_works,
        "Woven rattan basket — nice texture accent",
      ],
    };
    const result = filterUnanchoredItems(analysis, []);
    expect(result.what_works).toHaveLength(2);
    expect(result.what_works).not.toContainEqual(
      expect.stringContaining("rattan basket"),
    );
  });

  it("cross-grounds what_works against what_should_go (both describe existing items)", () => {
    const analysis = {
      ...baseAnalysis,
      what_works: [
        "Black metal TV stand — functional, holds equipment well",
      ],
    };
    // "TV stand" appears in what_should_go, so it's a known existing item
    const result = filterUnanchoredItems(analysis, []);
    expect(result.what_works).toHaveLength(1);
  });

  it("does not mutate the input analysis", () => {
    const before = JSON.stringify(baseAnalysis);
    filterUnanchoredItems(baseAnalysis, []);
    expect(JSON.stringify(baseAnalysis)).toBe(before);
  });

  it("handles missing arrays gracefully", () => {
    const analysis = { summary: "Empty room." };
    const result = filterUnanchoredItems(analysis, []);
    expect(result.what_should_go).toBeUndefined();
    expect(result.what_works).toBeUndefined();
  });

  it("anchors 'sectional' against keepItems mentioning 'sofa' (synonym)", () => {
    // The user says "sofa", the analysis says "sectional" — both are the
    // same physical item. Without synonyms, the filter drops the entry.
    const analysis = {
      summary: "A 14x14 living area with grey LVP flooring and a TV stand.",
      what_works: [
        "Neutral, deep-seated sectional base — provides good footprint",
      ],
    };
    const result = filterUnanchoredItems(analysis, [
      "black arc floor lamp behind the sofa",
    ]);
    expect(result.what_works).toHaveLength(1);
  });

  it("anchors 'couch' against summary mentioning 'sofa'", () => {
    const analysis = {
      summary: "Living room contains a grey fabric sofa and a coffee table.",
      what_works: ["Grey fabric couch — anchors the seating zone"],
    };
    const result = filterUnanchoredItems(analysis, []);
    expect(result.what_works).toHaveLength(1);
  });

  it("anchors 'bookcase' against keepItems mentioning 'bookshelf'", () => {
    const analysis = {
      summary: "Studio apartment with hardwood floors.",
      what_works: ["Black metal bookcase — modular, fits the corner"],
    };
    const result = filterUnanchoredItems(analysis, ["bookshelf"]);
    expect(result.what_works).toHaveLength(1);
  });

  it("anchors 'carpet' against summary mentioning 'rug'", () => {
    const analysis = {
      summary: "Bedroom with an existing wool area rug.",
      what_works: ["Wool carpet — defines sleeping zone"],
    };
    const result = filterUnanchoredItems(analysis, []);
    expect(result.what_works).toHaveLength(1);
  });

  it("drops 'plastic side table' when 'table' is only a weak anchor from 'coffee table' in summary", () => {
    const analysis = {
      summary: "Living room with a sectional sofa and a glass coffee table.",
      what_should_go: [
        "Mismatched plastic side table — wrong scale",
      ],
      what_it_needs: [
        { category: "side_table", search_title: "Walnut end table" },
      ],
    };
    const result = filterUnanchoredItems(analysis, []);
    const list = result.what_should_go as string[];
    expect(list).toHaveLength(0);
  });

  it("drops cross-reference via category synonyms (side_table matches end_table in needs)", () => {
    const analysis = {
      summary: "Studio with a desk and a floor lamp.",
      what_should_go: [
        "Plastic side table — too small",
      ],
      what_it_needs: [
        { category: "end_table", search_title: "Walnut end table" },
      ],
    };
    const result = filterUnanchoredItems(analysis, []);
    const list = result.what_should_go as string[];
    expect(list).toHaveLength(0);
  });

  it("keeps a genuinely anchored side table (mentioned in summary)", () => {
    const analysis = {
      summary: "Living room with a plastic side table next to the sofa.",
      what_should_go: [
        "Plastic side table — wrong material",
      ],
      what_it_needs: [
        { category: "side_table", search_title: "Walnut end table" },
      ],
    };
    const result = filterUnanchoredItems(analysis, []);
    const list = result.what_should_go as string[];
    expect(list).toHaveLength(1);
  });

  it("keeps photo-verified entries even when they match a needs category", () => {
    const analysis = {
      summary: "Studio with a desk and a floor lamp.",
      what_should_go: [
        "Laminate media console — cheap finish",
        "Metal-frame coffee table — cold aesthetic",
        "Plastic side table — too small",
      ],
      what_it_needs: [
        { category: "media_console", search_title: "Walnut media console" },
        { category: "coffee_table", search_title: "Oak coffee table" },
        { category: "side_table", search_title: "Walnut end table" },
      ],
    };
    const photoVerified = [
      "Laminate media console — cheap finish",
      "Metal-frame coffee table — cold aesthetic",
    ];
    const result = filterUnanchoredItems(analysis, [], photoVerified);
    const list = result.what_should_go as string[];
    expect(list).toContainEqual(expect.stringContaining("media console"));
    expect(list).toContainEqual(expect.stringContaining("coffee table"));
    // Non-verified entry still gets dropped
    expect(list).not.toContainEqual(expect.stringContaining("side table"));
  });
});
