import { describe, it, expect } from "vitest";
import { applyAnalysisPatch } from "@/lib/agents/apply-analysis-patch";
import type { AnalysisPatch } from "@/lib/types/database";

const baseAnalysis = {
  summary: "A 450-sqft studio with grey LVP flooring.",
  style_name: "Nordic Charcoal",
  design_direction: "Cool-neutral canvas with warm accents.",
  recommended_palette: ["charcoal grey", "warm cream", "natural oak"],
  recommended_materials: ["solid oak", "linen", "brushed brass"],
  what_works: [
    "IKEA Kivik sectional in Hillared anthracite — good scale",
    "White oak floating shelves — warm tone balances grey floor",
  ],
  what_should_go: [
    "Black metal folding TV tray — undersized",
    "Blue plastic storage bins — visual clutter",
  ],
  what_it_needs: [
    {
      category: "sofa",
      search_title: "Mid-century cognac leather sofa",
      description: "Anchors living zone with warm tone",
      priority: "high" as const,
      specs: "86 inch wide, full-grain leather",
    },
    {
      category: "rug",
      search_title: "Wool area rug warm cream",
      description: "Defines living zone",
      priority: "high" as const,
      specs: "9x12 ft hand-tufted",
    },
  ],
};

describe("applyAnalysisPatch", () => {
  it("returns input unchanged when patch is empty", () => {
    const { analysis, changedFields } = applyAnalysisPatch(baseAnalysis, {});
    expect(changedFields).toEqual([]);
    expect(analysis).toEqual(baseAnalysis);
  });

  it("overwrites scalar fields", () => {
    const patch: AnalysisPatch = {
      style_name: "Industrial Warmth",
      design_direction: "Lean into cognac and matte black.",
    };
    const { analysis, changedFields } = applyAnalysisPatch(baseAnalysis, patch);
    expect(analysis.style_name).toBe("Industrial Warmth");
    expect(analysis.design_direction).toBe("Lean into cognac and matte black.");
    expect(changedFields).toContain("style_name");
    expect(changedFields).toContain("design_direction");
    // Untouched fields preserved
    expect(analysis.summary).toBe(baseAnalysis.summary);
  });

  it("replaces palette array fully", () => {
    const patch: AnalysisPatch = {
      recommended_palette: ["cognac brown", "matte black", "warm cream"],
    };
    const { analysis } = applyAnalysisPatch(baseAnalysis, patch);
    expect(analysis.recommended_palette).toEqual([
      "cognac brown",
      "matte black",
      "warm cream",
    ]);
  });

  it("adds and removes from what_should_go via diff", () => {
    const patch: AnalysisPatch = {
      what_should_go: {
        add: ["Mismatched throw pillows — competing patterns"],
        remove: ["Black metal folding TV tray"],
      },
    };
    const { analysis, changedFields } = applyAnalysisPatch(baseAnalysis, patch);
    const list = analysis.what_should_go as string[];
    expect(list).toHaveLength(2);
    expect(list).not.toContainEqual(expect.stringContaining("Black metal folding TV tray"));
    expect(list).toContainEqual(expect.stringContaining("Mismatched throw pillows"));
    expect(changedFields).toContain("what_should_go");
  });

  it("dedupes when adding an entry that already exists by head", () => {
    const patch: AnalysisPatch = {
      what_works: {
        add: ["IKEA Kivik sectional in Hillared anthracite — different reason"],
      },
    };
    const { analysis } = applyAnalysisPatch(baseAnalysis, patch);
    const list = analysis.what_works as string[];
    expect(list).toHaveLength(2); // No duplicate added
  });

  it("updates a what_it_needs item by category slug", () => {
    const patch: AnalysisPatch = {
      what_it_needs: {
        update: [
          {
            category: "sofa",
            changes: {
              search_title: "Cream linen track-arm sofa",
              description: "Anchors living zone with cool tone",
            },
          },
        ],
      },
    };
    const { analysis, changedFields } = applyAnalysisPatch(baseAnalysis, patch);
    const items = analysis.what_it_needs as Array<{ category: string; search_title?: string; priority?: string }>;
    const sofa = items.find((i) => i.category === "sofa");
    expect(sofa?.search_title).toBe("Cream linen track-arm sofa");
    // Other fields preserved
    expect(sofa?.priority).toBe("high");
    // Other items untouched
    expect(items.find((i) => i.category === "rug")?.search_title).toBe("Wool area rug warm cream");
    expect(changedFields).toContain("what_it_needs.sofa");
  });

  it("removes a what_it_needs item by category", () => {
    const patch: AnalysisPatch = {
      what_it_needs: { remove: ["rug"] },
    };
    const { analysis } = applyAnalysisPatch(baseAnalysis, patch);
    const items = analysis.what_it_needs as Array<{ category: string }>;
    expect(items).toHaveLength(1);
    expect(items[0].category).toBe("sofa");
  });

  it("adds a new what_it_needs item", () => {
    const patch: AnalysisPatch = {
      what_it_needs: {
        add: [
          {
            category: "floor_lamp",
            search_title: "Matte black arc floor lamp",
            description: "Adds task lighting to reading zone",
            priority: "medium",
            specs: "60 inch tall, brass trim",
          },
        ],
      },
    };
    const { analysis } = applyAnalysisPatch(baseAnalysis, patch);
    const items = analysis.what_it_needs as Array<{ category: string }>;
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.category)).toContain("floor_lamp");
  });

  it("treats add of an existing category as update (no duplicates)", () => {
    const patch: AnalysisPatch = {
      what_it_needs: {
        add: [
          {
            category: "sofa",
            description: "Updated description via add",
            priority: "high",
            specs: "86 inch wide, cream linen",
          },
        ],
      },
    };
    const { analysis } = applyAnalysisPatch(baseAnalysis, patch);
    const items = analysis.what_it_needs as Array<{ category: string; description: string }>;
    expect(items).toHaveLength(2); // No duplicate
    const sofa = items.find((i) => i.category === "sofa");
    expect(sofa?.description).toBe("Updated description via add");
  });

  it("does not mutate the input analysis", () => {
    const before = JSON.stringify(baseAnalysis);
    applyAnalysisPatch(baseAnalysis, {
      style_name: "Industrial Warmth",
      what_it_needs: { remove: ["sofa"] },
    });
    expect(JSON.stringify(baseAnalysis)).toBe(before);
  });
});
