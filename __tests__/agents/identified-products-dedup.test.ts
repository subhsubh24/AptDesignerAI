import { describe, it, expect } from "vitest";
import { dedupByBrandModel } from "@/lib/agents/identified-products-pipeline";
import type { IdentifiedProductEnriched } from "@/lib/types/schemas";

// dedupByBrandModel only reads brand/model/variant/confidence, so a minimal
// fixture cast to the type keeps the test focused on the dedup + ordering logic.
function item(
  brand: string,
  model: string,
  confidence: number,
  variant?: string,
): IdentifiedProductEnriched {
  return { brand, model, variant, confidence } as unknown as IdentifiedProductEnriched;
}

const key = (p: IdentifiedProductEnriched) => `${p.brand}/${p.model}`;

describe("dedupByBrandModel", () => {
  it("keeps only the highest-confidence entry per (brand, model, variant)", () => {
    const out = dedupByBrandModel([
      item("West Elm", "Harmony", 0.4),
      item("West Elm", "Harmony", 0.9), // same key, higher confidence wins
      item("Article", "Sven", 0.7),
    ]);
    expect(out.map(key)).toEqual(["West Elm/Harmony", "Article/Sven"]);
    expect(out.find((p) => p.brand === "West Elm")?.confidence).toBe(0.9);
  });

  it("keeps same brand+model but different variant as distinct products", () => {
    const out = dedupByBrandModel([
      item("West Elm", "Harmony", 0.6, "sofa"),
      item("West Elm", "Harmony", 0.6, "sectional"),
    ]);
    expect(out).toHaveLength(2);
  });

  it("orders by confidence descending", () => {
    const out = dedupByBrandModel([
      item("A", "1", 0.3),
      item("B", "2", 0.9),
      item("C", "3", 0.6),
    ]);
    expect(out.map((p) => p.confidence)).toEqual([0.9, 0.6, 0.3]);
  });

  it("produces an order-independent result when confidence ties (determinism)", () => {
    // Confidence ties are common (identification defaults to 0.5). Without the
    // key tiebreak, JS's stable sort would leave tied entries in Map-insertion
    // (= upstream input) order, so the same SET in a different order would emit
    // a different sequence — the exact latent non-determinism determinism.md
    // forbids. Assert two shuffled inputs yield the identical ordering.
    const a = item("Muji", "Shelf", 0.5);
    const b = item("Ikea", "Kallax", 0.5);
    const c = item("Hay", "Palissade", 0.5);

    const forward = dedupByBrandModel([a, b, c]).map(key);
    const shuffled = dedupByBrandModel([c, a, b]).map(key);

    expect(forward).toEqual(shuffled);
    // Deterministic tiebreak is the lowercased brand::model::variant key ascending.
    expect(forward).toEqual(["Hay/Palissade", "Ikea/Kallax", "Muji/Shelf"]);
  });
});
