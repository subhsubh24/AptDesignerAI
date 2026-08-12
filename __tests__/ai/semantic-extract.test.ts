import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The semantic-extract helpers wrap a single Gemini call (getProvider().chat)
// and layer real, load-bearing normalization on top of the raw LLM JSON:
// early-return guards, array filtering, label canonicalization, HSL clamping,
// and disable/timeout fall-through to null. We exercise those branches with a
// mocked provider so no live LLM is touched — the response content is fed to
// the REAL extractJsonObject, so parse behavior is covered end to end too.

const chatMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/ai/provider-factory", () => ({
  getProvider: () => ({ chat: chatMock }),
}));

import {
  parseUserContextLLM,
  expandExclusionTermsLLM,
  classifyStyleLabelLLM,
  inferColorHslLLM,
  dedupProductTitlesLLM,
  classifyArchitecturalLLM,
  classifyInvalidRemoveLLM,
  isScrapeContextSufficientLLM,
  productMatchesCategoryLLM,
  summarizePreferencesLLM,
  extractKeepCategoriesLLM,
} from "@/lib/ai/semantic-extract";

/** Make the mocked provider answer with a JSON string, as the real chat() does. */
function respondWith(obj: unknown): void {
  chatMock.mockResolvedValue({ content: JSON.stringify(obj) });
}

beforeEach(() => {
  chatMock.mockReset();
  delete process.env.DISABLE_SEMANTIC_EXTRACT;
});

afterEach(() => {
  delete process.env.DISABLE_SEMANTIC_EXTRACT;
});

describe("semantic-extract — early-return guards never call the LLM", () => {
  it("parseUserContextLLM returns null on too-short input", async () => {
    expect(await parseUserContextLLM("hi")).toBeNull();
    expect(await parseUserContextLLM("   ")).toBeNull();
    expect(chatMock).not.toHaveBeenCalled();
  });

  it("expandExclusionTermsLLM short-circuits to [] on an empty list", async () => {
    expect(await expandExclusionTermsLLM([])).toEqual([]);
    expect(chatMock).not.toHaveBeenCalled();
  });

  it("classifyStyleLabelLLM returns null when the haystack is too small", async () => {
    expect(await classifyStyleLabelLLM("", [])).toBeNull();
    expect(await classifyStyleLabelLLM("a", ["b"])).toBeNull();
    expect(chatMock).not.toHaveBeenCalled();
  });

  it("inferColorHslLLM returns null on a blank/one-char color name", async () => {
    expect(await inferColorHslLLM("")).toBeNull();
    expect(await inferColorHslLLM("x")).toBeNull();
    expect(chatMock).not.toHaveBeenCalled();
  });

  it("dedupProductTitlesLLM returns an empty set for fewer than 2 items", async () => {
    const drop = await dedupProductTitlesLLM([
      { id: "1", title: "Only one", retailer: null },
    ]);
    expect(drop).toBeInstanceOf(Set);
    expect(drop!.size).toBe(0);
    expect(chatMock).not.toHaveBeenCalled();
  });
});

describe("semantic-extract — disabled + failure fall through to null", () => {
  it("DISABLE_SEMANTIC_EXTRACT=1 skips the call and returns null", async () => {
    process.env.DISABLE_SEMANTIC_EXTRACT = "1";
    expect(await parseUserContextLLM("I don't want beige at all")).toBeNull();
    expect(chatMock).not.toHaveBeenCalled();
  });

  it("a provider error is swallowed and the caller gets null", async () => {
    chatMock.mockRejectedValue(new Error("provider exploded"));
    expect(await parseUserContextLLM("keep my walnut credenza please")).toBeNull();
  });

  it("unparseable content yields null (extractJsonObject fails closed)", async () => {
    chatMock.mockResolvedValue({ content: "not json at all" });
    expect(await inferColorHslLLM("mediterranean blue")).toBeNull();
  });
});

