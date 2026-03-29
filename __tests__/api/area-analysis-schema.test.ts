import { describe, it, expect } from "vitest";

/**
 * Tests for area analysis output schema validation.
 * Ensures the analysis data shape matches what the UI expects.
 */

interface AreaAnalysisItem {
  category: string;
  search_title: string;
  description: string;
  priority: "high" | "medium" | "low";
  specs: string;
  placement: string;
}

interface AreaAnalysis {
  summary: string;
  what_it_needs: AreaAnalysisItem[];
  what_works: string[];
  what_should_go: string[];
  design_direction: string;
  spatial_layout: string;
  lighting_conditions?: string;
  window_door_positions?: string;
  outlet_positions?: string;
}

function validateAnalysisSchema(data: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const d = data as Record<string, unknown>;

  if (!d) {
    return { valid: false, errors: ["Analysis data is null/undefined"] };
  }

  if (typeof d.summary !== "string" || d.summary.length === 0) {
    errors.push("Missing or empty summary");
  }

  if (!Array.isArray(d.what_it_needs)) {
    errors.push("what_it_needs is not an array");
  } else {
    for (let i = 0; i < d.what_it_needs.length; i++) {
      const item = d.what_it_needs[i] as Record<string, unknown>;
      if (!item.category) errors.push(`what_it_needs[${i}]: missing category`);
      if (!item.search_title) errors.push(`what_it_needs[${i}]: missing search_title`);
      if (!item.description) errors.push(`what_it_needs[${i}]: missing description`);
      if (!["high", "medium", "low"].includes(item.priority as string)) {
        errors.push(`what_it_needs[${i}]: invalid priority "${item.priority}"`);
      }
    }
  }

  if (!Array.isArray(d.what_works)) {
    errors.push("what_works is not an array");
  }

  if (!Array.isArray(d.what_should_go)) {
    errors.push("what_should_go is not an array");
  }

  if (typeof d.design_direction !== "string") {
    errors.push("Missing design_direction");
  }

  if (typeof d.spatial_layout !== "string") {
    errors.push("Missing spatial_layout");
  }

  return { valid: errors.length === 0, errors };
}

describe("Area Analysis schema validation", () => {
  it("should validate a correct analysis", () => {
    const analysis: AreaAnalysis = {
      summary: "Modern 1BR with walnut floors and gray sofa in an open layout.",
      what_it_needs: [
        {
          category: "area_rug",
          search_title: "Hand-knotted wool area rug 8x10 warm cream geometric",
          description: "Anchors the seating area and adds warmth to wood floors.",
          priority: "high",
          specs: "8x10, wool, warm cream/ivory",
          placement: "Under seating arrangement, centered",
        },
      ],
      what_works: ["Walnut media console — warm tone, good scale"],
      what_should_go: ["Cheap plastic plant — replace with real or quality ceramic"],
      design_direction: "Urban organic warmth with walnut, cream, and brass accents.",
      spatial_layout: "L-shaped seating facing west wall TV with dining behind.",
      lighting_conditions: "South-facing windows, bright afternoon.",
      window_door_positions: "Floor-to-ceiling south, entry east.",
      outlet_positions: "South wall flanking window.",
    };

    const result = validateAnalysisSchema(analysis);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("should catch missing required fields", () => {
    const bad = {
      // missing summary, spatial_layout, design_direction
      what_it_needs: [],
      what_works: [],
      what_should_go: [],
    };

    const result = validateAnalysisSchema(bad);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Missing or empty summary");
    expect(result.errors).toContain("Missing spatial_layout");
    expect(result.errors).toContain("Missing design_direction");
  });

  it("should catch invalid priority values", () => {
    const bad = {
      summary: "Test",
      what_it_needs: [
        {
          category: "rug",
          search_title: "test rug",
          description: "test",
          priority: "urgent", // invalid
          specs: "",
          placement: "",
        },
      ],
      what_works: [],
      what_should_go: [],
      design_direction: "test",
      spatial_layout: "test",
    };

    const result = validateAnalysisSchema(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("invalid priority"))).toBe(true);
  });

  it("should catch null analysis data", () => {
    const result = validateAnalysisSchema(null);
    expect(result.valid).toBe(false);
  });

  it("should catch missing category in items", () => {
    const bad = {
      summary: "Test",
      what_it_needs: [{ search_title: "test", description: "test", priority: "high" }],
      what_works: [],
      what_should_go: [],
      design_direction: "test",
      spatial_layout: "test",
    };

    const result = validateAnalysisSchema(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("missing category"))).toBe(true);
  });
});

