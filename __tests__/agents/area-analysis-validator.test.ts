import { describe, it, expect } from "vitest";
import { validateAreaAnalysis } from "@/lib/agents/area-analysis-validator";

// validateAreaAnalysis is a deterministic post-LLM constraint patcher: it strips
// architectural features from what_works, non-removable entries from
// what_should_go, and user-excluded items from what_it_needs — without calling
// an LLM. These tests exercise the regex-fallback path (no semanticHints), which
// is what runs whenever the LLM hint pass is unavailable.

describe("validateAreaAnalysis", () => {
  it("leaves a clean analysis untouched and reports wasModified=false", () => {
    const analysis = {
      what_works: ["the leather sofa", "warm wood console"],
      what_should_go: ["the sagging bean bag"],
      what_it_needs: [{ category: "coffee_table", search_title: "walnut coffee table" }],
    };
    const result = validateAreaAnalysis(analysis, []);
    expect(result.wasModified).toBe(false);
    expect(result.issues).toHaveLength(0);
    expect(result.patched.what_it_needs).toHaveLength(1);
    expect(result.patched.what_works).toEqual(analysis.what_works);
  });

  it("strips architectural features out of what_works", () => {
    const analysis = {
      what_works: ["hardwood flooring", "the quartz countertop", "the velvet armchair"],
      what_should_go: [],
      what_it_needs: [],
    };
    const result = validateAreaAnalysis(analysis, []);
    expect(result.wasModified).toBe(true);
    // The armchair is movable furniture and stays; the two architectural items go.
    expect(result.patched.what_works).toEqual(["the velvet armchair"]);
    const archIssues = result.issues.filter((i) => i.type === "architectural_in_keeps");
    expect(archIssues).toHaveLength(2);
    expect(archIssues.every((i) => i.action === "removed")).toBe(true);
  });

  it("strips non-removable phrasing out of what_should_go", () => {
    const analysis = {
      what_works: [],
      what_should_go: ["lack of storage", "the builder-grade ceiling light", "the worn ottoman"],
      what_it_needs: [],
    };
    const result = validateAreaAnalysis(analysis, []);
    expect(result.wasModified).toBe(true);
    // Only a real, removable physical item survives.
    expect(result.patched.what_should_go).toEqual(["the worn ottoman"]);
    expect(result.issues.some((i) => i.type === "invalid_remove")).toBe(true);
  });

  it("removes recommendations the user explicitly excluded (with synonym expansion)", () => {
    const analysis = {
      what_works: [],
      what_should_go: [],
      what_it_needs: [
        { category: "curtains", search_title: "linen drapery panels" },
        { category: "coffee_table", search_title: "oak coffee table" },
      ],
    };
    // "don't need curtains" → parsed as an exclusion; mentionsAny scans the
    // item's combined category+title+description text against the expanded
    // exclusion set (curtains/drapery/...), so the linen-drapery item matches.
    const result = validateAreaAnalysis(analysis, [], "I don't need curtains.");
    expect(result.wasModified).toBe(true);
    expect(result.patched.what_it_needs).toHaveLength(1);
    expect(result.patched.what_it_needs[0].category).toBe("coffee_table");
    expect(result.issues.some((i) => i.type === "exclusion_violation")).toBe(true);
  });

  it("does not mutate the caller's original analysis object", () => {
    const analysis = {
      what_works: ["hardwood flooring"],
      what_should_go: [],
      what_it_needs: [],
    };
    validateAreaAnalysis(analysis, []);
    // Deep-clone contract: the input still has its architectural entry.
    expect(analysis.what_works).toEqual(["hardwood flooring"]);
  });

  it("handles missing array fields without throwing", () => {
    const result = validateAreaAnalysis({}, []);
    expect(result.wasModified).toBe(false);
    expect(result.issues).toHaveLength(0);
  });

  // --- Check 2: keep-item violations ---
  it("removes a kept item that the LLM put in what_should_go (keep_item_in_remove)", () => {
    const analysis = {
      what_works: [],
      what_should_go: ["the old sofa"],
      what_it_needs: [],
    };
    // Keep "the leather sofa" → category keywords include "sofa"; the removal
    // suggestion "the old sofa" matches that kept item and must be stripped.
    const result = validateAreaAnalysis(analysis, ["the leather sofa"]);
    expect(result.wasModified).toBe(true);
    expect(result.patched.what_should_go).toEqual([]);
    expect(result.issues.some((i) => i.type === "keep_item_in_remove")).toBe(true);
  });

  // --- Check 3: missing explicit requests ---
  it("auto-injects an explicitly requested item that is missing from what_it_needs (missing_request)", () => {
    const result = validateAreaAnalysis(
      { what_works: [], what_should_go: [], what_it_needs: [] },
      [],
      undefined,
      {
        exclusions: [],
        explicitRequests: [{ item: "coffee table", wantsMultiple: false }],
        additionalKeepItems: [],
        lifestyleNotes: [],
        rawContext: "",
      },
    );
    expect(result.wasModified).toBe(true);
    expect(result.patched.what_it_needs).toHaveLength(1);
    expect(result.patched.what_it_needs[0].category).toBe("coffee_table");
    expect(result.patched.what_it_needs[0]._injected_by_validator).toBe(true);
    expect(result.issues.some((i) => i.type === "missing_request")).toBe(true);
  });

  it("only flags (does not inject) an abstract request, and a flag alone does not set wasModified", () => {
    const result = validateAreaAnalysis(
      { what_works: [], what_should_go: [], what_it_needs: [] },
      [],
      undefined,
      {
        exclusions: [],
        explicitRequests: [{ item: "something cozy and impressive", wantsMultiple: false }],
        additionalKeepItems: [],
        lifestyleNotes: [],
        rawContext: "",
      },
    );
    // No concrete category → flagged, not injected. wasModified is true only when
    // an issue has action "removed"; a lone "flagged" issue leaves it false.
    expect(result.patched.what_it_needs).toHaveLength(0);
    const missing = result.issues.filter((i) => i.type === "missing_request");
    expect(missing).toHaveLength(1);
    expect(missing[0].action).toBe("flagged");
    expect(result.wasModified).toBe(false);
  });

  // --- Check 4: furniture pairing ---
  it("auto-injects the missing companion of a recommended pair (dining_chairs → dining_table)", () => {
    const analysis = {
      what_works: [],
      what_should_go: [],
      what_it_needs: [{ category: "dining_chairs", search_title: "oak dining chairs" }],
    };
    const result = validateAreaAnalysis(analysis, []);
    expect(result.wasModified).toBe(true);
    expect(
      result.patched.what_it_needs.some((i: { category?: string }) => i.category === "dining_table"),
    ).toBe(true);
    expect(result.issues.some((i) => i.type === "furniture_pairing")).toBe(true);
  });

  it("only flags (does not inject) a companion that is usually already present (bar_stool → kitchen_island)", () => {
    const analysis = {
      what_works: [],
      what_should_go: [],
      what_it_needs: [{ category: "bar_stool", search_title: "counter stools" }],
    };
    const result = validateAreaAnalysis(analysis, []);
    // The kitchen island/counter is part of the architecture, so we flag rather
    // than inject — and a lone flag does not modify the output.
    expect(result.patched.what_it_needs).toHaveLength(1);
    const pairing = result.issues.filter((i) => i.type === "furniture_pairing");
    expect(pairing).toHaveLength(1);
    expect(pairing[0].action).toBe("flagged");
    expect(result.wasModified).toBe(false);
  });
});