describe("parseUserContextLLM — defensive normalization", () => {
  it("filters non-strings/short tokens, trims, and coerces wants_multiple", async () => {
    respondWith({
      exclusions: ["beige", "x", 42, "  navy  "],
      explicit_requests: [
        { item: "  floor lamp ", wants_multiple: 1 },
        { item: "a", wants_multiple: false },
        { item: 99 },
      ],
      additional_keep_items: ["sofa", ""],
      lifestyle_notes: ["hosts often", null],
    });
    const parsed = await parseUserContextLLM("a long enough client note here");
    expect(parsed).not.toBeNull();
    expect(parsed!.exclusions).toEqual(["beige", "navy"]);
    expect(parsed!.explicit_requests).toEqual([
      { item: "floor lamp", wants_multiple: true },
    ]);
    expect(parsed!.additional_keep_items).toEqual(["sofa"]);
    expect(parsed!.lifestyle_notes).toEqual(["hosts often"]);
  });

  it("coerces missing arrays to empty arrays", async () => {
    respondWith({});
    const parsed = await parseUserContextLLM("a long enough client note here");
    expect(parsed).toEqual({
      exclusions: [],
      explicit_requests: [],
      additional_keep_items: [],
      lifestyle_notes: [],
    });
  });
});

describe("expandExclusionTermsLLM — cleaning, dedup, and original inclusion", () => {
  it("lowercases, drops out-of-length terms, and always includes the originals", async () => {
    respondWith({
      expanded: [
        "Drapes",
        "x", // too short (<2)
        "a".repeat(60), // too long (>=50)
        "curtains",
        "curtains", // dupe
      ],
    });
    const out = await expandExclusionTermsLLM(["Curtain"]);
    expect(out).not.toBeNull();
    // original (lowercased) is present
    expect(out).toContain("curtain");
    expect(out).toContain("drapes");
    expect(out).toContain("curtains");
    // no dupes, nothing out-of-length
    expect(out).toEqual([...new Set(out)]);
    expect(out!.some((t) => t.length < 2 || t.length >= 50)).toBe(false);
  });

  it("returns null when the model omits the expanded array", async () => {
    respondWith({ nope: true });
    expect(await expandExclusionTermsLLM(["curtain"])).toBeNull();
  });
});

describe("classifyStyleLabelLLM — canonicalization to the closed vocabulary", () => {
  it("maps a case-mismatched label back to the canonical spelling", async () => {
    respondWith({ label: "japandi" });
    expect(await classifyStyleLabelLLM("warm minimalist notes", ["oak", "linen"])).toBe(
      "Japandi",
    );
  });

  it("returns null when the label is outside the vocabulary", async () => {
    respondWith({ label: "Steampunk" });
    expect(await classifyStyleLabelLLM("some notes here", ["brass"])).toBeNull();
  });

  it("returns null when the model returns a non-string label", async () => {
    respondWith({ label: null });
    expect(await classifyStyleLabelLLM("some notes here", ["brass"])).toBeNull();
  });
});

describe("inferColorHslLLM — HSL clamping", () => {
  it("clamps h/s/l into their valid ranges", async () => {
    respondWith({ h: 400, s: -5, l: 250 });
    expect(await inferColorHslLLM("hyper blue")).toEqual({ h: 360, s: 0, l: 100 });
  });

  it("passes through in-range values untouched", async () => {
    respondWith({ h: 210, s: 40, l: 55 });
    expect(await inferColorHslLLM("muted sage")).toEqual({ h: 210, s: 40, l: 55 });
  });

  it("returns null when a channel is missing/non-numeric", async () => {
    respondWith({ h: 210, s: "40", l: 55 });
    expect(await inferColorHslLLM("muted sage")).toBeNull();
  });
});

describe("dedupProductTitlesLLM — keep first, drop the rest", () => {
  it("drops every id in a group except the first", async () => {
    respondWith({
      groups: [
        { duplicate_ids: ["a", "b", "c"] },
        { duplicate_ids: ["solo"] }, // <2 → ignored
        { duplicate_ids: ["d", "e"] },
      ],
    });
    const drop = await dedupProductTitlesLLM([
      { id: "a", title: "Kallax 2x2", retailer: "IKEA" },
      { id: "b", title: "Kallax 2×2 White", retailer: "IKEA" },
      { id: "c", title: "KALLAX shelf 2x2", retailer: "IKEA" },
      { id: "d", title: "Billy", retailer: "IKEA" },
      { id: "e", title: "Billy bookcase", retailer: "IKEA" },
    ]);
    expect(drop).not.toBeNull();
    expect([...drop!].sort()).toEqual(["b", "c", "e"]);
  });

  it("returns null when the model omits the groups array", async () => {
    respondWith({});
    const drop = await dedupProductTitlesLLM([
      { id: "a", title: "x", retailer: null },
      { id: "b", title: "y", retailer: null },
    ]);
    expect(drop).toBeNull();
  });
});

