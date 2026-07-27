import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The MATH CAP inside `validateProductSet` — the deterministic enforcement layer
 * that sits between the validation LLM and the score the product ships with.
 *
 * ARCHITECTURE.md calls the deterministic validators the enforcement layer, and
 * this is where that enforcement actually happens for a product set: the model
 * returns a `harmony_score` per flagged product, and the server then lowers it
 * using scores computed by `lib/validation/set-math.ts` from the real product
 * attributes. Two branches:
 *
 *   with sub_scores → `computeFinalHarmonyScore` composite, capped per DIMENSION
 *                     (color_fit by color_score, material_fit by material_score)
 *   no sub_scores   → a flat cap, applied only when math_harmony < 0.6 AND the
 *                     model's score > 6
 *
 * In BOTH branches the cap may only LOWER. That direction is the whole point: a
 * model that is optimistic about a clashing set must not be able to raise its
 * own score past what the deterministic layer computed.
 *
 * `__tests__/agents/validation-agent.test.ts` covers the data contracts — it
 * constructs `ValidationResult` literals and asserts their shape, and never
 * calls `validateProductSet`. So an inverted comparison, a dropped cap, or a
 * mathEntry lookup that stops matching would all pass it. This drives the real
 * function.
 *
 * Only the LLM is mocked. `computeSetMathScores` runs for real against real
 * product attributes, so the caps under test are the ones production computes.
 */

const chat = vi.fn();
vi.mock("@/lib/ai/gemini", () => ({
  geminiProvider: { chat: (...args: unknown[]) => chat(...args) },
}));

const { validateProductSet } = await import("@/lib/agents/validation-agent");
const { computeSetMathScores } = await import("@/lib/validation/set-math");

/**
 * A genuinely incoherent set — the case the enforcement layer exists for. It
 * takes all three of the penalties `set-math` actually models to get under the
 * 0.6 flat-cap threshold: more than two wood species across the set, warm
 * metals (brass/gold/copper/bronze) mixed with cool ones (chrome/nickel/steel),
 * and colours spread around the wheel.
 *
 * Getting here was not obvious — an earlier fixture with lurid clashing colours
 * and no material conflicts scored 0.78, comfortably ABOVE the threshold,
 * because the colour term alone is deliberately forgiving (an unresolvable
 * colour scores a neutral 0.75 by design). Hence the precondition test below:
 * it pins the fixture's real math so a capping test can never quietly pass
 * because nothing was ever capped.
 */
const CLASHING_PRODUCTS = [
  {
    title: "Oak Sofa With Mixed Metal Legs",
    category: "sofa",
    tier: "balanced",
    materials: ["oak", "brass", "chrome"],
    colors: ["red"],
    price: 1200,
  },
  {
    title: "Walnut And Maple Coffee Table",
    category: "coffee_table",
    tier: "balanced",
    materials: ["walnut", "maple", "nickel", "gold"],
    colors: ["green"],
    price: 400,
  },
  {
    title: "Teak Framed Rug",
    category: "rug",
    tier: "balanced",
    materials: ["teak", "copper", "steel"],
    colors: ["blue"],
    price: 300,
  },
  {
    title: "Cherry Floor Lamp",
    category: "floor_lamp",
    tier: "balanced",
    materials: ["cherry", "bronze", "chrome"],
    colors: ["yellow"],
    price: 180,
  },
];

/**
 * The product in that set whose real math falls under the threshold. Pinned
 * here, but never TRUSTED: the precondition test recomputes it and fails if the
 * assumption stops holding.
 */
const CAPPED_TITLE = "Teak Framed Rug";

const ROOM_CONTEXT = {
  roomType: "living_room",
  designDirection: "warm minimalist",
  existingItems: ["walnut console"],
};

function llmReturns(body: unknown) {
  chat.mockResolvedValue({
    content: JSON.stringify(body),
    model: "gemini-2.5-flash-lite",
    usage: { input_tokens: 10, output_tokens: 10, thinking_tokens: 0 },
  });
}

type SetResult = Awaited<ReturnType<typeof validateProductSet>>;

/** Assert a successful run and hand back the product flags it produced. */
function flagsOf(result: SetResult) {
  expect(result.success, `validateProductSet failed: ${JSON.stringify(result)}`).toBe(true);
  expect(result.data, "successful result carried no data").toBeDefined();
  const flags = result.data!.product_flags;
  expect(flags, "no product_flags returned").toBeDefined();
  return flags!;
}

beforeEach(() => {
  chat.mockReset();
});

