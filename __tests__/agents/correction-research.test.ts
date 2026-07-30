/**
 * `reSearchCategoryForCorrection` — the correction loop's re-search, previously at
 * ZERO coverage on a module that sits around 4%.
 *
 * This is how the pipeline recovers from its own mis-sourcing: the validator says
 * a category is under-served, and this re-searches it mid-request, with the user
 * waiting. Everything expensive in it is LLM- or network-driven, but four
 * properties are pure control flow, and each one is a real spend or determinism
 * brake that nothing was watching:
 *
 *  1. THE PER-TIER QUERY CAP. `queriesByTier` is LLM-authored and NEITHER
 *     producing schema bounds its length — the "2-4 queries" is prompt guidance,
 *     which is not a bound. The concurrent fan-out below is exactly as wide as
 *     the plan says unless the code truncates. A prior version of this function
 *     was serial and re-checked the budget between queries, so it survived an
 *     over-long plan; the parallel version does not, which is why the cap must be
 *     enforced in code and pinned here.
 *  2. INDEX-KEYED REASSEMBLY. `.claude/rules/determinism.md` requires a
 *     `Promise.all` fan-out to be keyed back to a stable order. The dedupe and
 *     `slice(0, maxResultsPerQuery)` that follow are order-SENSITIVE, so if
 *     results were collected in completion order the surviving candidate set
 *     would depend on network timing — a non-reproducible pipeline.
 *  3. THE 85%-OF-CAP EXTRACTION GATE. Extraction is the dominant cost of a
 *     correction round. Above the threshold every candidate must be skipped AND
 *     traced (the older loop traced only the first and silently dropped the rest).
 *  4. THE QUICK-SCORE SURVIVOR THRESHOLD. `>= 4.0`, with an unscored product
 *     surviving rather than being dropped — the direction matters, because a
 *     quick-score outage must not empty the correction round.
 *
 * Everything model-shaped is mocked at the module boundary. The point is to
 * exercise the REAL control flow of the function under test, not to re-test the
 * things it calls.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import type { CandidateProduct } from "@/lib/types/database";
import type { PriceTier } from "@/lib/prompts/search-brief";

// ── module boundary mocks ────────────────────────────────────────────────────
// Declared before the import of the module under test (vi.mock is hoisted).

const searchProducts = vi.fn();
const extractFromUrlBatch = vi.fn();
const quickScoreProducts = vi.fn();
const scoreProducts = vi.fn();
const productMatchesCategoryAsync = vi.fn();

vi.mock("@/lib/agents/shopping-researcher", () => ({
  searchProducts: (...args: unknown[]) => searchProducts(...args),
  // Other exports the orchestrator imports from this module; unused here but the
  // import must resolve.
  generateSearchQueries: vi.fn(),
  generateSearchBrief: vi.fn(),
  buildSearchBrief: vi.fn(),
}));

vi.mock("@/lib/agents/product-extractor", () => ({
  extractFromUrlBatch: (...args: unknown[]) => extractFromUrlBatch(...args),
  extractFromUrl: vi.fn(),
}));

vi.mock("@/lib/agents/fit-scorer", () => ({
  quickScoreProducts: (...args: unknown[]) => quickScoreProducts(...args),
  scoreProducts: (...args: unknown[]) => scoreProducts(...args),
}));

vi.mock("@/lib/validation/category-match", () => ({
  productMatchesCategoryAsync: (...args: unknown[]) => productMatchesCategoryAsync(...args),
  productMatchesCategory: vi.fn(() => ({ ok: true })),
}));

const { reSearchCategoryForCorrection, TokenBudget } = await import("@/lib/agents/orchestrator");
const { ORCHESTRATOR } = await import("@/lib/config/pipeline");
const { PipelineTracer } = await import("@/lib/agents/pipeline-trace");

// ── fixtures ─────────────────────────────────────────────────────────────────

/** A search hit for `url`, shaped as `searchProducts` returns them. */
function hit(url: string) {
  return { url, title: `Title for ${url}`, snippet: "snippet" };
}

/** A successful extraction, shaped as `extractFromUrlBatch` returns them. */
function extraction(url: string, over: Partial<Record<string, unknown>> = {}) {
  return {
    success: true,
    tokensUsed: 0,
    data: {
      title: `Product ${url}`,
      price: 100,
      retailer: "Retailer",
      category: "coffee_table",
      description: "desc",
      colors: null,
      materials: null,
      dimensions: null,
      image_url: null,
      ...over,
    },
  };
}