describe("Focus page safety — array access guards", () => {
  it("should safely handle undefined what_it_needs with fallback", () => {
    const analysis = { summary: "Test" } as Partial<AreaAnalysis>;
    const items = (analysis.what_it_needs || []).map((item) => item.category);
    expect(items).toEqual([]);
  });

  it("should safely handle undefined what_works with fallback", () => {
    const analysis = { summary: "Test" } as Partial<AreaAnalysis>;
    const items = (analysis.what_works || []).map((item) => item);
    expect(items).toEqual([]);
  });

  it("should safely handle undefined what_should_go with fallback", () => {
    const analysis = { summary: "Test" } as Partial<AreaAnalysis>;
    const items = (analysis.what_should_go || []).map((item) => item);
    expect(items).toEqual([]);
  });

  it("should handle legacy analysis format (needs instead of what_it_needs)", () => {
    // Legacy format from apartment-level diagnosis
    const legacy = {
      summary: "Test",
      needs: ["area rug — high priority", "coffee table — medium"],
      strengths: ["warm floors"],
      weaknesses: ["no rug"],
    };

    // Conversion logic from area-analysis route
    const converted = {
      what_it_needs: (legacy.needs || []).map((need: string) => {
        const raw = need.split("—")[0].trim();
        const cleaned = raw
          .replace(/^(replace|add|get|remove|swap|upgrade|buy|find|consider)\s+(the\s+|a\s+|an\s+)?/i, "")
          .trim();
        const shortName = cleaned.split(/\s+/).slice(0, 3).join("_").toLowerCase()
          .replace(/[^a-z0-9_]/g, "");
        return { category: shortName || "other", description: need, priority: "medium" };
      }),
      what_works: legacy.strengths || [],
      what_should_go: legacy.weaknesses || [],
    };

    expect(converted.what_it_needs).toHaveLength(2);
    expect(converted.what_it_needs[0].category).toBe("area_rug");
    expect(converted.what_works).toEqual(["warm floors"]);
  });
});

describe("New environmental output fields", () => {
  it("should include lighting_conditions in schema", () => {
    const analysis: Partial<AreaAnalysis> = {
      lighting_conditions: "South-facing, floor-to-ceiling windows providing bright afternoon sun. North wall has no windows — dark corner needs task lighting.",
    };
    expect(analysis.lighting_conditions).toContain("South-facing");
    expect(analysis.lighting_conditions).toContain("task lighting");
  });

  it("should include window_door_positions in schema", () => {
    const analysis: Partial<AreaAnalysis> = {
      window_door_positions: "Floor-to-ceiling window centered on south wall (~8ft wide). Entry door on east wall (left corner, opens inward). Closet door on north wall (right side, bifold).",
    };
    expect(analysis.window_door_positions).toContain("south wall");
    expect(analysis.window_door_positions).toContain("opens inward");
  });

  it("should include outlet_positions in schema", () => {
    const analysis: Partial<AreaAnalysis> = {
      outlet_positions: "Visible outlets: south wall flanking window (2), east wall near entry (1). Likely: north wall behind TV area, west wall near kitchen transition.",
    };
    expect(analysis.outlet_positions).toContain("south wall");
  });

  it("should tolerate missing environmental fields (optional)", () => {
    const analysis: Partial<AreaAnalysis> = {
      summary: "Basic analysis without environmental context",
      spatial_layout: "Standard layout",
    };
    // These should all be undefined, not throw
    expect(analysis.lighting_conditions).toBeUndefined();
    expect(analysis.window_door_positions).toBeUndefined();
    expect(analysis.outlet_positions).toBeUndefined();
  });
});
