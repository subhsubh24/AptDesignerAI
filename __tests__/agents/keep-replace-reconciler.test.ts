import { describe, it, expect, vi, beforeEach } from "vitest";

const mockChat = vi.fn();
vi.mock("@/lib/ai/provider-factory", () => ({
  getProvider: () => ({ chat: mockChat }),
}));

import { reconcileKeepReplace } from "@/lib/agents/keep-replace-reconciler";

function mockResponse(payload: object) {
  mockChat.mockResolvedValueOnce({
    content: JSON.stringify(payload),
    usage: { input_tokens: 0, output_tokens: 0, thinking_tokens: 0 },
  });
}

const baseInput = {
  summary: "A 14x14 living area with grey LVP and floor-to-ceiling windows. Contains a grey fabric sectional and a coffee table.",
  what_works: [
    "Grey fabric sectional — anchors the seating zone",
    "Wooden coffee table — warm tone balances grey floor",
  ],
  what_should_go: [
    "Black metal TV stand — undersized, cheap laminate finish",
    "Blue plastic storage bins — visual clutter",
  ],
  what_it_needs: [
    { category: "area_rug", search_title: "Wool area rug", priority: "high" },
    { category: "floor_lamp", search_title: "Arc floor lamp", priority: "medium" },
  ],
  keep_items: ["sectional"],
  room_type: "living_room",
};

describe("reconcileKeepReplace", () => {
  beforeEach(() => {
    mockChat.mockReset();
  });

  it("short-circuits without an LLM call when both lists are empty", async () => {
    const result = await reconcileKeepReplace({
      ...baseInput,
      what_works: [],
      what_should_go: [],
    });
    expect(mockChat).not.toHaveBeenCalled();
    expect(result.fellBack).toBe(false);
    expect(result.what_works).toEqual([]);
    expect(result.what_should_go).toEqual([]);
  });

  it("returns reconciler decisions when the LLM identifies a cross-reference hallucination", async () => {
    mockResponse({
      what_works: baseInput.what_works,
      what_should_go: ["Black metal TV stand — undersized, cheap laminate finish"],
      decisions: ["dropped 'Blue plastic storage bins' — abstract clutter not anchored"],
    });
    const result = await reconcileKeepReplace(baseInput);
    expect(result.fellBack).toBe(false);
    expect(result.what_should_go).toHaveLength(1);
    expect(result.what_should_go[0]).toContain("TV stand");
    expect(result.decisions).toHaveLength(1);
  });

  it("falls back when LLM output is invalid JSON", async () => {
    mockChat.mockResolvedValueOnce({
      content: "not json at all",
      usage: { input_tokens: 0, output_tokens: 0, thinking_tokens: 0 },
    });
    const result = await reconcileKeepReplace(baseInput);
    expect(result.fellBack).toBe(true);
    expect(result.what_works).toEqual(baseInput.what_works);
    expect(result.what_should_go).toEqual(baseInput.what_should_go);
  });

  it("falls back when LLM throws", async () => {
    mockChat.mockRejectedValueOnce(new Error("network"));
    const result = await reconcileKeepReplace(baseInput);
    expect(result.fellBack).toBe(true);
    expect(result.what_works).toEqual(baseInput.what_works);
    expect(result.what_should_go).toEqual(baseInput.what_should_go);
  });

  it("rejects invented entries — strips entries not present in input", async () => {
    mockResponse({
      what_works: [
        ...baseInput.what_works,
        "Brass floor lamp — newly invented entry not in input",
      ],
      what_should_go: baseInput.what_should_go,
      decisions: ["added a new item"],
    });
    const result = await reconcileKeepReplace(baseInput);
    expect(result.what_works).toHaveLength(2);
    expect(result.what_works).not.toContainEqual(
      expect.stringContaining("invented"),
    );
  });

  it("falls back when the LLM tries to delete ALL what_should_go entries", async () => {
    mockResponse({
      what_works: baseInput.what_works,
      what_should_go: [],
      decisions: ["deleted everything"],
    });
    const result = await reconcileKeepReplace(baseInput);
    expect(result.fellBack).toBe(true);
    expect(result.what_should_go).toEqual(baseInput.what_should_go);
  });

  it("falls back when the LLM tries to delete ALL what_works entries", async () => {
    mockResponse({
      what_works: [],
      what_should_go: baseInput.what_should_go,
      decisions: ["deleted everything"],
    });
    const result = await reconcileKeepReplace(baseInput);
    expect(result.fellBack).toBe(true);
    expect(result.what_works).toEqual(baseInput.what_works);
  });

  it("allows moving an item from what_should_go to what_works (user-keep conflict)", async () => {
    // Sectional is a user keep item but Pass A put it in what_should_go.
    // Reconciler moves it to what_works.
    const input = {
      ...baseInput,
      what_works: ["Wooden coffee table — warm tone"],
      what_should_go: [
        "Grey fabric sectional — looks tired",
        "Black metal TV stand — undersized",
      ],
      keep_items: ["grey fabric sectional"],
    };
    mockResponse({
      what_works: [
        "Wooden coffee table — warm tone",
        "Grey fabric sectional — looks tired",
      ],
      what_should_go: ["Black metal TV stand — undersized"],
      decisions: ["moved sectional to what_works (user keep)"],
    });
    const result = await reconcileKeepReplace(input);
    expect(result.fellBack).toBe(false);
    expect(result.what_works).toHaveLength(2);
    expect(result.what_should_go).toHaveLength(1);
  });

  it("returns clean decisions array even when LLM omits it", async () => {
    mockResponse({
      what_works: baseInput.what_works,
      what_should_go: baseInput.what_should_go,
    });
    const result = await reconcileKeepReplace(baseInput);
    expect(result.fellBack).toBe(false);
    expect(result.decisions).toEqual([]);
  });

  it("preserves entries verbatim — does not edit text", async () => {
    mockResponse({
      what_works: ["Grey fabric sectional — anchors the seating zone"],
      what_should_go: ["Black metal TV stand — undersized, cheap laminate finish"],
      decisions: ["dropped one from each"],
    });
    const result = await reconcileKeepReplace(baseInput);
    expect(result.what_works[0]).toBe("Grey fabric sectional — anchors the seating zone");
    expect(result.what_should_go[0]).toBe("Black metal TV stand — undersized, cheap laminate finish");
  });
});
