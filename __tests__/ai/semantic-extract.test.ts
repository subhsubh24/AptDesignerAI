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
