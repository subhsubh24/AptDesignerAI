import { describe, it, expect } from "vitest";
import { extractSpatialContextNouns } from "@/lib/agents/self-correction";

describe("extractSpatialContextNouns", () => {
  it("extracts the noun after a spatial preposition", () => {
    const nouns = extractSpatialContextNouns(["black arc floor lamp behind the sofa"]);
    expect(nouns.has("sofa")).toBe(true);
    expect(nouns.has("lamp")).toBe(false);
    expect(nouns.has("floor")).toBe(false);
  });

  it("handles multiple keep items, each with its own spatial context", () => {
    const nouns = extractSpatialContextNouns([
      "lamp behind the sofa",
      "vase on top of the dresser",
      "rug under the coffee table",
    ]);
    expect(nouns.has("sofa")).toBe(true);
    expect(nouns.has("dresser")).toBe(true);
    expect(nouns.has("coffee")).toBe(true);
    expect(nouns.has("table")).toBe(true);
  });

  it("returns an empty set when no spatial preposition is present", () => {
    const nouns = extractSpatialContextNouns(["bookshelf", "two lights and light stands"]);
    expect(nouns.size).toBe(0);
  });

  it("stops the noun phrase at conjunctions or other clauses", () => {
    const nouns = extractSpatialContextNouns(["lamp behind the sofa and the coffee table"]);
    expect(nouns.has("sofa")).toBe(true);
    expect(nouns.has("coffee")).toBe(false);
  });

  it("handles 'next to', 'in front of', 'across from'", () => {
    const nouns = extractSpatialContextNouns([
      "nightstand next to the bed",
      "chair in front of the desk",
      "pillow across from the window",
    ]);
    expect(nouns.has("bed")).toBe(true);
    expect(nouns.has("desk")).toBe(true);
    expect(nouns.has("window")).toBe(true);
  });

  it("filters out short tokens", () => {
    const nouns = extractSpatialContextNouns(["lamp by the tv"]);
    expect(nouns.has("tv")).toBe(false);
  });

  it("handles items without 'the' after the preposition", () => {
    const nouns = extractSpatialContextNouns(["lamp behind sofa"]);
    expect(nouns.has("sofa")).toBe(true);
  });
});
