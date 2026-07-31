import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CandidateProduct } from "@/lib/types/database";
import type { ScoringContext } from "@/lib/agents/fit-scorer";
import { DETERMINISTIC_SEED } from "@/lib/ai/determinism";

/**
 * `scoreProducts` batches 2–3 products into ONE LLM call and then has to put
 * the answers back on the right products. That reassembly is the part worth
 * testing, and none of it was: the existing fit-scorer suite covers
 * `applyMathVeto` and the ScoringContext interface, so the whole batch path
 * (11.66% coverage across lib/agents) ran unpinned.
 *
 * Three failure modes, all silent — a wrong answer, not an error:
 *
 *  1. REORDERED entries. The model is asked to echo each product's 0-based
 *     index and may return them in any order. The code builds an index→entry
 *     Map for exactly this reason. If that ever degrades to positional
 *     `res.data.products[idx]`, every product in a reordered batch gets another
 *     product's scores and verdict, and nothing throws. This also matters for
 *     .claude/rules/determinism.md: results must key back to a stable order
 *     rather than to whatever order the response happened to arrive in.
 *  2. MISSING entries. If the model returns 2 of 3, the third must fall back to
 *     a per-product call, not be dropped from the results Map — a dropped
 *     product silently disappears from the user's sourcing results.
 *  3. A FAILED batch call. The whole batch must fall back per-product rather
 *     than losing every product in it.
 *
 * `geminiProvider.chat` is the single external boundary, so it is the only
 * mock. Everything downstream — the math veto, confidence grounding, final
 * score, verdict — runs for real.
 */

const chat = vi.fn();
vi.mock("@/lib/ai/gemini", () => ({ geminiProvider: { chat: (...a: unknown[]) => chat(...a) } }));

const { scoreProducts } = await import("@/lib/agents/fit-scorer");

// ── fixtures ────────────────────────────────────────────────────────────────

function product(id: string): CandidateProduct {
  return {
    id,
    title: `Product ${id}`,
    category: "sofa",
    price: 1200,
    materials: ["oak"],
    colors: ["walnut"],
    description: `Description for ${id}`,
    image_url: null,
    dimensions: { width: 80, height: 30 },
  } as unknown as CandidateProduct;
}

const ctx: ScoringContext = {
  roomType: "living_room",
  budgetMode: "balanced",
  existingItems: [],
  roomImageUrls: [],
};

const SCORES = {
  style_fit_score: 7,
  palette_fit_score: 7,
  material_fit_score: 7,
  scale_fit_score: 7,
  function_fit_score: 7,
  cohesion_fit_score: 7,
  value_fit_score: 7,
  confidence_score: 7,
};

/** The marker each assertion reads back. `reasoning` is passed through the
 *  batch path untouched, so it identifies WHICH entry landed on a product —
 *  unlike the numeric scores, which the math veto may legitimately rewrite. */
const reasoning = (marker: string) => ({ top_reasons: [marker], risks: [], suggestions: [] });

/**
 * One payload that satisfies BOTH parsers. Zod object schemas strip unknown
 * keys rather than rejecting them, so the batch parser reads `products` and the
 * per-product parser reads the top-level `scores`/`reasoning` from the same
 * object. That is what lets a single mock serve both paths while keeping their
 * markers distinguishable: anything tagged "fallback:" can only have come from
 * a per-product call.
 */
function reply(entries: { index: number; marker: string }[], tokens = 300) {
  return {
    content: JSON.stringify({
      products: entries.map((e) => ({ index: e.index, scores: SCORES, reasoning: reasoning(e.marker) })),
      scores: SCORES,
      reasoning: reasoning("fallback"),
    }),
    usage: { input_tokens: tokens, output_tokens: 0, thinking_tokens: 0 },
    model: "gemini-test",
  };
}

const markerOf = (r: { data?: { reasoning?: { top_reasons?: string[] } } } | undefined) =>
  r?.data?.reasoning?.top_reasons?.[0];

beforeEach(() => chat.mockReset());

// ── tests ───────────────────────────────────────────────────────────────────

