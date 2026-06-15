import { describe, it, expect } from "vitest";
import { parsePriceFromSnippet, buildSnippetProduct } from "@/lib/agents/snippet-fallback";
import type { SearchCandidate } from "@/lib/agents/shopping-researcher";

describe("parsePriceFromSnippet", () => {
  it("extracts a simple price", () => {
    expect(parsePriceFromSnippet("Beautiful vase $29.99 in stock")).toBe(29.99);
  });

  it("extracts price with comma", () => {
    expect(parsePriceFromSnippet("Sofa starting at $1,299.00")).toBe(1299.0);
  });

  it("returns null when no price present", () => {
    expect(parsePriceFromSnippet("Beautiful handmade ceramic vase")).toBeNull();
  });

  it("rejects unreasonably high prices", () => {
    expect(parsePriceFromSnippet("Price: $99,999.00")).toBeNull();
  });

  it("extracts first price when multiple present", () => {
    expect(parsePriceFromSnippet("Was $49.99, now $29.99")).toBe(49.99);
  });
});

describe("buildSnippetProduct", () => {
  const candidate: SearchCandidate = {
    title: "Modern Ceramic Vase - White",
    url: "https://cb2.com/modern-ceramic-vase",
    snippet: "Modern Ceramic Vase - White. $34.95. Add a touch of modern elegance.",
    source: "cb2.com",
    relevanceScore: 0.8,
    imageUrl: "https://cb2.com/images/vase.jpg",
  };

  it("builds a valid product from a candidate", () => {
    const product = buildSnippetProduct(candidate, "vase", "balanced", "room-1");
    expect(product).not.toBeNull();
    expect(product!.title).toBe("Modern Ceramic Vase - White");
    expect(product!.price).toBe(34.95);
    expect(product!.image_url).toBe("https://cb2.com/images/vase.jpg");
    expect(product!.retailer).toBe("cb2.com");
    expect(product!.category).toBe("vase");
    expect(product!.metadata).toEqual({
      price_tier: "balanced",
      snippet_fallback: true,
    });
    expect(product!.source_type).toBe("agentic_search");
  });

  it("returns null for candidates with short titles", () => {
    const bad = { ...candidate, title: "Hi" };
    expect(buildSnippetProduct(bad, "vase", "balanced", "room-1")).toBeNull();
  });

  it("returns null for candidates without url", () => {
    const bad = { ...candidate, url: "" };
    expect(buildSnippetProduct(bad, "vase", "balanced", "room-1")).toBeNull();
  });

  it("builds product even without price in snippet", () => {
    const noPriceCandidate = { ...candidate, snippet: "A beautiful vase" };
    const product = buildSnippetProduct(noPriceCandidate, "vase", "balanced", "room-1");
    expect(product).not.toBeNull();
    expect(product!.price).toBeNull();
  });
});
