import { describe, it, expect } from "vitest";
import { rankCandidatesByEvalScore } from "@/lib/agents/computer-use/verify-search-candidates";
import type { CandidateProduct } from "@/lib/types/database";
import type { ProductEvaluationResult } from "@/lib/types/scoring";

// verifyTopSearchCandidates picks ranked[0] per category and browser-verifies it,
// so the ranking order decides which product becomes the category's verified pick.
// These tests lock in that the pick is a pure function of the candidate SET, not
// the insertion order — the property that fails without the id tiebreak.

const product = (id: string): CandidateProduct => ({ id } as unknown as CandidateProduct);

const evals = (
  scores: Record<string, number>,
): Map<string, ProductEvaluationResult> => {
  const m = new Map<string, ProductEvaluationResult>();
  for (const [id, s] of Object.entries(scores)) {
    m.set(id, { final_item_score: s } as unknown as ProductEvaluationResult);
  }
  return m;
};

describe("rankCandidatesByEvalScore", () => {
  it("ranks by evaluation score descending", () => {
    const out = rankCandidatesByEvalScore(
      [product("a"), product("b"), product("c")],
      evals({ a: 3, b: 9, c: 6 }),
    );
    expect(out.map((p) => p.id)).toEqual(["b", "c", "a"]);
  });

  it("breaks score ties by product id, independent of input order", () => {
    // All three share the default score 0 (un-evaluated), so only the tiebreak
    // decides the winner. Two input orderings MUST produce the same ranking —
    // this fails without the id tiebreak (JS stable sort keeps input order).
    const ev = evals({});
    const order1 = rankCandidatesByEvalScore(
      [product("charlie"), product("alpha"), product("bravo")],
      ev,
    ).map((p) => p.id);
    const order2 = rankCandidatesByEvalScore(
      [product("bravo"), product("charlie"), product("alpha")],
      ev,
    ).map((p) => p.id);
    expect(order1).toEqual(["alpha", "bravo", "charlie"]);
    expect(order2).toEqual(order1);
  });

  it("keeps score dominant over the id tiebreak", () => {
    const out = rankCandidatesByEvalScore(
      [product("zzz"), product("aaa")],
      evals({ zzz: 8, aaa: 2 }),
    );
    expect(out.map((p) => p.id)).toEqual(["zzz", "aaa"]);
  });

  it("does not mutate the input array", () => {
    const input = [product("b"), product("a")];
    rankCandidatesByEvalScore(input, evals({ a: 5, b: 1 }));
    expect(input.map((p) => p.id)).toEqual(["b", "a"]);
  });
});
