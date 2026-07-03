/**
 * Unit coverage for buildDesignProfile — turns a raw project record into the
 * DynamicDesignProfile that personalises the system prompt. This is pure,
 * branch-heavy extraction with several load-bearing quirks worth pinning so a
 * refactor can't silently drop personalisation:
 *  - returns `undefined` for an empty/absent project (the "no data" gate).
 *  - the location block is keyed on city/neighbourhood/building_name — NOT
 *    state alone (state is only a passthrough once one of those is present).
 *  - lifestyle merges two shapes, with the nested `lifestyle.*` winning over
 *    the flat `project.*` fallback.
 *  - the `hasData` gate treats bedrooms/bathrooms as non-populating on their
 *    own (bedrooms=0 or bathrooms=1 alone → undefined), so we pin that exact
 *    behaviour rather than assume it.
 */
import { describe, it, expect } from "vitest";
import { buildDesignProfile } from "@/lib/design-context/build-profile";

describe("buildDesignProfile", () => {
  it("returns undefined for a null/undefined project", () => {
    expect(buildDesignProfile(null)).toBeUndefined();
    expect(buildDesignProfile(undefined)).toBeUndefined();
  });

  it("returns undefined for an empty project (nothing populated)", () => {
    expect(buildDesignProfile({})).toBeUndefined();
  });

  it("builds the location block from city and carries state through", () => {
    const p = buildDesignProfile({ city: "Brooklyn", state: "NY", neighborhood: "Williamsburg" });
    expect(p?.location).toEqual({
      city: "Brooklyn",
      state: "NY",
      neighborhood: "Williamsburg",
      building: undefined,
    });
  });

  it("does NOT create a profile from state alone (state is not a location trigger)", () => {
    expect(buildDesignProfile({ state: "NY" })).toBeUndefined();
  });

  it("maps building_research fields and the floor-plan image url", () => {
    const p = buildDesignProfile({
      building_research: {
        building_style: "prewar",
        ceiling_height: "10ft",
        floor_plan_image_url: "https://cdn/x.png",
      },
    });
    expect(p?.buildingResearch?.building_style).toBe("prewar");
    expect(p?.buildingResearch?.ceiling_height).toBe("10ft");
    expect(p?.floorPlanImageUrl).toBe("https://cdn/x.png");
  });

  it("maps apartment_analysis", () => {
    const p = buildDesignProfile({ apartment_analysis: { overall: "bright, dated kitchen" } });
    expect(p?.apartmentAnalysis?.overall).toBe("bright, dated kitchen");
  });

  it("prefers nested lifestyle.* over the flat project.* fallback", () => {
    const p = buildDesignProfile({ lifestyle: { pets: "cat" }, pets: "dog" });
    expect(p?.lifestyle?.pets).toBe("cat");
  });

  it("falls back to the flat lifestyle fields when there is no nested object", () => {
    const p = buildDesignProfile({ pets: "dog", kids: "two toddlers" });
    expect(p?.lifestyle?.pets).toBe("dog");
    expect(p?.lifestyle?.kids).toBe("two toddlers");
  });

  it("populates from a truthy bedroom count", () => {
    const p = buildDesignProfile({ bedrooms: 2 });
    expect(p?.bedrooms).toBe(2);
  });

  it("does NOT create a profile from bedrooms=0 or bathrooms alone (hasData quirk)", () => {
    // bedrooms=0 is set on the profile but is falsy in the hasData gate;
    // bathrooms is not part of the hasData gate at all.
    expect(buildDesignProfile({ bedrooms: 0 })).toBeUndefined();
    expect(buildDesignProfile({ bathrooms: 1 })).toBeUndefined();
  });
});
