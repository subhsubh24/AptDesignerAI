import type { SearchCandidate } from "./shopping-researcher";

/**
 * Intelligent extraction gate.
 *
 * Extraction is the single largest cost in a search run — both in LLM tokens
 * (≈50% of total) and in Tavily Extract credits — yet most of that spend is
 * wasted: we extract ~3x more products than we keep, and the failures cluster
 * on no-content URLs from JS-heavy retailers.
 *
 * The economics split cleanly into two kinds of candidate:
 *   • WITH raw content (Tavily Search already returned the page body): extracts
 *     for FREE — no extra Tavily Extract credit — and almost always succeeds.
 *     These should be preferred and kept generously.
 *   • WITHOUT raw content: needs a Tavily Extract call (a credit) and fails
 *     often. These are the expensive, low-yield attempts, so keep only the few
 *     highest-relevance ones.
 *
 * Within each bucket we sort by Tavily relevance so the most promising URLs are
 * attempted first. The previous gate did a naive `slice(0, cap)` in arbitrary
 * screen order, so it routinely dropped free/reliable candidates and kept
 * expensive failing ones.
 */
export function selectExtractionCandidates(
  candidates: SearchCandidate[],
  rawContentCap: number,
  noContentCap: number,
): SearchCandidate[] {
  if (candidates.length === 0) return [];

  // Sort by relevance, with a stable URL tiebreak. Without the tiebreak, equal-
  // relevance candidates keep their incoming array order (JS sort is stable), so
  // WHICH candidates survive the `slice(0, cap)` below would silently depend on
  // upstream ordering — the same candidate SET in a different order could extract
  // a different subset run-to-run. The URL tiebreak makes selection a pure
  // function of the set (determinism.md: every score sort needs a final id/url
  // tiebreaker), matching tiebreakProduct in orchestrator.ts and reranker.ts.
  const byRelevance = (a: SearchCandidate, b: SearchCandidate) =>
    (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0) || a.url.localeCompare(b.url);

  const withContent = candidates.filter((c) => c.rawContent).sort(byRelevance);
  const noContent = candidates.filter((c) => !c.rawContent).sort(byRelevance);

  return [
    ...withContent.slice(0, rawContentCap),
    ...noContent.slice(0, noContentCap),
  ];
}