describe("classifyArchitecturalLLM — architectural-vs-furniture split", () => {
  it("short-circuits to an empty set on an empty list", async () => {
    expect(await classifyArchitecturalLLM([])).toEqual(new Set());
    expect(chatMock).not.toHaveBeenCalled();
  });

  it("returns the architectural subset as a Set, filtering non-strings", async () => {
    respondWith({ architectural: ["hardwood flooring", 42, "crown molding"] });
    const result = await classifyArchitecturalLLM(["hardwood flooring", "area rug", "crown molding"]);
    expect(result).toEqual(new Set(["hardwood flooring", "crown molding"]));
  });

  it("returns null when the model omits the architectural array", async () => {
    respondWith({ nope: true });
    expect(await classifyArchitecturalLLM(["flooring"])).toBeNull();
  });
});

describe("classifyInvalidRemoveLLM — removable-item validity", () => {
  it("short-circuits to an empty set on an empty list", async () => {
    expect(await classifyInvalidRemoveLLM([])).toEqual(new Set());
    expect(chatMock).not.toHaveBeenCalled();
  });

  it("returns the invalid subset as a Set, filtering non-strings", async () => {
    respondWith({ invalid: ["lack of art", true, "wall outlet"] });
    const result = await classifyInvalidRemoveLLM(["old couch", "lack of art", "wall outlet"]);
    expect(result).toEqual(new Set(["lack of art", "wall outlet"]));
  });

  it("returns null when the model omits the invalid array", async () => {
    respondWith({});
    expect(await classifyInvalidRemoveLLM(["old couch"])).toBeNull();
  });
});

describe("isScrapeContextSufficientLLM — scrape-sufficiency guard", () => {
  it("returns false (not null) without calling the model when context is too short", async () => {
    expect(await isScrapeContextSufficientLLM("")).toBe(false);
    expect(await isScrapeContextSufficientLLM("too short")).toBe(false);
    expect(chatMock).not.toHaveBeenCalled();
  });

  it("passes through a true verdict from the model", async () => {
    respondWith({ sufficient: true });
    expect(await isScrapeContextSufficientLLM("A".repeat(50))).toBe(true);
  });

  it("passes through a false verdict from the model", async () => {
    respondWith({ sufficient: false });
    expect(await isScrapeContextSufficientLLM("A".repeat(50))).toBe(false);
  });

  it("returns null (distinct from false) when the model's field is missing/non-boolean", async () => {
    respondWith({ sufficient: "yes" });
    expect(await isScrapeContextSufficientLLM("A".repeat(50))).toBeNull();
  });

  it("returns null when the provider call fails", async () => {
    chatMock.mockRejectedValue(new Error("boom"));
    expect(await isScrapeContextSufficientLLM("A".repeat(50))).toBeNull();
  });
});

describe("productMatchesCategoryLLM — category-fit guard", () => {
  it("short-circuits to ok:true without calling the model when there's no expected category", async () => {
    const result = await productMatchesCategoryLLM("", "some title", "sofa");
    expect(result).toEqual({ ok: true, reason: "no expected category" });
    expect(chatMock).not.toHaveBeenCalled();
  });

  it("short-circuits to ok:false without calling the model when there's neither title nor category", async () => {
    const result = await productMatchesCategoryLLM("sofa", null, undefined);
    expect(result).toEqual({ ok: false, reason: "no title or category" });
    expect(chatMock).not.toHaveBeenCalled();
  });

  it("passes through the model's ok/reason verdict", async () => {
    respondWith({ ok: false, reason: "this is a gift card, not furniture" });
    const result = await productMatchesCategoryLLM("sofa", "Amazon Gift Card", "gift_card");
    expect(result).toEqual({ ok: false, reason: "this is a gift card, not furniture" });
  });

  it("defaults a missing/non-string reason to an empty string", async () => {
    respondWith({ ok: true });
    const result = await productMatchesCategoryLLM("sofa", "a settee", "settee");
    expect(result).toEqual({ ok: true, reason: "" });
  });

  it("returns null when the model omits a boolean ok field", async () => {
    respondWith({ reason: "unclear" });
    expect(await productMatchesCategoryLLM("sofa", "something", "something")).toBeNull();
  });
});