type Overrides = {
  queriesByTier?: Partial<Record<PriceTier, string[]>>;
  activeTiers?: PriceTier[];
  used?: number;
  cap?: number;
  priceRange?: { min: number; max: number };
};

function makeInput(over: Overrides = {}) {
  const tokenBudget = new TokenBudget(over.cap ?? 1_000_000);
  if (over.used) tokenBudget.add(over.used);

  const tracer = new PipelineTracer("session-1", "room-1");
  const evaluations = new Map();

  return {
    input: {
      category: "coffee_table",
      queriesByTier: {
        budget: [],
        balanced: [],
        high_end: [],
        ...over.queriesByTier,
      } as { budget: string[]; balanced: string[]; high_end: string[] },
      activeTiers: over.activeTiers ?? (["balanced"] as PriceTier[]),
      ctx: {
        roomId: "room-1",
        roomType: "living_room",
        budgetMode: "balanced",
        imageUrls: [],
      } as never,
      brief: {
        categories: [
          {
            category: "coffee_table",
            tiers: over.priceRange
              ? { balanced: { price_range: over.priceRange } }
              : {},
          },
        ],
      } as never,
      tokenBudget,
      stats: {
        tokensUsed: 0,
        totalDeepScored: 0,
        totalFinal: 0,
        tokensPerPhase: {} as Record<string, number>,
      },
      tracer,
      anchorSpecs: {},
      harmonyNeighbors: [],
      evaluations,
    },
    tokenBudget,
    tracer,
    evaluations,
  };
}

