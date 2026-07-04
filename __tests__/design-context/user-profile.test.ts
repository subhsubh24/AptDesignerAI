import { describe, it, expect } from "vitest";
import { getDesignContextPrompt } from "@/lib/design-context/user-profile";
import type { PreferenceSignals } from "@/lib/design-context/infer-preferences";
import type { ExtractedFloorPlan } from "@/lib/types/database";

/**
 * getDesignContextPrompt builds the system-prompt context every design agent
 * sees. It is a pure, branch-rich formatter (location / building / finishes /
 * floor-plan matched-vs-fallback / extracted floor plan / analysis / layout /
 * inferred preferences / lifestyle) with a default fallback — and had zero
 * tests. These pin the real conditional behaviour so a refactor can't silently
 * drop a section or leak the wrong branch.
 */

describe("getDesignContextPrompt — default fallback", () => {
  it("returns the default context when no profile is given", () => {
    const out = getDesignContextPrompt();
    expect(out).toContain("## DESIGN APPROACH");
    expect(out).toContain("## GENERAL GUIDELINES");
  });

  it("returns the default context when the profile has no usable sections", () => {
    const out = getDesignContextPrompt({});
    expect(out).toContain("## DESIGN APPROACH");
    // A truly empty profile must NOT emit any of the dynamic section headers.
    expect(out).not.toContain("## LOCATION");
    expect(out).not.toContain("## APARTMENT LAYOUT");
  });
});

describe("getDesignContextPrompt — location", () => {
  it("emits city, and only appends state/neighborhood/building when present", () => {
    const cityOnly = getDesignContextPrompt({ location: { city: "Brooklyn" } });
    expect(cityOnly).toContain("## LOCATION");
    expect(cityOnly).toContain("- City: Brooklyn");
    expect(cityOnly).not.toContain("- Neighborhood:");
    expect(cityOnly).not.toContain("- Building:");

    const full = getDesignContextPrompt({
      location: {
        city: "Brooklyn",
        state: "NY",
        neighborhood: "Williamsburg",
        building: "The Oosten",
      },
    });
    expect(full).toContain("- City: Brooklyn, NY");
    expect(full).toContain("- Neighborhood: Williamsburg");
    expect(full).toContain("- Building: The Oosten");
  });

  it("does not emit a LOCATION section when city is absent", () => {
    const out = getDesignContextPrompt({ location: { state: "NY" } });
    expect(out).not.toContain("## LOCATION");
  });
});

describe("getDesignContextPrompt — building context + finishes", () => {
  it("emits the building fields that are present", () => {
    const out = getDesignContextPrompt({
      buildingResearch: {
        building_style: "Pre-war brick",
        design_aesthetic: "warm industrial",
        layout_style: "open-plan",
        windows: "large casement",
        ceiling_height: "10 ft",
      },
    });
    expect(out).toContain("## BUILDING CONTEXT");
    expect(out).toContain("- Architecture: Pre-war brick");
    expect(out).toContain("- Aesthetic: warm industrial");
    expect(out).toContain("- Layout style: open-plan");
    expect(out).toContain("- Windows: large casement");
    expect(out).toContain("- Ceiling height: 10 ft");
  });

  it("emits an APARTMENT FINISHES section from building.finishes", () => {
    const out = getDesignContextPrompt({
      buildingResearch: {
        finishes: { flooring: "white oak", countertops: "quartz" },
      },
    });
    expect(out).toContain("## APARTMENT FINISHES");
    expect(out).toContain("- Floors: white oak");
    expect(out).toContain("- Countertops: quartz");
  });

  it("emits a BUILDING SUMMARY section", () => {
    const out = getDesignContextPrompt({
      buildingResearch: { summary: "A boutique 40-unit loft conversion." },
    });
    expect(out).toContain("## BUILDING SUMMARY");
    expect(out).toContain("A boutique 40-unit loft conversion.");
  });
});

