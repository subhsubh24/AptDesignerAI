import { describe, it, expect } from "vitest";
import { compareByFinalScoreDesc } from "@/lib/agents/orchestrator";
import type { CandidateProduct } from "@/lib/types/database";
import type { ProductEvaluationResult } from "@/lib/types/scoring";

// The coordinator + self-correction state pick the "top" product per category
// by final_item_score and feed its title/price into planCorrections()'s LLM
// prompt. A plain `sB - sA` sort leaves TIED-score candidates in async
// insertion order, so the top pick — and therefore the LLM prompt — drifts
// run-to-run. compareByFinalScoreDesc() must break score ties deterministically
// by product_url so the same candidate set always ranks the same way
// (.claude/rules/determinism.md).

function product(id: string, url: string): CandidateProduct {
  return { id, product_url: url, title: `title-${id}`, price: 100 } as CandidateProduct;
}

function evalWithScore(score: number): ProductEvaluationResult {
  return {
    scores: {} as ProductEvaluationResult["scores"],
    final_item_score: score,
    verdict: "yes",
    reasoning: { top_reasons: [], risks: [], suggestions: [] },
  };
}

describe("compareByFinalScoreDesc", () => {
  it("orders strictly by score descending when scores differ", () => {
    const a = product("a", "https://z.example/a");
    const b = product("b", "https://a.example/b");
    const evaluations = new Map<string, ProductEvaluationResult>([
      ["a", evalWithScore(90)],
      ["b", evalWithScore(50)],
    ]);
    const sorted = [b, a].sort(compareByFinalScoreDesc(evaluations));
    expect(sorted.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("breaks tied scores deterministically by product_url regardless of input order", () => {
    // Same score → without a tiebreaker the top pick would follow input order.
    const evaluations = new Map<string, ProductEvaluationResult>([
      ["a", evalWithScore(80)],
      ["b", evalWithScore(80)],
      ["c", evalWithScore(80)],
    ]);
    const a = product("a", "https://shop.example/aaa");
    const b = product("b", "https://shop.example/bbb");
    const c = product("c", "https://shop.example/ccc");

    const order1 = [a, b, c].sort(compareByFinalScoreDesc(evaluations)).map((p) => p.id);
    const order2 = [c, a, b].sort(compareByFinalScoreDesc(evaluations)).map((p) => p.id);
    const order3 = [b, c, a].sort(compareByFinalScoreDesc(evaluations)).map((p) => p.id);

    // URL-ascending is the deterministic order for the tied set.
    expect(order1).toEqual(["a", "b", "c"]);
    expect(order2).toEqual(order1);
    expect(order3).toEqual(order1);
  });

  it("treats a missing evaluation as score 0 (ranks below scored items)", () => {
    const evaluations = new Map<string, ProductEvaluationResult>([
      ["a", evalWithScore(40)],
    ]);
    const a = product("a", "https://shop.example/a");
    const missing = product("m", "https://shop.example/m");
    const sorted = [missing, a].sort(compareByFinalScoreDesc(evaluations));
    expect(sorted.map((p) => p.id)).toEqual(["a", "m"]);
  });
});
