import { describe, it, expect, vi, beforeEach } from "vitest";
import { inferReplacementsFromGap, inferReplacementsFromPhotos } from "@/lib/agents/infer-replacements";

vi.mock("@/lib/ai/gemini", () => ({
  geminiProvider: { chat: vi.fn() },
}));

import { geminiProvider } from "@/lib/ai/gemini";

const mockChat = geminiProvider.chat as unknown as ReturnType<typeof vi.fn>;

describe("inferReplacementsFromGap", () => {
  it("infers a sofa replacement when Pass B buys a sofa, room has one, and user did not keep it", () => {
    const result = inferReplacementsFromGap(
      {
        summary: "Living room with a dark grey fabric sectional sofa and a glass coffee table.",
        design_direction: "Upgrade to a warmer, leather-forward palette.",
        what_works: [],
        what_should_go: [],
        what_it_needs: [
          { category: "sofa", search_title: "Cognac leather 84-inch track-arm sofa with walnut legs" },
        ],
      },
      ["bookshelf"],
    );
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe("sofa");
    expect(result[0].entry).toContain("Existing sofa");
    expect(result[0].entry).toContain("Cognac leather");
  });

  it("infers all three (sofa, coffee table, media console) for the user's exact scenario", () => {
    const result = inferReplacementsFromGap(
      {
        summary: "Open-concept living area with a grey sectional sofa, a small glass coffee table, and a low white media console with a TV.",
        what_works: ["bookshelf — kept per client request", "black arc floor lamp", "two lights and light stands"],
        what_should_go: [],
        what_it_needs: [
          { category: "sofa", search_title: "Cognac leather 84in sofa" },
          { category: "coffee_table", search_title: "Solid walnut 48in round coffee table" },
          { category: "media_console", search_title: "Matte black walnut media console 70in" },
          { category: "area_rug", search_title: "9x12 wool area rug" },
        ],
      },
      ["bookshelf", "black arc floor lamp", "two lights and light stands"],
    );
    const cats = result.map((r) => r.category).sort();
    expect(cats).toEqual(["coffee_table", "media_console", "sofa"]);
  });

  it("does NOT infer when the user keeps that category", () => {
    const result = inferReplacementsFromGap(
      {
        summary: "Living room with a grey sectional sofa.",
        what_works: [],
        what_should_go: [],
        what_it_needs: [{ category: "sofa", search_title: "New sofa" }],
      },
      ["sofa"],
    );
    expect(result).toHaveLength(0);
  });

  it("does NOT infer when the user keeps via a synonym (sectional)", () => {
    const result = inferReplacementsFromGap(
      {
        summary: "Living room with a sectional.",
        what_works: [],
        what_should_go: [],
        what_it_needs: [{ category: "sofa", search_title: "Replacement sofa" }],
      },
      ["my sectional"],
    );
    expect(result).toHaveLength(0);
  });

  it("does NOT infer when room context does not mention the category", () => {
    const result = inferReplacementsFromGap(
      {
        summary: "Empty bedroom with hardwood floors.",
        what_works: [],
        what_should_go: [],
        what_it_needs: [{ category: "sofa", search_title: "New sofa" }],
      },
      [],
    );
    expect(result).toHaveLength(0);
  });

  it("does NOT infer when the category is already represented in what_should_go", () => {
    const result = inferReplacementsFromGap(
      {
        summary: "Living room with a sectional sofa.",
        what_works: [],
        what_should_go: ["Old grey sectional — wrong scale"],
        what_it_needs: [{ category: "sofa", search_title: "New sofa" }],
      },
      [],
    );
    expect(result).toHaveLength(0);
  });

  it("does NOT infer when the category is already in what_works (user keeping it implicitly)", () => {
    const result = inferReplacementsFromGap(
      {
        summary: "Living room with a sectional sofa.",
        what_works: ["Grey sectional sofa — anchors the seating zone"],
        what_should_go: [],
        what_it_needs: [{ category: "sofa", search_title: "New sofa" }],
      },
      [],
    );
    expect(result).toHaveLength(0);
  });

  it("DOES infer sofa when 'sofa' only appears in a what_works entry's context, not its head", () => {
    const result = inferReplacementsFromGap(
      {
        summary: "Living room with a dark grey sectional sofa and a small coffee table.",
        what_works: [
          "bookshelf — kept per client request",
          "Generic black floor lamp — to be incorporated as ambient/arc lighting behind sofa",
          "black arc floor lamp — kept per client request",
        ],
        what_should_go: ["Generic black-metal TV console — undersized"],
        what_it_needs: [
          { category: "sofa", search_title: "Cream bouclé sectional 90in" },
          { category: "coffee_table", search_title: "Solid walnut round coffee table" },
        ],
      },
      ["bookshelf", "black arc floor lamp"],
    );
    const cats = result.map((r) => r.category).sort();
    expect(cats).toEqual(["coffee_table", "sofa"]);
  });

  it("returns empty when what_it_needs is missing or empty", () => {
    expect(inferReplacementsFromGap({ summary: "Anything" }, [])).toEqual([]);
    expect(inferReplacementsFromGap({ summary: "Anything", what_it_needs: [] }, [])).toEqual([]);
  });

  it("matches media_console aliases (tv stand, tv console, entertainment center)", () => {
    const result = inferReplacementsFromGap(
      {
        summary: "Living room with a low white TV stand against the east wall.",
        what_works: [],
        what_should_go: [],
        what_it_needs: [{ category: "media_console", search_title: "Walnut media console" }],
      },
      [],
    );
    expect(result).toHaveLength(1);
    expect(result[0].matchedAlias).toBe("tv stand");
  });

  it("preserves full search title in the entry text without truncation", () => {
    const longTitle = "A".repeat(120);
    const result = inferReplacementsFromGap(
      {
        summary: "Living room with a sectional.",
        what_works: [],
        what_should_go: [],
        what_it_needs: [{ category: "sofa", search_title: longTitle }],
      },
      [],
    );
    expect(result).toHaveLength(1);
    expect(result[0].entry).toContain(longTitle);
    expect(result[0].entry).not.toContain("...");
  });

  it("dedupes when Pass B has multiple needs in the same category", () => {
    const result = inferReplacementsFromGap(
      {
        summary: "Living room with a sectional.",
        what_works: [],
        what_should_go: [],
        what_it_needs: [
          { category: "sofa", search_title: "New leather sofa" },
          { category: "sofa", search_title: "Different sofa option" },
        ],
      },
      [],
    );
    expect(result).toHaveLength(1);
  });

  it("infers from what_should_go when summary is vague but items were flagged for removal", () => {
    const result = inferReplacementsFromGap(
      {
        summary: "Compact living room with disjointed rental furniture.",
        what_works: ["bookshelf — kept per client request"],
        what_should_go: ["Dark sectional sofa — overpowers the room", "Small glass coffee table — too fragile"],
        what_it_needs: [
          { category: "sofa", search_title: "Cognac leather sofa" },
          { category: "coffee_table", search_title: "Solid walnut coffee table" },
        ],
      },
      ["bookshelf"],
    );
    // sofa and coffee_table already appear in what_should_go, so no inference needed
    // (the aliases "sofa" and "coffee table" are found in removeText)
    expect(result).toHaveLength(0);
  });

  it("infers media console when only what_should_go mentions it (not summary)", () => {
    const result = inferReplacementsFromGap(
      {
        summary: "Compact living room with basic rental furniture.",
        what_works: [],
        what_should_go: [],
        spatial_layout: "TV mounted on the east wall, media console below",
        what_it_needs: [
          { category: "media_console", search_title: "Walnut media console 70in" },
        ],
      },
      [],
    );
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe("media_console");
  });

  it("does NOT infer for a category not in REPLACEABLE_CATEGORIES (e.g. throw_pillows)", () => {
    const result = inferReplacementsFromGap(
      {
        summary: "Living room with throw pillows everywhere.",
        what_works: [],
        what_should_go: [],
        what_it_needs: [{ category: "throw_pillows", search_title: "New pillow set" }],
      },
      [],
    );
    expect(result).toHaveLength(0);
  });
});