/** Default happy-path doubles: every URL searches, extracts, scores and keeps. */
function stubHappyPath(urls: string[]) {
  searchProducts.mockImplementation(async (query: string) => ({
    success: true,
    tokensUsed: 0,
    data: [hit(`https://shop.example.com/${encodeURIComponent(query)}`)],
  }));
  extractFromUrlBatch.mockImplementation(async (batch: string[]) =>
    new Map(batch.map((u) => [u, extraction(u)])),
  );
  productMatchesCategoryAsync.mockResolvedValue({ ok: true });
  quickScoreProducts.mockImplementation(async (products: CandidateProduct[]) => ({
    success: true,
    tokensUsed: 0,
    data: products.map((p) => ({ productId: p.id, quickScore: 8 })),
  }));
  scoreProducts.mockImplementation(async (products: CandidateProduct[]) => ({
    results: new Map(
      products.map((p) => [p.id, { success: true, data: { final_item_score: 8 } }]),
    ),
    tokensUsed: 0,
  }));
  void urls;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── 1. the per-tier query cap ────────────────────────────────────────────────

describe("per-tier query cap — the only thing bounding an unbounded LLM list", () => {
  it("truncates an over-long tier to maxCorrectionQueriesPerTier before fanning out", async () => {
    stubHappyPath([]);
    // Twelve queries, three times the configured cap. Neither producing schema
    // bounds this list, so this is a reachable plan, not a contrived one.
    const many = Array.from({ length: 12 }, (_, i) => `query-${i}`);
    const { input } = makeInput({ queriesByTier: { balanced: many } });

    await reSearchCategoryForCorrection(input as never);

    expect(ORCHESTRATOR.maxCorrectionQueriesPerTier).toBe(4);
    expect(searchProducts).toHaveBeenCalledTimes(ORCHESTRATOR.maxCorrectionQueriesPerTier);
    // And it keeps the FIRST N, not an arbitrary slice — the planner emits its
    // strongest query first.
    const searched = searchProducts.mock.calls.map((c) => c[0]);
    expect(searched).toEqual(["query-0", "query-1", "query-2", "query-3"]);
  });

  it("caps PER TIER, so two active tiers may each run the cap", async () => {
    stubHappyPath([]);
    const many = Array.from({ length: 6 }, (_, i) => `q-${i}`);
    const { input } = makeInput({
      queriesByTier: { balanced: many, high_end: many },
      activeTiers: ["balanced", "high_end"],
    });

    await reSearchCategoryForCorrection(input as never);

    expect(searchProducts).toHaveBeenCalledTimes(2 * ORCHESTRATOR.maxCorrectionQueriesPerTier);
  });

  it("skips a tier with no queries without calling search", async () => {
    stubHappyPath([]);
    const { input } = makeInput({ queriesByTier: { balanced: [] } });

    const res = await reSearchCategoryForCorrection(input as never);

    expect(searchProducts).not.toHaveBeenCalled();
    expect(res).toEqual({ added: 0, products: [] });
  });

  it("returns empty WITHOUT searching when the budget is already exceeded", async () => {
    stubHappyPath([]);
    const { input } = makeInput({ queriesByTier: { balanced: ["q"] }, cap: 100, used: 100 });

    const res = await reSearchCategoryForCorrection(input as never);

    expect(res).toEqual({ added: 0, products: [] });
    expect(searchProducts).not.toHaveBeenCalled();
  });
});

// ── 2. index-keyed reassembly (determinism) ──────────────────────────────────

describe("concurrent fan-out is reassembled by QUERY INDEX, not completion order", () => {
  it("produces the same candidate set whichever query resolves first", async () => {
    // maxResultsPerQuery truncates the deduped list, so which candidates survive
    // depends on their ORDER. Resolve the queries in deliberately reversed
    // timing: the last query settles first.
    const urlsFor = (q: string) => [hit(`https://shop.example.com/${q}-a`)];

    async function runWithDelays(delays: Record<string, number>) {
      vi.clearAllMocks();
      searchProducts.mockImplementation(
        (query: string) =>
          new Promise((resolve) =>
            setTimeout(
              () => resolve({ success: true, tokensUsed: 0, data: urlsFor(query) }),
              delays[query] ?? 0,
            ),
          ),
      );
      extractFromUrlBatch.mockImplementation(async (batch: string[]) =>
        new Map(batch.map((u) => [u, extraction(u)])),
      );
      productMatchesCategoryAsync.mockResolvedValue({ ok: true });
      quickScoreProducts.mockImplementation(async (products: CandidateProduct[]) => ({
        success: true,
        tokensUsed: 0,
        data: products.map((p) => ({ productId: p.id, quickScore: 8 })),
      }));
      scoreProducts.mockImplementation(async (products: CandidateProduct[]) => ({
        results: new Map(
          products.map((p) => [p.id, { success: true, data: { final_item_score: 8 } }]),
        ),
        tokensUsed: 0,
      }));

      const { input } = makeInput({ queriesByTier: { balanced: ["q1", "q2", "q3", "q4"] } });
      await reSearchCategoryForCorrection(input as never);
      // The URLs handed to extraction ARE the order-sensitive artefact.
      return extractFromUrlBatch.mock.calls[0][0] as string[];
    }

    const forward = await runWithDelays({ q1: 0, q2: 5, q3: 10, q4: 15 });
    const reversed = await runWithDelays({ q1: 15, q2: 10, q3: 5, q4: 0 });

    expect(forward).toEqual(reversed);
    // And the order is the QUERY order, not the completion order.
    expect(forward).toEqual([
      "https://shop.example.com/q1-a",
      "https://shop.example.com/q2-a",
      "https://shop.example.com/q3-a",
      "https://shop.example.com/q4-a",
    ]);
  });

  it("dedupes URLs seen from more than one query, keeping the first occurrence", async () => {
    searchProducts.mockImplementation(async (query: string) => ({
      success: true,
      tokensUsed: 0,
      data:
        query === "q1"
          ? [hit("https://shop.example.com/shared"), hit("https://shop.example.com/only-1")]
          : [hit("https://shop.example.com/shared")],
    }));
    extractFromUrlBatch.mockImplementation(async (batch: string[]) =>
      new Map(batch.map((u) => [u, extraction(u)])),
    );
    productMatchesCategoryAsync.mockResolvedValue({ ok: true });
    quickScoreProducts.mockResolvedValue({ success: true, tokensUsed: 0, data: [] });
    scoreProducts.mockResolvedValue({ results: new Map(), tokensUsed: 0 });

    const { input } = makeInput({ queriesByTier: { balanced: ["q1", "q2"] } });
    await reSearchCategoryForCorrection(input as never);

    expect(extractFromUrlBatch.mock.calls[0][0]).toEqual([
      "https://shop.example.com/shared",
      "https://shop.example.com/only-1",
    ]);
  });
});

// ── 3. the 85%-of-cap extraction gate ────────────────────────────────────────

describe("extraction is gated at 85% of the token cap", () => {
  it("does not extract, and traces EVERY skipped candidate, above the threshold", async () => {
    stubHappyPath([]);
    // 90% spent: over the gate but not `exceeded`, so search still runs and the
    // gate is the thing that must stop the expensive half.
    const { input, tracer } = makeInput({
      queriesByTier: { balanced: ["q1", "q2", "q3"] },
      cap: 1000,
      used: 900,
    });
    const traceFilter = vi.spyOn(tracer, "traceFilter");

    const res = await reSearchCategoryForCorrection(input as never);

    expect(searchProducts).toHaveBeenCalledTimes(3);
    expect(extractFromUrlBatch).not.toHaveBeenCalled();
    expect(res).toEqual({ added: 0, products: [] });

    // Every candidate traced, not just the first — the older serial loop traced
    // one and dropped the rest silently, which is how a whole skipped tier could
    // look like a single filtered URL in the trace.
    expect(traceFilter).toHaveBeenCalledTimes(3);
    for (const call of traceFilter.mock.calls) {
      expect(call[0]).toBe("correction_extract");
      expect(call[3]).toBe("budget > 85%");
    }
    const tracedUrls = traceFilter.mock.calls.map((c) => c[2]);
    expect(new Set(tracedUrls).size).toBe(3);
  });

  it("DOES extract just under the threshold", async () => {
    stubHappyPath([]);
    // 84% — the gate is `> 0.85`, so this side must proceed. Pins which side of
    // the boundary is which, so a `>=`/`>` slip is caught.
    const { input } = makeInput({
      queriesByTier: { balanced: ["q1"] },
      cap: 1000,
      used: 840,
    });

    await reSearchCategoryForCorrection(input as never);

    expect(extractFromUrlBatch).toHaveBeenCalledTimes(1);
  });
});

// ── 4. the quick-score survivor threshold ────────────────────────────────────

describe("quick-score survivor threshold", () => {
  /** Search three URLs so the three quick-score outcomes can be distinguished. */
  function stubThreeCandidates() {
    searchProducts.mockResolvedValue({
      success: true,
      tokensUsed: 0,
      data: [hit("https://s.example/a"), hit("https://s.example/b"), hit("https://s.example/c")],
    });
    extractFromUrlBatch.mockImplementation(async (batch: string[]) =>
      new Map(batch.map((u) => [u, extraction(u)])),
    );
    productMatchesCategoryAsync.mockResolvedValue({ ok: true });
    scoreProducts.mockImplementation(async (products: CandidateProduct[]) => ({
      results: new Map(
        products.map((p) => [p.id, { success: true, data: { final_item_score: 8 } }]),
      ),
      tokensUsed: 0,
    }));
  }

  it("drops products below 4.0 and keeps the boundary value itself", async () => {
    stubThreeCandidates();
    quickScoreProducts.mockImplementation(async (products: CandidateProduct[]) => ({
      success: true,
      tokensUsed: 0,
      // Exactly at the threshold, just under, and well over.
      data: [
        { productId: products[0].id, quickScore: 4.0 },
        { productId: products[1].id, quickScore: 3.9 },
        { productId: products[2].id, quickScore: 9 },
      ],
    }));

    const { input } = makeInput({ queriesByTier: { balanced: ["q1"] } });
    const res = await reSearchCategoryForCorrection(input as never);

    // The 3.9 never reaches deep scoring at all — that is the point of the gate.
    const deepScored = scoreProducts.mock.calls[0][0] as CandidateProduct[];
    expect(deepScored).toHaveLength(2);
    expect(res.added).toBe(2);
  });

  it("keeps a product the quick-scorer returned NO score for", async () => {
    stubThreeCandidates();
    // A partial or failed quick-score response must not silently empty the
    // correction round — an unscored product survives to deep scoring, which is
    // the safe direction (the deep scorer is the real gate).
    quickScoreProducts.mockResolvedValue({ success: false, tokensUsed: 0, data: null });

    const { input } = makeInput({ queriesByTier: { balanced: ["q1"] } });
    const res = await reSearchCategoryForCorrection(input as never);

    expect(scoreProducts.mock.calls[0][0]).toHaveLength(3);
    expect(res.added).toBe(3);
  });
});

// ── extraction-result rejections ─────────────────────────────────────────────

describe("candidates rejected between extraction and scoring", () => {
  function stubOneCandidate(extractOver: Record<string, unknown> = {}) {
    searchProducts.mockResolvedValue({
      success: true,
      tokensUsed: 0,
      data: [hit("https://s.example/a")],
    });
    extractFromUrlBatch.mockImplementation(async (batch: string[]) =>
      new Map(batch.map((u) => [u, extraction(u, extractOver)])),
    );
    productMatchesCategoryAsync.mockResolvedValue({ ok: true });
    quickScoreProducts.mockImplementation(async (products: CandidateProduct[]) => ({
      success: true,
      tokensUsed: 0,
      data: products.map((p) => ({ productId: p.id, quickScore: 8 })),
    }));
    scoreProducts.mockImplementation(async (products: CandidateProduct[]) => ({
      results: new Map(
        products.map((p) => [p.id, { success: true, data: { final_item_score: 8 } }]),
      ),
      tokensUsed: 0,
    }));
  }

  it.each(["PAGE_NOT_ACCESSIBLE", "NOT_A_PRODUCT_PAGE", "PRODUCT_DATA_UNAVAILABLE", ""])(
    "rejects the extractor's %s sentinel instead of shipping it as a product title",
    async (title) => {
      stubOneCandidate({ title });
      const { input } = makeInput({ queriesByTier: { balanced: ["q1"] } });

      const res = await reSearchCategoryForCorrection(input as never);

      // These sentinels are literal strings the extractor returns in the `title`
      // field. Letting one through would surface "PAGE_NOT_ACCESSIBLE" to a user
      // as a recommended product name.
      expect(res).toEqual({ added: 0, products: [] });
      expect(quickScoreProducts).not.toHaveBeenCalled();
    },
  );

  it("rejects a product the category matcher disowns", async () => {
    stubOneCandidate();
    productMatchesCategoryAsync.mockResolvedValue({ ok: false });

    const { input } = makeInput({ queriesByTier: { balanced: ["q1"] } });
    const res = await reSearchCategoryForCorrection(input as never);

    expect(res).toEqual({ added: 0, products: [] });
  });

  it("rejects prices outside the tier band, and keeps the tolerance boundaries", async () => {
    // The band is deliberately loose — 1.75x the max and 0.4x the min — so the
    // correction round can still surface a near-miss the planner would want.
    // Pin both edges: a slack that drifts either way silently changes what a
    // budget-constrained user is shown.
    const priceRange = { min: 100, max: 200 };
    const cases: Array<[number, boolean]> = [
      [350, true], // exactly 1.75 * max — kept (the check is `>`)
      [351, false], // over the ceiling
      [40, true], // exactly 0.4 * min — kept (the check is `<`)
      [39, false], // under the floor
    ];
    for (const [price, kept] of cases) {
      vi.clearAllMocks();
      stubOneCandidate({ price });
      const { input } = makeInput({ queriesByTier: { balanced: ["q1"] }, priceRange });

      const res = await reSearchCategoryForCorrection(input as never);

      expect(res.added, `price ${price} should be ${kept ? "kept" : "rejected"}`).toBe(kept ? 1 : 0);
    }
  });

  it("applies no price band when the brief has no range for the tier", async () => {
    stubOneCandidate({ price: 99999 });
    const { input } = makeInput({ queriesByTier: { balanced: ["q1"] } });

    const res = await reSearchCategoryForCorrection(input as never);

    expect(res.added).toBe(1);
  });
});

// ── token accounting ─────────────────────────────────────────────────────────

describe("token accounting attributes spend to the right phase", () => {
  it("adds search and extract tokens to the budget and to per-phase stats", async () => {
    searchProducts.mockResolvedValue({
      success: true,
      tokensUsed: 70,
      data: [hit("https://s.example/a")],
    });
    extractFromUrlBatch.mockImplementation(async (batch: string[]) =>
      new Map(batch.map((u) => [u, { ...extraction(u), tokensUsed: 30 }])),
    );
    productMatchesCategoryAsync.mockResolvedValue({ ok: true });
    quickScoreProducts.mockImplementation(async (products: CandidateProduct[]) => ({
      success: true,
      tokensUsed: 11,
      data: products.map((p) => ({ productId: p.id, quickScore: 8 })),
    }));
    scoreProducts.mockImplementation(async (products: CandidateProduct[]) => ({
      results: new Map(
        products.map((p) => [p.id, { success: true, data: { final_item_score: 8 } }]),
      ),
      tokensUsed: 13,
    }));

    const { input, tokenBudget } = makeInput({ queriesByTier: { balanced: ["q1"] } });
    await reSearchCategoryForCorrection(input as never);

    // Spend has to land on the BUDGET, or the brake never trips no matter how
    // many correction rounds run.
    expect(tokenBudget.used).toBe(70 + 30 + 11 + 13);
    expect(input.stats.tokensUsed).toBe(70 + 30 + 11 + 13);
    expect(input.stats.tokensPerPhase).toEqual({
      search: 70,
      extract: 30,
      quick_score: 11,
      deep_score: 13,
    });
  });
});
