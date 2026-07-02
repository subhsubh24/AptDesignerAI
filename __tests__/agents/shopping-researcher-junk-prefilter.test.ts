import { describe, it, expect } from "vitest";
import {
  prefilterJunkCandidates,
  type SearchCandidate,
} from "@/lib/agents/shopping-researcher";

/**
 * Unit coverage for `prefilterJunkCandidates` — the deterministic prefilter that
 * drops obvious non-furniture (books / apparel / media) BEFORE the paid
 * quick-screen LLM pass. Every candidate it drops is screening tokens (and a
 * possible extraction) saved, so we pin the pattern set: a regression that lets
 * a book/apparel/media listing through (or, worse, nukes a legitimate furniture
 * candidate) flips a test red.
 */

function candidate(overrides: Partial<SearchCandidate> = {}): SearchCandidate {
  return {
    title: "Walnut dining chair",
    url: "https://article.com/p/chair",
    snippet: "",
    source: "test",
    ...overrides,
  };
}

describe("prefilterJunkCandidates", () => {
  it("keeps legitimate furniture candidates untouched", () => {
    const input = [
      candidate({ title: "Oak coffee table", url: "https://westelm.com/p/table" }),
      candidate({ title: "Boucle accent chair", url: "https://cb2.com/p/chair" }),
    ];
    const { prefiltered, junkDropped } = prefilterJunkCandidates(input);
    expect(junkDropped).toBe(0);
    expect(prefiltered).toHaveLength(2);
    expect(prefiltered).toEqual(input);
  });

  it("returns an empty result with zero drops for empty input", () => {
    expect(prefilterJunkCandidates([])).toEqual({ prefiltered: [], junkDropped: 0 });
  });

  it("drops books by title (paperback / novel / ISBN / memoir / biography)", () => {
    const junkTitles = [
      "The Great Gatsby (Paperback)",
      "A sweeping historical novel",
      "Design Basics — ISBN 978-0-13-468599-1",
      "A memoir of the war years",
      "The definitive biography",
    ];
    for (const title of junkTitles) {
      const { prefiltered, junkDropped } = prefilterJunkCandidates([candidate({ title })]);
      expect(junkDropped, `expected "${title}" dropped`).toBe(1);
      expect(prefiltered).toHaveLength(0);
    }
  });

  it("drops apparel by title (t-shirt / hoodie / sneakers / jacket)", () => {
    const junkTitles = [
      "Vintage Beatles T Shirt",
      "Cozy pullover hoodie",
      "Running sneakers size 10",
      "Waxed cotton jacket",
    ];
    for (const title of junkTitles) {
      const { junkDropped } = prefilterJunkCandidates([candidate({ title })]);
      expect(junkDropped, `expected "${title}" dropped`).toBe(1);
    }
  });

  it("drops media by title (DVD / Blu-ray / vinyl record)", () => {
    // Pattern is /\bBlu-?ray\b/i → matches "Bluray"/"Blu-ray" (not "Blu Ray")
    for (const title of ["Classic film DVD", "4K Blu-ray box set", "Jazz vinyl record"]) {
      expect(prefilterJunkCandidates([candidate({ title })]).junkDropped, title).toBe(1);
    }
  });

  it("drops candidates by junk URL host even when the title looks fine", () => {
    const input = [
      candidate({ title: "Modern side table", url: "https://goodreads.com/book/show/123" }),
      candidate({ title: "Reading lamp", url: "https://bookshop.org/p/9780134685991" }),
      candidate({ title: "Wool rug", url: "https://barnesandnoble.com/w/some-title" }),
    ];
    const { prefiltered, junkDropped } = prefilterJunkCandidates(input);
    expect(junkDropped).toBe(3);
    expect(prefiltered).toHaveLength(0);
  });

  it("does NOT drop a legitimate retailer URL that merely resembles a book term", () => {
    // "novelty" contains "novel" but not as a whole word boundary match target;
    // the pattern is \bnovel\b, so "novelty console table" must survive.
    const { prefiltered, junkDropped } = prefilterJunkCandidates([
      candidate({ title: "Novelty console table", url: "https://target.com/p/console" }),
    ]);
    expect(junkDropped).toBe(0);
    expect(prefiltered).toHaveLength(1);
  });

  it("preserves order and drops only the junk items in a mixed batch", () => {
    const good1 = candidate({ title: "Linen sofa", url: "https://joybird.com/p/sofa" });
    const junk = candidate({ title: "Paperback thriller", url: "https://goodreads.com/x" });
    const good2 = candidate({ title: "Brass floor lamp", url: "https://lumens.com/p/lamp" });
    const { prefiltered, junkDropped } = prefilterJunkCandidates([good1, junk, good2]);
    expect(junkDropped).toBe(1);
    expect(prefiltered).toEqual([good1, good2]);
  });

  it("treats a candidate with a missing title/url safely (no crash, not dropped)", () => {
    const input = [
      candidate({ title: undefined as unknown as string, url: undefined as unknown as string }),
    ];
    const { prefiltered, junkDropped } = prefilterJunkCandidates(input);
    expect(junkDropped).toBe(0);
    expect(prefiltered).toHaveLength(1);
  });
});