describe("getDesignContextPrompt — floor plan (matched vs fallback)", () => {
  it("uses the matched unit as the authoritative layout", () => {
    const out = getDesignContextPrompt({
      buildingResearch: {
        floor_plan: {
          unit_type_searched: "1BR",
          matched_unit: {
            match_method: "sqft",
            confidence: "high",
            variant: {
              name: "A2",
              sqft: 850,
              room_layout: "open living/dining",
              room_dimensions: { living_room: "12x15", bedroom: "11x13" },
              notable_spatial_features: ["corner unit", "double exposure"],
            },
          },
        } as Record<string, unknown>,
      },
    });
    expect(out).toContain("## FLOOR PLAN");
    expect(out).toContain("- Unit type: 1BR");
    expect(out).toContain('- User\'s unit plan: "A2" (high confidence, matched via sqft)');
    expect(out).toContain("- Total: ~850 sqft");
    expect(out).toContain("- Layout: open living/dining");
    expect(out).toContain("- living_room: ~12x15");
    expect(out).toContain("- bedroom: ~11x13");
    expect(out).toContain("- Spatial notes: corner unit, double exposure");
    // Must NOT fall through to the building-wide variant list.
    expect(out).not.toContain("Possible variants");
  });

  it("falls back to building-wide summary + variant list when there is no confident match", () => {
    const out = getDesignContextPrompt({
      buildingResearch: {
        floor_plan: {
          total_sqft: 780,
          room_layout: "galley kitchen",
          unit_variants: [
            { name: "A1", sqft: 700 },
            { name: "A2", sqft: 850 },
          ],
          notable_spatial_features: ["north light"],
        } as Record<string, unknown>,
      },
    });
    expect(out).toContain("## FLOOR PLAN");
    expect(out).toContain("- Total: ~780 sqft");
    expect(out).toContain("- Layout: galley kitchen");
    expect(out).toContain("- Possible variants (unit not yet matched): A1 — 700 sqft; A2 — 850 sqft");
    expect(out).toContain("- Spatial notes: north light");
    expect(out).not.toContain("User's unit plan");
  });

  it("treats an explicit no_match as the fallback branch even when a variant is present", () => {
    // A TRUTHY variant paired with match_method:"no_match" is the only input that
    // isolates the `match_method !== "no_match"` guard: with a null variant the
    // `matchedVariant` falsy-check alone would route to fallback, so this fixture
    // ensures a regression that dropped the no_match check would be caught (it
    // would wrongly render the variant as the authoritative unit plan).
    const out = getDesignContextPrompt({
      buildingResearch: {
        floor_plan: {
          total_sqft: 640,
          matched_unit: {
            match_method: "no_match",
            variant: { name: "A2", sqft: 850 },
          },
        } as Record<string, unknown>,
      },
    });
    expect(out).toContain("- Total: ~640 sqft");
    expect(out).not.toContain("User's unit plan");
  });
});

describe("getDesignContextPrompt — extracted floor plan", () => {
  it("emits authoritative spatial data including window walls", () => {
    const extractedFloorPlan: ExtractedFloorPlan = {
      image_url: "https://example.com/plan.png",
      extracted_at: "2026-01-01T00:00:00Z",
      confidence: "high",
      total_sqft: 900,
      building_orientation: "north arrow up",
      scale_note: "1in = 8ft",
      rooms: [
        {
          room_type: "living_room",
          label: "Living/Dining",
          dimensions_text: "12 × 18 ft",
          shape: "rectangular",
          natural_light: "high",
          walls: [
            {
              direction: "north",
              features: [{ type: "window", position_on_wall: "center" }],
            },
            {
              direction: "south",
              features: [{ type: "window", position_on_wall: "right" }],
            },
            {
              direction: "east",
              features: [{ type: "door", position_on_wall: "left" }],
            },
          ],
        },
      ],
    };
    const out = getDesignContextPrompt({ extractedFloorPlan });
    expect(out).toContain("## UPLOADED FLOOR PLAN (authoritative spatial data)");
    expect(out).toContain("- Orientation: north arrow up");
    expect(out).toContain("- Total: ~900 sqft");
    expect(out).toContain("- Scale: 1in = 8ft");
    expect(out).toContain("- Confidence: high");
    // Two window-bearing walls (north + south) exercise the multi-direction join;
    // the door-only east wall is correctly excluded.
    expect(out).toContain("- Living/Dining (living_room) — ~12 × 18 ft — windows: north, south wall");
    expect(out).toContain("Do not infer or contradict this data from photos.");
  });
});

