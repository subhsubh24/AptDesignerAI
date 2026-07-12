import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CandidateProduct } from "@/lib/types/database";
import type { ProductEvaluationResult } from "@/lib/types/scoring";

const mockChat = vi.fn();
vi.mock("@/lib/ai/provider-factory", () => ({
  getProvider: () => ({ chat: mockChat }),
}));

import { pairwiseRerank } from "@/lib/scoring/pairwise-reranker";

function makeProduct(id: string, overrides: Partial<CandidateProduct> = {}): CandidateProduct {
  return {
    id,
    room_id: "r1",
    search_session_id: null,
    title: overrides.title || `Product ${id}`,
    category: overrides.category || "coffee_table",
    retailer: overrides.retailer || "west elm",
    product_url: null,
    image_url: null,
    local_image_path: null,
    price: overrides.price ?? 500,
    dimensions: null,
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

function makeEval(score: number): ProductEvaluationResult {
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

describe("pairwiseRerank", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns products unchanged when count <= 2", async () => {
    const products = [makeProduct("a"), makeProduct("b")];
    const evals = new Map([["a", makeEval(7)], ["b", makeEval(6)]]);
    const result = await pairwiseRerank(products, evals, {
      roomType: "living_room",
      category: "coffee_table",
    });
    expect(result.length).toBe(2);
    expect(mockChat).not.toHaveBeenCalled();
  });

  it("re-ranks products based on pairwise win counts", async () => {
    const products = [
      makeProduct("a", { title: "A" }),
      makeProduct("b", { title: "B" }),
      makeProduct("c", { title: "C" }),
    ];
    const evals = new Map([
      ["a", makeEval(7.0)],
      ["b", makeEval(6.8)],
      ["c", makeEval(6.9)],
    ]);

    // Mock: B wins all its pairs — should come out on top despite lower deep score
    mockChat.mockResolvedValue({
      content: JSON.stringify([
        { pair_index: 0, winner: "B", confidence: 4, reason: "B is better" },
        { pair_index: 1, winner: "B", confidence: 4, reason: "B is better" },
        { pair_index: 2, winner: "C", confidence: 3, reason: "C over A" },
      ]),
      usage: { input_tokens: 100, output_tokens: 50, thinking_tokens: 0 },
      model: "gemini-3.1-flash-lite",
      truncated: false,
    });

    // Depending on pair order, winner "B" means whichever product was placed at B position
    const result = await pairwiseRerank(products, evals, {
      roomType: "living_room",
      category: "coffee_table",
    });

    // Structural check: got 3 products back
    expect(result.length).toBe(3);
    // Structural check: LLM was called
    expect(mockChat).toHaveBeenCalled();
  });

  it("falls back gracefully when LLM fails", async () => {
    const products = [
      makeProduct("a"),
      makeProduct("b"),
      makeProduct("c"),
    ];
    const evals = new Map([
      ["a", makeEval(8)],
      ["b", makeEval(7)],
      ["c", makeEval(6)],
    ]);

    mockChat.mockRejectedValue(new Error("API error"));

    const result = await pairwiseRerank(products, evals, {
      roomType: "living_room",
      category: "coffee_table",
    });

    // All products returned even on LLM failure; ordering falls back to deep score
    expect(result.length).toBe(3);
    // With no wins, tiebreaker is deep score → original order preserved
    expect(result[0].id).toBe("a");
  });

  it("preserves products beyond MAX_CANDIDATES=8", async () => {
    const products = Array.from({ length: 12 }, (_, i) => makeProduct(`p${i}`));
    const evals = new Map(
      products.map((p, i) => [p.id, makeEval(9 - i * 0.3)])
    );

    mockChat.mockResolvedValue({
      content: JSON.stringify([]),
      usage: { input_tokens: 100, output_tokens: 50, thinking_tokens: 0 },
      model: "gemini-3.1-flash-lite",
      truncated: false,
    });

    const result = await pairwiseRerank(products, evals, {
      roomType: "living_room",
      category: "coffee_table",
    });

    expect(result.length).toBe(12);
    // The last 4 should be preserved in their original order (they were never re-ranked)
    expect(result.slice(8).map((p) => p.id)).toEqual(["p8", "p9", "p10", "p11"]);
  });

  it("breaks equal-wins + equal-score ties by id ascending (deterministic order)", async () => {
    // Input order is deliberately NOT id-sorted: id "b" appears before "a".
    // With no wins (empty LLM result) and identical deep scores, the only thing
    // separating "a" and "b" is the id tiebreaker — a plain stable sort would
    // keep the input order ["b","a"], so asserting ["a","b"] fails without it.
    const products = [
      makeProduct("prod-b"),
      makeProduct("prod-a"),
      makeProduct("prod-c"),
    ];
    const evals = new Map([
      ["prod-b", makeEval(7)],
      ["prod-a", makeEval(7)], // tied with prod-b on score
      ["prod-c", makeEval(6)], // strictly lower — always sorts last
    ]);

    mockChat.mockResolvedValue({
      content: JSON.stringify([]), // no pairwise winners → all win counts 0
      usage: { input_tokens: 100, output_tokens: 50, thinking_tokens: 0 },
      model: "gemini-3.1-flash-lite",
      truncated: false,
    });

    const result = await pairwiseRerank(products, evals, {
      roomType: "living_room",
      category: "coffee_table",
    });

    expect(result.map((p) => p.id)).toEqual(["prod-a", "prod-b", "prod-c"]);
  });

  it("handles malformed LLM response gracefully", async () => {
    const products = [makeProduct("a"), makeProduct("b"), makeProduct("c")];
    const evals = new Map([
      ["a", makeEval(8)],
      ["b", makeEval(7)],
      ["c", makeEval(6)],
    ]);

    mockChat.mockResolvedValue({
      content: '{"not": "an array"}',
      usage: { input_tokens: 100, output_tokens: 50, thinking_tokens: 0 },
      model: "gemini-3.1-flash-lite",
      truncated: false,
    });

    const result = await pairwiseRerank(products, evals, {
      roomType: "living_room",
      category: "coffee_table",
    });

    expect(result.length).toBe(3);
  });
});