describe("validateProductSet — deterministic math cap", () => {
  it("the fixture really does score below the flat-cap threshold (the test is not vacuous)", () => {
    // If the real math ever stops rating this set poorly, the capping tests
    // below would pass for the wrong reason — they would assert "no cap" on a
    // set that never triggered one. Pin the precondition explicitly.
    const math = computeSetMathScores(CLASHING_PRODUCTS, ROOM_CONTEXT);
    const entry = math.per_product.find((p) => p.title === CAPPED_TITLE);
    expect(entry, `no math entry for ${CAPPED_TITLE}`).toBeDefined();
    expect(entry!.math_harmony).toBeLessThan(0.6);
  });

  it("lowers an over-confident model score to the flat math cap (no sub_scores)", async () => {
    const math = computeSetMathScores(CLASHING_PRODUCTS, ROOM_CONTEXT);
    const cappedMath = math.per_product.find((p) => p.title === CAPPED_TITLE)!;

    llmReturns({
      isValid: true,
      confidence: 9,
      issues: [],
      product_flags: [
        { title: CAPPED_TITLE, category: "rug", harmony_score: 9, reason: "looks great" },
      ],
      pairwise_conflicts: [],
    });

    const flag = flagsOf(await validateProductSet(CLASHING_PRODUCTS, ROOM_CONTEXT))[0];
    // Exactly the documented cap — Math.round(math_harmony * 10) — not merely
    // "something lower", so an off-by-one or a different rounding is caught.
    expect(flag.harmony_score).toBe(Math.round(cappedMath.math_harmony * 10));
    expect(flag.harmony_score).toBeLessThan(9);
  });

  it("leaves a modest model score alone — the cap only ever LOWERS", async () => {
    // Same clashing set, but the model already scored it at 5. The flat branch
    // is guarded by `harmony_score > 6`, so nothing should move: the
    // enforcement layer must never RAISE a score toward the math value.
    llmReturns({
      isValid: false,
      confidence: 5,
      issues: ["colours clash"],
      product_flags: [
        { title: CAPPED_TITLE, category: "rug", harmony_score: 5, reason: "clashes" },
      ],
      pairwise_conflicts: [],
    });

    const flags = flagsOf(await validateProductSet(CLASHING_PRODUCTS, ROOM_CONTEXT));
    expect(flags[0].harmony_score).toBe(5);
  });

  it("caps the composite when the model supplies sub_scores", async () => {
    // The other branch: with sub_scores present the flat cap is skipped and the
    // composite runs, capping color_fit and material_fit per DIMENSION. A model
    // claiming near-perfect sub-scores on a clashing set must still come down.
    llmReturns({
      isValid: true,
      confidence: 9,
      issues: [],
      product_flags: [
        {
          title: CAPPED_TITLE,
          category: "rug",
          harmony_score: 10,
          reason: "perfect",
          sub_scores: {
            color_fit: 10,
            spatial_fit: 10,
            material_fit: 10,
            style_coherence: 10,
            cross_room_fit: 10,
            functional_fit: 10,
          },
        },
      ],
      pairwise_conflicts: [],
    });

    const flags = flagsOf(await validateProductSet(CLASHING_PRODUCTS, ROOM_CONTEXT));
    expect(flags[0].harmony_score).toBeLessThan(10);
  });

  it("does not cap a set the real math rates well", async () => {
    // The control. Without it, a bug that capped EVERYTHING to a low number
    // would satisfy every assertion above.
    const coherent = [
      {
        title: "Walnut Sofa",
        category: "sofa",
        tier: "balanced",
        materials: ["walnut", "linen"],
        colors: ["oatmeal"],
        price: 1400,
      },
      {
        title: "Walnut Coffee Table",
        category: "coffee_table",
        tier: "balanced",
        materials: ["walnut"],
        colors: ["walnut"],
        price: 500,
      },
    ];
    const math = computeSetMathScores(coherent, ROOM_CONTEXT);
    const entry = math.per_product.find((p) => p.title === "Walnut Sofa")!;
    expect(entry.math_harmony, "fixture is meant to score well").toBeGreaterThanOrEqual(0.6);

    llmReturns({
      isValid: true,
      confidence: 9,
      issues: [],
      product_flags: [
        { title: "Walnut Sofa", category: "sofa", harmony_score: 9, reason: "coherent" },
      ],
      pairwise_conflicts: [],
    });

    const flags = flagsOf(await validateProductSet(coherent, ROOM_CONTEXT));
    expect(flags[0].harmony_score).toBe(9);
  });

  it("passes the deterministic seed and a cheap thinking level on the validation call", async () => {
    // Two repo contracts that are invisible to a shape test and cost real money
    // (or reproducibility) when they regress: every LLM call carries
    // DETERMINISTIC_SEED, and `validation` is NOT one of the tasks allowed to
    // run HIGH thinking.
    llmReturns({ isValid: true, confidence: 8, issues: [], pairwise_conflicts: [] });
    await validateProductSet(CLASHING_PRODUCTS, ROOM_CONTEXT);

    expect(chat).toHaveBeenCalled();
    const params = chat.mock.calls[0][0] as {
      seed?: number;
      thinkingConfig?: { thinkingLevel?: string };
    };
    const { DETERMINISTIC_SEED } = await import("@/lib/ai/determinism");
    expect(params.seed).toBe(DETERMINISTIC_SEED);
    expect(params.thinkingConfig).toBeDefined();
    expect(params.thinkingConfig!.thinkingLevel).not.toBe("high");
  });
});
