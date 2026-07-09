import { describe, it, expect } from "vitest";
import { selectByMMR, productSimilarity } from "@/lib/scoring/mmr-reranker";
import type { CandidateProduct } from "@/lib/types/database";
import type { ProductEvaluationResult } from "@/lib/types/scoring";

function makeProduct(overrides: Partial<CandidateProduct>): CandidateProduct {
  return {
    id: overrides.id || "p1",
    room_id: "r1",
    search_session_id: null,
    title: overrides.title || "Product",
    category: overrides.category || "coffee_table",
    retailer: overrides.retailer || "west elm",
    product_url: overrides.product_url || null,
    image_url: null,
    local_image_path: null,
    price: overrides.price ?? 500,
    dimensions: overrides.dimensions ?? null,
    materials: overrides.materials ?? ["walnut"],
    colors: overrides.colors ?? ["brown"],
    description: null,
    source_type: "agentic_search",
    metadata: null,
    status: "pending",
    created_at: "2025-01-01",
    updated_at: "2025-01-01",
  };
}

function makeEvaluation(score: number): ProductEvaluationResult {
  return {
    scores: {
      style_fit_score: score,
      palette_fit_score: score,
      material_fit_score: score,
      scale_fit_score: score,
      function_fit_score: score,
      cohesion_fit_score: score,
      value_fit_score: score,
      confidence_score: 8,
    },
    final_item_score: score,
    verdict: "yes",
    reasoning: { top_reasons: [], risks: [], suggestions: [] },
  };
}

describe("productSimilarity", () => {
  it("returns 1.0 for identical products (all attributes match)", () => {
    const a = makeProduct({ id: "a", retailer: "west elm", materials: ["wood"], colors: ["brown"], price: 500 });
    const b = makeProduct({ id: "b", retailer: "west elm", materials: ["wood"], colors: ["brown"], price: 500 });
    expect(productSimilarity(a, b)).toBeCloseTo(1.0, 2);
  });

  it("returns low similarity for very different products", () => {
    const a = makeProduct({ id: "a", retailer: "ikea", materials: ["metal"], colors: ["black"], price: 100 });
    const b = makeProduct({ id: "b", retailer: "rh", materials: ["oak"], colors: ["cream"], price: 2000 });
    expect(productSimilarity(a, b)).toBeLessThan(0.15);
  });

  it("weighs retailer match heavily", () => {
    const a = makeProduct({ id: "a", retailer: "west elm", materials: ["oak"], colors: ["white"], price: 1000 });
    const b = makeProduct({ id: "b", retailer: "west elm", materials: ["walnut"], colors: ["black"], price: 500 });
    // Same retailer + some price proximity → should be >0.3
    expect(productSimilarity(a, b)).toBeGreaterThan(0.3);
  });
});

