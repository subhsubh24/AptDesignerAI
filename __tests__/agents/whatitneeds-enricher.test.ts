import { describe, it, expect, vi, beforeEach } from "vitest";

// enrichWhatItNeeds makes a single batched geminiProvider.chat call; mock it so
// we exercise the vague-detection / patch-by-index / fail-open branches without
// a real model call. hasSpecificity is pure and needs no mocking.
vi.mock("@/lib/ai/gemini", () => ({
  geminiProvider: { chat: vi.fn() },
}));

import { hasSpecificity, enrichWhatItNeeds } from "@/lib/agents/whatitneeds-enricher";
import { geminiProvider } from "@/lib/ai/gemini";
import type { DiagnosisItem } from "@/lib/agents/types";

const mockChat = geminiProvider.chat as unknown as ReturnType<typeof vi.fn>;

function item(overrides: Partial<DiagnosisItem> = {}): DiagnosisItem {
  return { category: "coffee_table", ...overrides };
}

function chatResponse(content: string) {
  return {
    content,
    usage: { input_tokens: 10, output_tokens: 20, thinking_tokens: 0 },
    model: "gemini-test",
  };
}

describe("hasSpecificity", () => {
  it("is true only when BOTH a dimension signal and a material keyword are present", () => {
    expect(hasSpecificity(item({ search_title: "Solid walnut round coffee table 36 inch diameter" }))).toBe(true);
  });

  it("is false with a dimension but no material", () => {
    expect(hasSpecificity(item({ search_title: "Round coffee table 36 inch diameter" }))).toBe(false);
  });

  it("is false with a material but no dimension", () => {
    expect(hasSpecificity(item({ search_title: "Solid walnut round coffee table" }))).toBe(false);
  });

  it("is false when neither signal is present", () => {
    expect(hasSpecificity(item({ search_title: "Coffee table" }))).toBe(false);
  });

  it("is false for an item with no search_title or specs", () => {
    expect(hasSpecificity(item())).toBe(false);
  });

  it("combines search_title and specs when scoring", () => {
    // material in search_title, dimension in specs — together they qualify.
    expect(
      hasSpecificity(item({ search_title: "walnut coffee table", specs: "36x36x17 inch" })),
    ).toBe(true);
  });

  it("recognizes common dimension formats", () => {
    expect(hasSpecificity(item({ search_title: "wool area rug 8x10 ft" }))).toBe(true);
    expect(hasSpecificity(item({ search_title: "oak dining table 84 inch wide" }))).toBe(true);
    expect(hasSpecificity(item({ search_title: "linen sofa 96 in deep" }))).toBe(true);
  });
});

describe("enrichWhatItNeeds", () => {
  beforeEach(() => {
    mockChat.mockReset();
  });

  const ctx = { roomType: "living_room", pass1Brief: "{}" };

  it("returns items untouched and makes no model call when all items are specific", async () => {
    const items = [item({ search_title: "Solid walnut round coffee table 36 inch diameter" })];
    const result = await enrichWhatItNeeds(items, ctx);

    expect(result).toEqual(items);
    expect(mockChat).not.toHaveBeenCalled();
  });

  it("does not enrich skip-list decorative categories even when vague", async () => {
    const items = [item({ category: "throw_pillows", search_title: "pillows" })];
    const result = await enrichWhatItNeeds(items, ctx);

    expect(result).toEqual(items);
    expect(mockChat).not.toHaveBeenCalled();
  });

  it("enriches vague items and applies the model's patch by index", async () => {
    const items = [
      item({ category: "coffee_table", search_title: "coffee table" }),
      item({ category: "area_rug", search_title: "rug" }),
    ];
    mockChat.mockResolvedValue(
      chatResponse(
        JSON.stringify([
          {
            index: 0,
            category: "coffee_table",
            search_title: "Solid walnut round coffee table 36 inch diameter",
            specs: "36 x 36 x 17 inch, solid walnut, ~$499",
          },
          {
            index: 1,
            category: "area_rug",
            search_title: "Hand-knotted wool area rug 8x10 ft in warm cream",
            specs: "8 x 10 ft, wool, ~$899",
          },
        ]),
      ),
    );

    const result = await enrichWhatItNeeds(items, ctx);

    expect(mockChat).toHaveBeenCalledTimes(1);
    expect(result[0].search_title).toBe("Solid walnut round coffee table 36 inch diameter");
    expect(result[1].search_title).toBe("Hand-knotted wool area rug 8x10 ft in warm cream");
    // Original category is preserved (we only patch search_title/specs).
    expect(result[0].category).toBe("coffee_table");
  });

  it("returns the original items unchanged when the model call rejects (fail-open)", async () => {
    const items = [item({ category: "coffee_table", search_title: "coffee table" })];
    mockChat.mockRejectedValue(new Error("model down"));

    const result = await enrichWhatItNeeds(items, ctx);

    expect(result).toEqual(items);
  });

  it("returns the original items when the response is not an array", async () => {
    const items = [item({ category: "coffee_table", search_title: "coffee table" })];
    mockChat.mockResolvedValue(chatResponse(JSON.stringify({ not: "an array" })));

    const result = await enrichWhatItNeeds(items, ctx);

    expect(result).toEqual(items);
  });
});