const PHOTOS = ["https://example.com/room1.jpg", "https://example.com/room2.jpg"];

function mockResponse(payload: object) {
  mockChat.mockResolvedValueOnce({
    content: JSON.stringify(payload),
    usage: { input_tokens: 0, output_tokens: 0, thinking_tokens: 0 },
  });
}

describe("inferReplacementsFromPhotos", () => {
  beforeEach(() => {
    mockChat.mockReset();
  });

  it("uses LLM verdicts to infer replacements for visible items only", async () => {
    mockResponse({
      verdicts: [
        { category: "sofa", existing_item_visible: true, existing_description: "dark grey fabric sectional", reason: "Visible against the back wall" },
        { category: "coffee_table", existing_item_visible: true, existing_description: "small glass coffee table", reason: "Between sofa and TV" },
        { category: "dining_table", existing_item_visible: false, existing_description: "", reason: "No dining table visible in the room" },
      ],
    });

    const result = await inferReplacementsFromPhotos(
      {
        summary: "Living room with rental furniture.",
        what_works: [],
        what_should_go: [],
        what_it_needs: [
          { category: "sofa", search_title: "Cognac leather 84-inch sofa" },
          { category: "coffee_table", search_title: "Solid walnut round coffee table" },
          { category: "dining_table", search_title: "Round walnut dining table" },
        ],
      },
      [],
      PHOTOS,
      "living_room",
    );

    expect(result).toHaveLength(2);
    const cats = result.map((r) => r.category).sort();
    expect(cats).toEqual(["coffee_table", "sofa"]);
    expect(result[0].entry).toContain("dark grey fabric sectional");
    expect(result[0].entry).toContain("Cognac leather 84-inch sofa");
    expect(result[0].entry).not.toContain("...");
  });

  it("does NOT infer when user keeps the category", async () => {
    const result = await inferReplacementsFromPhotos(
      {
        summary: "Living room.",
        what_works: [],
        what_should_go: [],
        what_it_needs: [{ category: "sofa", search_title: "New sofa" }],
      },
      ["my sectional"],
      PHOTOS,
      "living_room",
    );

    expect(mockChat).not.toHaveBeenCalled();
    expect(result).toHaveLength(0);
  });

  it("does NOT infer when category is already in what_should_go", async () => {
    const result = await inferReplacementsFromPhotos(
      {
        summary: "Living room.",
        what_works: [],
        what_should_go: ["Old grey sectional — wrong scale"],
        what_it_needs: [{ category: "sofa", search_title: "New sofa" }],
      },
      [],
      PHOTOS,
      "living_room",
    );

    expect(mockChat).not.toHaveBeenCalled();
    expect(result).toHaveLength(0);
  });

  it("falls back to deterministic when LLM returns invalid JSON", async () => {
    mockChat.mockResolvedValueOnce({
      content: "not json at all",
      usage: { input_tokens: 0, output_tokens: 0, thinking_tokens: 0 },
    });

    const result = await inferReplacementsFromPhotos(
      {
        summary: "Living room with a dark grey sectional sofa.",
        what_works: [],
        what_should_go: [],
        what_it_needs: [{ category: "sofa", search_title: "New sofa" }],
      },
      [],
      PHOTOS,
      "living_room",
    );

    expect(result).toHaveLength(1);
    expect(result[0].category).toBe("sofa");
  });

  it("falls back to deterministic when no photos are provided", async () => {
    const result = await inferReplacementsFromPhotos(
      {
        summary: "Living room with a sectional sofa.",
        what_works: [],
        what_should_go: [],
        what_it_needs: [{ category: "sofa", search_title: "New sofa" }],
      },
      [],
      [],
      "living_room",
    );

    expect(mockChat).not.toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe("sofa");
  });

  it("falls back to deterministic when LLM throws", async () => {
    mockChat.mockRejectedValueOnce(new Error("API timeout"));

    const result = await inferReplacementsFromPhotos(
      {
        summary: "Living room with a sofa.",
        what_works: [],
        what_should_go: [],
        what_it_needs: [{ category: "sofa", search_title: "New sofa" }],
      },
      [],
      PHOTOS,
      "living_room",
    );

    expect(result).toHaveLength(1);
    expect(result[0].category).toBe("sofa");
  });

  it("does NOT infer dining_chairs when LLM confirms they are not visible", async () => {
    mockResponse({
      verdicts: [
        { category: "sofa", existing_item_visible: true, existing_description: "grey fabric sectional", reason: "Centered in photo 1" },
        { category: "dining_chairs", existing_item_visible: false, existing_description: "", reason: "No dining chairs visible in the living room" },
      ],
    });

    const result = await inferReplacementsFromPhotos(
      {
        summary: "Living room with rental furniture.",
        what_works: [],
        what_should_go: [],
        what_it_needs: [
          { category: "sofa", search_title: "New leather sofa" },
          { category: "dining_chairs", search_title: "Set of 4 dining chairs" },
        ],
      },
      [],
      PHOTOS,
      "living_room",
    );

    expect(result).toHaveLength(1);
    expect(result[0].category).toBe("sofa");
  });

  it("skips non-replaceable categories without calling LLM", async () => {
    const result = await inferReplacementsFromPhotos(
      {
        summary: "Living room.",
        what_works: [],
        what_should_go: [],
        what_it_needs: [{ category: "throw_pillows", search_title: "New pillow set" }],
      },
      [],
      PHOTOS,
      "living_room",
    );

    expect(mockChat).not.toHaveBeenCalled();
    expect(result).toHaveLength(0);
  });
});