describe("getDesignContextPrompt — analysis, layout, preferences, lifestyle", () => {
  it("emits the apartment analysis overall", () => {
    const out = getDesignContextPrompt({
      apartmentAnalysis: { overall: "Bright, under-furnished, needs anchoring." },
    });
    expect(out).toContain("## APARTMENT ANALYSIS");
    expect(out).toContain("Bright, under-furnished, needs anchoring.");
  });

  it("defaults bedrooms/bathrooms to 1 when only one is given", () => {
    const out = getDesignContextPrompt({ bedrooms: 2 });
    expect(out).toContain("## APARTMENT LAYOUT");
    expect(out).toContain("- Bedrooms: 2");
    expect(out).toContain("- Bathrooms: 1");
  });

  it("includes inferred preferences only when they carry real signal", () => {
    const base: PreferenceSignals = {
      preferred_items: [],
      avoided_items: [],
      preferred_materials: [],
      preferred_palette: [],
      style_notes: [],
      recurring_categories: [],
      priorities: [],
      user_context_snippets: [],
      density_preference: "unknown",
      budget_pressure: "unknown",
      source_room_count: 0,
    };
    // source_room_count 0 → formatPreferencesForPrompt returns null → no section.
    // Pair with a bedrooms field so `sections` is NON-empty (APARTMENT LAYOUT
    // renders) — proving the missing preferences section is the skip logic, not
    // the global empty-profile default fallback.
    const empty = getDesignContextPrompt({ inferredPreferences: base, bedrooms: 1 });
    expect(empty).toContain("## APARTMENT LAYOUT");
    expect(empty).not.toContain("## User Preference Signals");

    const withSignal = getDesignContextPrompt({
      inferredPreferences: {
        ...base,
        preferred_materials: ["walnut", "brass"],
        source_room_count: 2,
      },
    });
    expect(withSignal).toContain("## User Preference Signals");
    expect(withSignal).toContain("walnut, brass");
  });

  it("emits lifestyle guidance for each provided signal", () => {
    const out = getDesignContextPrompt({
      lifestyle: {
        pets: "two cats",
        kids: "a toddler",
        hosting: "monthly dinners",
        work_from_home: true,
        notes: "allergic to wool",
      },
    });
    expect(out).toContain("## CLIENT LIFESTYLE");
    expect(out).toContain("- Pets: two cats");
    expect(out).toContain("- Children: a toddler");
    expect(out).toContain("- Hosting/entertaining: monthly dinners");
    expect(out).toContain("- Works from home");
    expect(out).toContain("- Additional: allergic to wool");
    expect(out).toContain("Beauty that isn't livable is bad design.");
  });

  it("omits the lifestyle section when the object has no truthy signals", () => {
    // bedrooms makes `sections` non-empty (APARTMENT LAYOUT renders), so the
    // absent lifestyle section is attributable to the all-falsy skip logic, not
    // the global empty-profile default fallback.
    const out = getDesignContextPrompt({ lifestyle: { work_from_home: false }, bedrooms: 1 });
    expect(out).toContain("## APARTMENT LAYOUT");
    expect(out).not.toContain("## CLIENT LIFESTYLE");
  });
});

describe("getDesignContextPrompt — composition", () => {
  it("joins multiple sections in order, separated by blank lines", () => {
    const out = getDesignContextPrompt({
      location: { city: "Austin" },
      bedrooms: 1,
      bathrooms: 1,
    });
    expect(out).toContain("## LOCATION");
    expect(out).toContain("## APARTMENT LAYOUT");
    // Sections are joined with a blank line and the whole thing is trimmed.
    expect(out.indexOf("## LOCATION")).toBeLessThan(out.indexOf("## APARTMENT LAYOUT"));
    expect(out).toBe(out.trim());
  });
});
