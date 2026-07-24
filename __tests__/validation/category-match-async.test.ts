import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

// Mock the LLM escalation so productMatchesCategoryAsync's borderline path is
// deterministic and never touches Gemini. Each test drives the mock's return
// (a decisive verdict, an abstain-null, or a throw) to exercise one branch of
// the async wrapper's escalate-or-fall-through logic.
vi.mock("@/lib/ai/semantic-extract", () => ({
  productMatchesCategoryLLM: vi.fn(),
}));

import { productMatchesCategoryAsync } from "@/lib/validation/category-match";
import { productMatchesCategoryLLM } from "@/lib/ai/semantic-extract";

const mockLLM = productMatchesCategoryLLM as unknown as Mock;

beforeEach(() => {
  mockLLM.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("productMatchesCategoryAsync — LLM escalation gating", () => {
  it("returns a clean accept WITHOUT escalating to the LLM", async () => {
    // Rule 2: extracted category equals expected → deterministic accept, so the
    // async wrapper must short-circuit before the (paid) LLM call.
    const r = await productMatchesCategoryAsync("sofa", "sofa", "Modern Grey Sofa");
    expect(r.ok).toBe(true);
    expect(mockLLM).not.toHaveBeenCalled();
  });

  it("returns a disqualifying-term reject WITHOUT escalating to the LLM", async () => {
    // Rule 1: a disqualifying title term is a HARD reject the LLM must not be
    // allowed to override — escalating a lint-roller-for-a-vase to the model
    // wastes cost and risks a false accept. The wrapper returns initial directly.
    const r = await productMatchesCategoryAsync("vase", "other", "Deluxe Lint Roller");
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('disqualifying term "lint roller"');
    expect(mockLLM).not.toHaveBeenCalled();
  });

  it("escalates a borderline reject and RETURNS the LLM's accept (divan → sofa case)", async () => {
    // Rule 4 borderline reject (extractor "other" + no alias hit — "divan" is a
    // sofa synonym absent from the alias list) is exactly the case the LLM exists
    // to rescue. A truthy verdict supersedes the regex reject.
    mockLLM.mockResolvedValueOnce({ ok: true, reason: "divan is a sofa synonym" });
    const r = await productMatchesCategoryAsync("sofa", "other", "Velvet Divan");
    expect(r).toEqual({ ok: true, reason: "divan is a sofa synonym" });
    expect(mockLLM).toHaveBeenCalledTimes(1);
    expect(mockLLM).toHaveBeenCalledWith("sofa", "Velvet Divan", "other");
  });

  it("falls through to the deterministic reject when the LLM ABSTAINS (null)", async () => {
    // A null verdict (unparseable / low-confidence) must NOT be treated as an
    // accept — the wrapper keeps the conservative regex reject.
    mockLLM.mockResolvedValueOnce(null);
    const r = await productMatchesCategoryAsync("vase", "other", "Random Widget XZ");
    expect(r.ok).toBe(false);
    // The retained reason is the deterministic Rule-4 reject, not an LLM string.
    expect(r.reason).toContain("extractor returned");
    expect(mockLLM).toHaveBeenCalledTimes(1);
  });

  it("falls through to the deterministic reject when the LLM THROWS", async () => {
    // A provider error (timeout / network) is caught and MUST fail safe to the
    // regex verdict, never crash the caller mid-sourcing.
    mockLLM.mockRejectedValueOnce(new Error("gemini timeout"));
    const r = await productMatchesCategoryAsync("vase", "other", "Random Widget XZ");
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("extractor returned");
    expect(mockLLM).toHaveBeenCalledTimes(1);
  });
});
