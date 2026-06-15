import { describe, it, expect } from "vitest";
import { selectExtractionCandidates } from "@/lib/agents/extraction-gate";
import type { SearchCandidate } from "@/lib/agents/shopping-researcher";

function cand(url: string, relevanceScore: number, hasContent: boolean): SearchCandidate {
  return {
    title: url,
    url,
    snippet: "",
    source: "example.com",
    relevanceScore,
    rawContent: hasContent ? "x".repeat(600) : undefined,
  };
}

describe("selectExtractionCandidates", () => {
  it("returns empty for empty input", () => {
    expect(selectExtractionCandidates([], 8, 4)).toEqual([]);
  });

  it("prioritizes raw-content candidates and caps no-content tightly", () => {
    const cands = [
      cand("no1", 0.9, false),
      cand("no2", 0.8, false),
      cand("no3", 0.7, false),
      cand("no4", 0.6, false),
      cand("no5", 0.5, false), // should be dropped — noContentCap=4
      cand("raw1", 0.4, true),
      cand("raw2", 0.3, true),
    ];
    const kept = selectExtractionCandidates(cands, 8, 4);
    const urls = kept.map((c) => c.url);
    // Both raw-content kept (free + reliable), even though lower relevance.
    expect(urls).toContain("raw1");
    expect(urls).toContain("raw2");
    // Only the top-4 no-content kept; the 5th dropped.
    expect(urls).toContain("no1");
    expect(urls).toContain("no4");
    expect(urls).not.toContain("no5");
  });

  it("orders raw-content first, each bucket sorted by relevance desc", () => {
    const cands = [
      cand("no_low", 0.1, false),
      cand("no_high", 0.9, false),
      cand("raw_low", 0.2, true),
      cand("raw_high", 0.8, true),
    ];
    const kept = selectExtractionCandidates(cands, 8, 4).map((c) => c.url);
    expect(kept).toEqual(["raw_high", "raw_low", "no_high", "no_low"]);
  });

  it("keeps all raw-content up to its (larger) cap before any no-content", () => {
    const raws = Array.from({ length: 10 }, (_, i) => cand(`raw${i}`, 1 - i * 0.05, true));
    const nos = Array.from({ length: 10 }, (_, i) => cand(`no${i}`, 1 - i * 0.05, false));
    const kept = selectExtractionCandidates([...raws, ...nos], 8, 4);
    expect(kept.filter((c) => c.rawContent).length).toBe(8);
    expect(kept.filter((c) => !c.rawContent).length).toBe(4);
    expect(kept.length).toBe(12);
  });

  it("treats empty rawContent as no-content", () => {
    const c = cand("x", 0.5, false);
    c.rawContent = undefined;
    const kept = selectExtractionCandidates([c], 8, 4);
    expect(kept.length).toBe(1);
  });
});
