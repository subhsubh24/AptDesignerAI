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

  it("drops what_should_go entries NOT grounded in summary or keepItems", () => {
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

  it("does NOT let what_it_needs falsely ground what_should_go entries", () => {
    const analysis = {
      ...baseAnalysis,
      what_should_go: [
        "Worn sisal rug — threadbare, wrong scale",
      ],
    };
    // "area_rug" is in what_it_needs with "rug" in its description,
    // but "rug" / "sisal" are NOT in the summary or keepItems.
    // The filter must drop it — future purchases don't prove existence.
    const result = filterUnanchoredItems(analysis, []);
    expect(result.what_should_go).toHaveLength(0);
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
});
