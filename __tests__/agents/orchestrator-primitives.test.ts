import { describe, it, expect } from "vitest";

import { TokenBudget, cartesian } from "@/lib/agents/orchestrator";

/**
 * The orchestrator's two deterministic primitives, both previously at zero
 * coverage (the module sits around 3% — it is almost entirely LLM-driven, and
 * these are the parts that are not).
 *
 * `TokenBudget.exceeded` is the pipeline's spend brake: seventeen call sites
 * stop work on it, so the difference between `>=` and `>` at the cap is one
 * more round of model calls charged after the budget is gone.
 *
 * `cartesian` enumerates the candidate bundles. The property worth pinning is
 * COMPLETENESS — a dropped combination is a product pairing that is never
 * scored and can never be recommended, and nothing downstream would notice,
 * because the caller only ever sees the combos it is handed.
 *
 * Element ORDER inside a combo is deliberately NOT asserted. An earlier version
 * of this file claimed it was a contract because "callers read combo[k] as the
 * pick from category k". A reviewer falsified that: `grep -rn "combo\["` over
 * lib/ and app/ returns NOTHING, both call sites (orchestrator.ts:1994, :2410)
 * pass the whole array to `evaluateBundle`/`prefilterBundleCombos`, which read
 * each product's own `.category`/`.id`, and `tiebreakBundle` (:79-83) sorts a
 * combo's URLs BEFORE joining them — i.e. it is explicitly order-insensitive by
 * design. Asserting an order nothing depends on would be a change-detector: a
 * refactor would break it and a real bug would not. So completeness is checked
 * order-insensitively. Recorded here so it is not re-derived.
 *
 * Two things are NOT tested, deliberately:
 *  - `TokenBudget.remaining` — no call site (`grep -o 'tokenBudget\.[a-zA-Z]*'`
 *    finds only add/cap/exceeded/used). A test would pin dead code.
 *  - `cartesian` with an empty inner array — unreachable: both call sites build
 *    their input with `if (tierFiltered.length > 0) topByCategory.push(...)`,
 *    so an empty member can never be passed.
 */

describe("TokenBudget", () => {
  it("starts empty and accumulates what it is given", () => {
    const budget = new TokenBudget(1_000);
    expect(budget.used).toBe(0);
    expect(budget.exceeded).toBe(false);

    budget.add(300);
    budget.add(200);

    expect(budget.used).toBe(500);
    expect(budget.cap).toBe(1_000);
  });

  it("is NOT exceeded one token below the cap", () => {
    const budget = new TokenBudget(1_000);
    budget.add(999);
    expect(budget.exceeded).toBe(false);
  });

  it("IS exceeded exactly AT the cap", () => {
    // The boundary that matters: `used > cap` instead of `>=` would let the
    // pipeline spend a further round after the budget is fully consumed.
    const budget = new TokenBudget(1_000);
    budget.add(1_000);
    expect(budget.exceeded).toBe(true);
  });

  it("stays exceeded once past the cap", () => {
    const budget = new TokenBudget(1_000);
    budget.add(1_500);
    expect(budget.exceeded).toBe(true);
    budget.add(10);
    expect(budget.exceeded).toBe(true);
  });

  it("a zero cap is exhausted from the start", () => {
    // Guards the degenerate config: a cap of 0 must stop the pipeline
    // immediately rather than granting one free round.
    expect(new TokenBudget(0).exceeded).toBe(true);
  });
});

/** Compare combos as unordered contents, since order is not a contract. */
function asSet(combos: string[][]): string[] {
  return combos.map((combo) => [...combo].sort().join("+")).sort();
}

describe("cartesian", () => {
  it("produces every combination, exactly once", () => {
    const combos = cartesian([
      ["sofa-a", "sofa-b"],
      ["rug-a", "rug-b", "rug-c"],
    ]);

    // Length pins "exactly once" (a duplicate would inflate it); the set pins
    // "every" (a dropped pairing would be missing).
    expect(combos).toHaveLength(6);
    expect(asSet(combos)).toEqual([
      "rug-a+sofa-a",
      "rug-a+sofa-b",
      "rug-b+sofa-a",
      "rug-b+sofa-b",
      "rug-c+sofa-a",
      "rug-c+sofa-b",
    ]);
  });

  it("takes exactly one element from each array", () => {
    // Every combo must be one pick per category — no category dropped, none
    // represented twice.
    const combos = cartesian([
      ["sofa-a", "sofa-b"],
      ["rug-a", "rug-b"],
      ["lamp-a", "lamp-b"],
    ]);

    expect(combos).toHaveLength(8);
    for (const combo of combos) {
      expect(combo).toHaveLength(3);
      expect(new Set(combo.map((item) => item.split("-")[0])).size).toBe(3);
    }
  });

  it("returns the single empty combination for no arrays", () => {
    // The recursion's terminal step, reached on every real invocation. `[]`
    // here instead of `[[]]` would make the outer loop produce nothing and
    // collapse every bundle to zero combos.
    expect(cartesian([])).toEqual([[]]);
  });
});