describe("summarizePreferencesLLM — cross-room preference synthesis", () => {
  const baseInput = {
    keep_items: ["walnut credenza"],
    replace_items: ["old futon"],
    materials: ["oak", "linen"],
    palette: ["cream", "sage"],
    style_notes: ["warm minimal"],
    priorities: ["comfort"],
    user_context_snippets: ["I host often"],
    budget_modes: ["comfortable"],
    per_room_item_counts: [4, 6],
  };

  it("returns null without calling the model when there is no per-room data", async () => {
    const result = await summarizePreferencesLLM({ ...baseInput, per_room_item_counts: [] });
    expect(result).toBeNull();
    expect(chatMock).not.toHaveBeenCalled();
  });

  it("passes through valid density/budget labels and truncates the taste summary to 280 chars", async () => {
    respondWith({
      density_preference: "balanced",
      budget_pressure: "comfortable",
      taste_summary: "x".repeat(300),
    });
    const result = await summarizePreferencesLLM(baseInput);
    expect(result!.density_preference).toBe("balanced");
    expect(result!.budget_pressure).toBe("comfortable");
    expect(result!.taste_summary).toHaveLength(280);
  });

  it("falls back to 'unknown' for an out-of-vocabulary density or budget label", async () => {
    respondWith({ density_preference: "opulent", budget_pressure: "lavish", taste_summary: "notes" });
    const result = await summarizePreferencesLLM(baseInput);
    expect(result!.density_preference).toBe("unknown");
    expect(result!.budget_pressure).toBe("unknown");
  });

  it("defaults a missing/non-string taste_summary to an empty string", async () => {
    respondWith({ density_preference: "minimalist", budget_pressure: "tight" });
    const result = await summarizePreferencesLLM(baseInput);
    expect(result!.taste_summary).toBe("");
  });

  it("returns null when the provider call fails", async () => {
    chatMock.mockRejectedValue(new Error("boom"));
    expect(await summarizePreferencesLLM(baseInput)).toBeNull();
  });
});

describe("extractKeepCategoriesLLM — keep-item category + location extraction", () => {
  it("short-circuits to an empty array on an empty list", async () => {
    expect(await extractKeepCategoriesLLM([])).toEqual([]);
    expect(chatMock).not.toHaveBeenCalled();
  });

  it("normalizes category_keywords to lowercase, defaults a missing location_phrase to empty string", async () => {
    respondWith({
      items: [
        {
          item: "the black arc floor lamp behind the sofa",
          category_keywords: ["Floor Lamp", "ARC LAMP"],
          location_phrase: "behind the sofa",
        },
        { item: "walnut credenza", category_keywords: ["Credenza"] },
      ],
    });
    const result = await extractKeepCategoriesLLM([
      "the black arc floor lamp behind the sofa",
      "walnut credenza",
    ]);
    expect(result).toEqual([
      {
        item: "the black arc floor lamp behind the sofa",
        category_keywords: ["floor lamp", "arc lamp"],
        location_phrase: "behind the sofa",
      },
      { item: "walnut credenza", category_keywords: ["credenza"], location_phrase: "" },
    ]);
  });

  it("filters out entries missing a string item field", async () => {
    respondWith({ items: [{ category_keywords: ["sofa"] }, { item: "rug", category_keywords: [] }] });
    const result = await extractKeepCategoriesLLM(["rug"]);
    expect(result).toEqual([{ item: "rug", category_keywords: [], location_phrase: "" }]);
  });

  it("returns null when the model omits the items array", async () => {
    respondWith({});
    expect(await extractKeepCategoriesLLM(["sofa"])).toBeNull();
  });
});