describe("selectByMMR", () => {
  it("returns all products when count <= k", () => {
    const products = [makeProduct({ id: "p1" }), makeProduct({ id: "p2" })];
    const evals = new Map([["p1", makeEvaluation(8)], ["p2", makeEvaluation(7)]]);
    expect(selectByMMR(products, evals, 5).length).toBe(2);
  });

  it("picks the highest-scored product first", () => {
    const products = [
      makeProduct({ id: "low" }),
      makeProduct({ id: "high", retailer: "target" }),
      makeProduct({ id: "mid", retailer: "cb2" }),
    ];
    const evals = new Map([
      ["low", makeEvaluation(5)],
      ["high", makeEvaluation(9)],
      ["mid", makeEvaluation(7)],
    ]);
    const result = selectByMMR(products, evals, 3);
    expect(result[0].id).toBe("high");
  });

  it("prefers diverse products over redundant ones", () => {
    // Best and redundant are near-identical; diverse is different in every dim
    const best = makeProduct({ id: "best", retailer: "west elm", materials: ["walnut"], colors: ["brown"], price: 500 });
    const redundant = makeProduct({ id: "redundant", retailer: "west elm", materials: ["walnut"], colors: ["brown"], price: 500 });
    const diverse = makeProduct({ id: "diverse", retailer: "ikea", materials: ["metal"], colors: ["black"], price: 150 });
    const evals = new Map([
      ["best", makeEvaluation(9.0)],
      ["redundant", makeEvaluation(8.9)],
      ["diverse", makeEvaluation(8.5)],
    ]);
    // With strong diversity weight (lambda=0.3), MMR should pick the diverse
    // one over the redundant near-duplicate despite slightly lower relevance
    const result = selectByMMR([best, redundant, diverse], evals, 2, 0.3);
    expect(result[0].id).toBe("best");
    expect(result[1].id).toBe("diverse");
  });

  it("with lambda=1.0 picks purely by score (no diversity)", () => {
    const best = makeProduct({ id: "best", retailer: "west elm", materials: ["walnut"] });
    const redundant = makeProduct({ id: "redundant", retailer: "west elm", materials: ["walnut"] });
    const diverse = makeProduct({ id: "diverse", retailer: "ikea", materials: ["metal"] });
    const evals = new Map([
      ["best", makeEvaluation(9.0)],
      ["redundant", makeEvaluation(8.5)],
      ["diverse", makeEvaluation(7.0)],
    ]);
    const result = selectByMMR([best, redundant, diverse], evals, 2, 1.0);
    expect(result[0].id).toBe("best");
    expect(result[1].id).toBe("redundant");
  });

  it("handles empty materials/colors gracefully", () => {
    const a = makeProduct({ id: "a", materials: [], colors: [] });
    const b = makeProduct({ id: "b", materials: [], colors: [] });
    const evals = new Map([["a", makeEvaluation(7)], ["b", makeEvaluation(6)]]);
    const result = selectByMMR([a, b], evals, 2, 0.7);
    expect(result.length).toBe(2);
  });

  it("with lambda=0.0 (pure diversity) picks the most different second", () => {
    const best = makeProduct({ id: "best", retailer: "west elm", materials: ["walnut"], colors: ["brown"], price: 500 });
    const redundant = makeProduct({ id: "redundant", retailer: "west elm", materials: ["walnut"], colors: ["brown"], price: 500 });
    const diverse = makeProduct({ id: "diverse", retailer: "ikea", materials: ["metal"], colors: ["black"], price: 150 });
    const evals = new Map([
      ["best", makeEvaluation(9.0)],
      ["redundant", makeEvaluation(8.9)],
      ["diverse", makeEvaluation(8.5)],
    ]);
    // First pick is always the highest relevance (best); with zero relevance
    // weight the second pick maximizes -maxSim, i.e. the least-similar item.
    const result = selectByMMR([best, redundant, diverse], evals, 2, 0.0);
    expect(result[0].id).toBe("best");
    expect(result[1].id).toBe("diverse");
  });

  it("caps selection at k when there are more products than k", () => {
    const products = [
      makeProduct({ id: "p1", retailer: "a" }),
      makeProduct({ id: "p2", retailer: "b" }),
      makeProduct({ id: "p3", retailer: "c" }),
      makeProduct({ id: "p4", retailer: "d" }),
    ];
    const evals = new Map(products.map((p, i) => [p.id, makeEvaluation(9 - i)] as const));
    expect(selectByMMR(products, evals, 2).length).toBe(2);
  });

  it("does not NaN or throw when every relevance score is identical (range=0)", () => {
    const products = [
      makeProduct({ id: "x", retailer: "a", materials: ["oak"] }),
      makeProduct({ id: "y", retailer: "b", materials: ["metal"] }),
      makeProduct({ id: "z", retailer: "c", materials: ["glass"] }),
    ];
    const evals = new Map(products.map((p) => [p.id, makeEvaluation(7)] as const));
    const result = selectByMMR(products, evals, 3, 0.7);
    expect(result.length).toBe(3);
    // Selection order must be a stable permutation of the inputs (no dupes/holes).
    expect(new Set(result.map((p) => p.id))).toEqual(new Set(["x", "y", "z"]));
  });
});

describe("productSimilarity — exact weighted formula (0.3 retailer + 0.3 material + 0.2 color + 0.2 price)", () => {
  it("same retailer + same price but disjoint materials/colors → 0.3*1 + 0.2*1 = 0.5", () => {
    const a = makeProduct({ id: "a", retailer: "west elm", materials: ["oak"], colors: ["brown"], price: 500 });
    const b = makeProduct({ id: "b", retailer: "west elm", materials: ["metal"], colors: ["black"], price: 500 });
    expect(productSimilarity(a, b)).toBeCloseTo(0.5, 6);
  });

  it("computes fractional material Jaccard (1 shared of 3 union → 1/3) into the weighted sum", () => {
    // retailer differs (0), colors disjoint (0), materials {oak,walnut} vs {walnut,metal} → 1/3,
    // price 100 vs 300 → priceSim 1 - 200/300 = 1/3. Sum = 0.3*(1/3) + 0.2*(1/3) = 1/6.
    const a = makeProduct({ id: "a", retailer: "ikea", materials: ["oak", "walnut"], colors: ["brown"], price: 100 });
    const b = makeProduct({ id: "b", retailer: "cb2", materials: ["walnut", "metal"], colors: ["black"], price: 300 });
    expect(productSimilarity(a, b)).toBeCloseTo(1 / 6, 6);
  });

  it("treats two empty material/color sets as similarity 0 (not divide-by-zero)", () => {
    // Both materials/colors empty → Jaccard 0 each; same retailer + same price → 0.3 + 0.2 = 0.5.
    const a = makeProduct({ id: "a", retailer: "west elm", materials: [], colors: [], price: 400 });
    const b = makeProduct({ id: "b", retailer: "west elm", materials: [], colors: [], price: 400 });
    expect(productSimilarity(a, b)).toBeCloseTo(0.5, 6);
  });

  it("uses the maxP=1 floor so two zero-priced items score priceSim=1 (no NaN)", () => {
    // Different retailer, disjoint materials/colors, both price 0 → only price contributes: 0.2*1 = 0.2.
    const a = makeProduct({ id: "a", retailer: "ikea", materials: ["oak"], colors: ["brown"], price: 0 });
    const b = makeProduct({ id: "b", retailer: "cb2", materials: ["metal"], colors: ["black"], price: 0 });
    expect(productSimilarity(a, b)).toBeCloseTo(0.2, 6);
  });
});
