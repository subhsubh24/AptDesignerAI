import { describe, it, expect } from "vitest";
import { formatIdentifiedProductForPrompt } from "@/lib/prompts/product-identification";

// Covers formatIdentifiedProductForPrompt — renders a canonical identified
// product into the "EXISTING IDENTIFIED PIECES" block that buildIdentifiedPiecesBlock
// injects into the area-analysis Pass A + downstream search/eval prompts. Each
// spec segment is independently gated, so a formatting regression silently
// corrupts the exact dimensions/materials/colors the LLM treats as fact. This
// pins every conditional branch.

describe("formatIdentifiedProductForPrompt", () => {
  it("renders brand + model alone with no spec suffix when nothing else is known", () => {
    const out = formatIdentifiedProductForPrompt({
      brand: "West Elm",
      model: "Andes",
      category: "sofa",
    });
    // No variant, dims, materials, colors, or price → specs empty → no "— ".
    expect(out).toBe("West Elm Andes");
  });

  it("appends the variant in parentheses when present", () => {
    const out = formatIdentifiedProductForPrompt({
      brand: "Article",
      model: "Sven",
      variant: "Charme Tan",
      category: "sofa",
    });
    expect(out).toContain("Article Sven (Charme Tan)");
  });

  it("joins all three dimensions with × and keeps W/D/H order", () => {
    const out = formatIdentifiedProductForPrompt({
      brand: "IKEA",
      model: "Ektorp",
      category: "sofa",
      dimensions: { width_in: 86, depth_in: 34, height_in: 30 },
    });
    expect(out).toContain('86"W × 34"D × 30"H');
  });

  it("drops absent dimension fields rather than printing undefined", () => {
    const out = formatIdentifiedProductForPrompt({
      brand: "IKEA",
      model: "Ektorp",
      category: "sofa",
      dimensions: { width_in: 86 },
    });
    expect(out).toContain('86"W');
    expect(out).not.toContain("undefined");
    expect(out).not.toContain("×");
  });

  it("emits no dimension spec when the dimensions object has no measured fields", () => {
    const out = formatIdentifiedProductForPrompt({
      brand: "IKEA",
      model: "Ektorp",
      category: "sofa",
      dimensions: {},
    });
    // Empty dim string is guarded out → no trailing "— " suffix at all.
    expect(out).toBe("IKEA Ektorp");
  });

  it("caps materials at 3 and colors at 2", () => {
    const out = formatIdentifiedProductForPrompt({
      brand: "CB2",
      model: "Movie",
      category: "sofa",
      materials: ["velvet", "steel", "foam", "hardwood"],
      colors: ["ink", "brass", "walnut"],
    });
    expect(out).toContain("velvet/steel/foam");
    expect(out).not.toContain("hardwood");
    expect(out).toContain("ink/brass");
    expect(out).not.toContain("walnut");
  });

  it("renders the price range and combines every spec after the em dash", () => {
    const out = formatIdentifiedProductForPrompt({
      brand: "Floyd",
      model: "Sofa",
      category: "sofa",
      dimensions: { width_in: 91 },
      materials: ["wool"],
      price_range: { min: 1795, max: 1995, currency: "USD" },
    });
    expect(out).toContain('— 91"W, wool, $1795-$1995');
  });
});
