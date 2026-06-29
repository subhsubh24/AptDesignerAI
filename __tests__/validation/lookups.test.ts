import { describe, it, expect } from "vitest";
import {
  lookupColor,
  lookupMaterial,
  identifyWoodSpecies,
  identifyMetalFinish,
} from "@/lib/validation/lookups";

describe("lookupColor — named table", () => {
  it("returns the exact HSL for a known color", () => {
    expect(lookupColor("navy")).toEqual({ h: 220, s: 60, l: 20 });
    expect(lookupColor("charcoal")).toEqual({ h: 0, s: 0, l: 20 });
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(lookupColor("  NAVY  ")).toEqual({ h: 220, s: 60, l: 20 });
  });

  it("strips descriptive prefixes to reach the base color", () => {
    // "deep walnut" → "walnut"
    expect(lookupColor("deep walnut")).toEqual(lookupColor("walnut"));
  });

  it("strips a trailing descriptor (tone/shade/hue)", () => {
    expect(lookupColor("navy tone")).toEqual({ h: 220, s: 60, l: 20 });
  });

  it("matches via substring when the phrase embeds a known color", () => {
    expect(lookupColor("i love charcoal walls")).toEqual({ h: 0, s: 0, l: 20 });
  });

  it("returns null for an unknown color with no substring overlap", () => {
    expect(lookupColor("qzxwv")).toBeNull();
  });
});

describe("lookupColor — hex / rgb parsing", () => {
  it("parses a standalone 6-digit hex", () => {
    expect(lookupColor("#ffffff")).toEqual({ h: 0, s: 0, l: 100 });
    expect(lookupColor("#000000")).toEqual({ h: 0, s: 0, l: 0 });
  });

  it("parses an rgb() triple", () => {
    expect(lookupColor("rgb(255, 0, 0)")).toEqual({ h: 0, s: 100, l: 50 });
  });

  it("parses a hex embedded in parentheses, preferring it over the name path", () => {
    // "custom" is not a table color, so a non-null result proves the hex was parsed.
    expect(lookupColor("custom (#ff0000)")).toEqual({ h: 0, s: 100, l: 50 });
  });

  it("rejects a malformed 7+ digit hex rather than silently truncating it", () => {
    // The negative-lookahead anchoring means #abcdef12 is NOT accepted as #abcdef.
    expect(lookupColor("#abcdef12")).toBeNull();
  });
});

describe("lookupMaterial", () => {
  it("returns properties for an exact material", () => {
    expect(lookupMaterial("walnut")).toEqual({ warmth: 0.8, roughness: 0.3, sheen: 0.4, weight: 0.9 });
  });

  it("strips a composition prefix to reach the base material", () => {
    // "solid oak" is not a key, but "oak" is.
    expect(lookupMaterial("solid oak")).toEqual(lookupMaterial("oak"));
  });

  it("prefers an exact compound key over the prefix-stripped base", () => {
    // "faux leather" exists as its own key and must not collapse to "leather".
    expect(lookupMaterial("faux leather")).toEqual({ warmth: 0.5, roughness: 0.2, sheen: 0.5, weight: 0.45 });
    expect(lookupMaterial("faux leather")).not.toEqual(lookupMaterial("leather"));
  });

  it("matches a material embedded in a longer phrase", () => {
    const m = lookupMaterial("brushed brass cabinet pulls");
    expect(m).not.toBeNull();
    expect(m!.warmth).toBeGreaterThanOrEqual(0.5); // brass family is warm
  });

  it("returns null for an unknown material", () => {
    expect(lookupMaterial("kryptonite")).toBeNull();
  });
});

describe("identifyWoodSpecies", () => {
  it("finds the species inside a descriptive material string", () => {
    expect(identifyWoodSpecies("solid walnut dresser")).toBe("walnut");
    expect(identifyWoodSpecies("maple veneer top")).toBe("maple");
    expect(identifyWoodSpecies("teak outdoor table")).toBe("teak");
  });

  it("returns null when no known species is present", () => {
    expect(identifyWoodSpecies("powder-coated plastic stool")).toBeNull();
  });
});

describe("identifyMetalFinish", () => {
  it("classifies warm metals", () => {
    const brass = identifyMetalFinish("brushed brass pulls");
    expect(brass).not.toBeNull();
    expect(brass!.warm).toBe(true);
  });

  it("classifies cool metals", () => {
    expect(identifyMetalFinish("polished chrome legs")?.warm).toBe(false);
    expect(identifyMetalFinish("stainless steel sink")?.warm).toBe(false);
  });

  it("returns null when there is no metal finish", () => {
    expect(identifyMetalFinish("oak dining table")).toBeNull();
  });
});