describe("scoreProducts — batch reassembly", () => {
  it("keys entries by their echoed index, not by arrival order", async () => {
    // The model answers c, a, b. Positional reassembly would hand a's scores to
    // c — the exact silent mix-up this Map exists to prevent.
    chat.mockResolvedValue(
      reply([
        { index: 2, marker: "for-c" },
        { index: 0, marker: "for-a" },
        { index: 1, marker: "for-b" },
      ])
    );

    const { results } = await scoreProducts([product("a"), product("b"), product("c")], ctx, 3);

    expect(chat).toHaveBeenCalledTimes(1); // one batch, so this is the batch path
    expect(markerOf(results.get("a"))).toBe("for-a");
    expect(markerOf(results.get("b"))).toBe("for-b");
    expect(markerOf(results.get("c"))).toBe("for-c");
  });

  it("falls back per-product for an entry the model skipped, instead of dropping it", async () => {
    // Batch call answers only indices 0 and 2; the follow-up per-product call
    // for index 1 reads the top-level shape and is marked "fallback".
    chat.mockResolvedValue(
      reply([
        { index: 0, marker: "for-a" },
        { index: 2, marker: "for-c" },
      ])
    );

    const { results } = await scoreProducts([product("a"), product("b"), product("c")], ctx, 3);

    expect(results.size).toBe(3); // b is present, not silently missing
    expect(markerOf(results.get("a"))).toBe("for-a");
    expect(markerOf(results.get("c"))).toBe("for-c");
    expect(markerOf(results.get("b"))).toBe("fallback");
    expect(chat).toHaveBeenCalledTimes(2); // the batch, plus one recovery call
  });

  it("falls back per-product for the whole batch when the batch call fails", async () => {
    let call = 0;
    chat.mockImplementation(async () => {
      call++;
      if (call === 1) throw new Error("batch scoring exploded");
      return reply([]);
    });

    const { results } = await scoreProducts([product("a"), product("b")], ctx, 2);

    expect(results.size).toBe(2);
    expect(markerOf(results.get("a"))).toBe("fallback");
    expect(markerOf(results.get("b"))).toBe("fallback");
  });

  it("splits into batches of the requested size", async () => {
    chat.mockResolvedValue(reply([{ index: 0, marker: "m" }, { index: 1, marker: "m" }]));

    await scoreProducts([product("a"), product("b"), product("c"), product("d")], ctx, 2);

    // 4 products at batchSize 2 = 2 batch calls, and no per-product recovery
    // (both entries present in each), so exactly 2.
    expect(chat).toHaveBeenCalledTimes(2);
  });

  it("sends THE shared deterministic seed on every batch call", async () => {
    // .claude/rules/determinism.md: every LLM call passes the shared seed.
    // Batching introduced a second call site, and it is not covered by
    // check:determinism.
    //
    // Assert the VALUE, not the type. An earlier version checked only
    // `typeof seed === "number"` and that the set of seeds had size 1 — which
    // a hardcoded `seed: 12345` passes silently, and which is tautological for
    // a single call anyway. Four batches here, so "every call" is real.
    chat.mockResolvedValue(reply([{ index: 0, marker: "m" }, { index: 1, marker: "m" }]));

    await scoreProducts(
      ["a", "b", "c", "d", "e", "f", "g", "h"].map(product),
      ctx,
      2
    );

    const seeds = chat.mock.calls.map(([req]) => (req as { seed?: number }).seed);
    expect(seeds).toHaveLength(4);
    expect(seeds).toEqual(Array(4).fill(DETERMINISTIC_SEED));
  });
});

describe("scoreProducts — degenerate inputs", () => {
  it("makes no LLM call at all for an empty list", async () => {
    const { results, tokensUsed } = await scoreProducts([], ctx, 3);
    expect(results.size).toBe(0);
    expect(tokensUsed).toBe(0);
    expect(chat).not.toHaveBeenCalled();
  });

  it("takes the per-product path for a single product, skipping batch overhead", async () => {
    chat.mockResolvedValue(reply([{ index: 0, marker: "unused-batch-entry" }]));

    const { results } = await scoreProducts([product("solo")], ctx, 3);

    expect(chat).toHaveBeenCalledTimes(1);
    // "fallback" is the top-level marker, which only the per-product parser
    // reads — proving the single-product short-circuit did not go via batch.
    expect(markerOf(results.get("solo"))).toBe("fallback");
  });
});

describe("scoreProducts — token accounting", () => {
  it("divides batch tokens across the batch and sums across batches", async () => {
    chat.mockResolvedValue(reply([{ index: 0, marker: "m" }, { index: 1, marker: "m" }], 300));

    const { results, tokensUsed } = await scoreProducts(
      [product("a"), product("b"), product("c"), product("d")],
      ctx,
      2
    );

    // Two batches at 300 tokens each are reported in full at the top level...
    expect(tokensUsed).toBe(600);
    // ...while each product carries its share, so a per-product cost readout
    // does not multiply the batch cost by the batch size.
    expect(results.get("a")?.tokensUsed).toBe(150);
    expect(results.get("d")?.tokensUsed).toBe(150);
  });
});
