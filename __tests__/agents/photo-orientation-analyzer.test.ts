import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock geminiProvider before importing the analyzer ──────────────────────
const { mockChat } = vi.hoisted(() => ({ mockChat: vi.fn() }));
vi.mock("@/lib/ai/gemini", () => ({
  geminiProvider: { chat: mockChat },
}));
vi.mock("@/lib/ai/models", () => ({
  selectModel: () => "gemini-test-model",
}));

import {
  analyzePhotoOrientations,
  formatOrientationSummary,
} from "@/lib/agents/photo-orientation-analyzer";

describe("analyzePhotoOrientations", () => {
  beforeEach(() => {
    mockChat.mockReset();
  });

  it("returns empty array when no photos are provided", async () => {
    const result = await analyzePhotoOrientations([], "living_room");
    expect(result).toEqual([]);
    expect(mockChat).not.toHaveBeenCalled();
  });

  it("parses a well-formed analyzer response into normalized orientations", async () => {
    mockChat.mockResolvedValueOnce({
      content: JSON.stringify({
        photos: [
          {
            index: 1,
            camera_position: "from the doorway",
            facing: "window wall",
            visible_features: ["two windows on far wall", "radiator on right"],
            light_direction: "from ahead (backlit)",
            caption: "Entry view looking toward window wall.",
          },
          {
            index: 2,
            camera_position: "from the opposite corner",
            facing: "entry wall",
            visible_features: ["doorway on left", "closet on right"],
            light_direction: "from behind",
            caption: "Corner view looking back at entry.",
          },
        ],
      }),
    });

    const result = await analyzePhotoOrientations(
      ["https://example.com/a.jpg", "https://example.com/b.jpg"],
      "living_room",
    );

    expect(result).toHaveLength(2);
    expect(result[0].index).toBe(1);
    expect(result[0].facing).toBe("window wall");
    expect(result[0].visible_features).toHaveLength(2);
    expect(result[1].camera_position).toBe("from the opposite corner");
  });

  it("caps analysis at MAX_ANALYZED_PHOTOS (6)", async () => {
    mockChat.mockResolvedValueOnce({
      content: JSON.stringify({
        photos: Array.from({ length: 10 }, (_, i) => ({
          index: i + 1,
          camera_position: `pos ${i}`,
          facing: "wall",
          visible_features: [],
          light_direction: "from left",
          caption: `shot ${i}`,
        })),
      }),
    });

    const urls = Array.from({ length: 10 }, (_, i) => `https://example.com/${i}.jpg`);
    const result = await analyzePhotoOrientations(urls, "bedroom");
    expect(result.length).toBeLessThanOrEqual(6);
  });

  it("falls back to empty array when LLM throws", async () => {
    mockChat.mockRejectedValueOnce(new Error("network fail"));
    const result = await analyzePhotoOrientations(
      ["https://example.com/a.jpg"],
      "living_room",
    );
    expect(result).toEqual([]);
  });

  it("falls back to empty array when response has no photos array", async () => {
    mockChat.mockResolvedValueOnce({
      content: JSON.stringify({ unexpected: "shape" }),
    });
    const result = await analyzePhotoOrientations(
      ["https://example.com/a.jpg"],
      "living_room",
    );
    expect(result).toEqual([]);
  });

  it("normalizes missing index to array position and fills missing strings", async () => {
    mockChat.mockResolvedValueOnce({
      content: JSON.stringify({
        photos: [
          {
            // no index, no camera_position
            facing: "window wall",
            caption: "first shot",
          },
        ],
      }),
    });
    const result = await analyzePhotoOrientations(
      ["https://example.com/a.jpg"],
      "kitchen",
    );
    expect(result[0].index).toBe(1);
    expect(result[0].camera_position).toBe("unspecified");
    expect(result[0].light_direction).toBe("unspecified");
    expect(result[0].visible_features).toEqual([]);
    expect(result[0].caption).toBe("first shot");
  });

  it("passes room_type into the prompt for context", async () => {
    mockChat.mockResolvedValueOnce({
      content: JSON.stringify({ photos: [] }),
    });
    await analyzePhotoOrientations(["https://example.com/a.jpg"], "home_office");
    const call = mockChat.mock.calls[0][0];
    const messageContent = call.messages[0].content;
    const textBlocks = Array.isArray(messageContent)
      ? messageContent.filter((b: { type: string }) => b.type === "text")
      : [];
    const allText = textBlocks.map((b: { text: string }) => b.text).join(" ");
    expect(allText).toContain("home_office");
  });

  it("includes room dimensions hint when provided", async () => {
    mockChat.mockResolvedValueOnce({
      content: JSON.stringify({ photos: [] }),
    });
    await analyzePhotoOrientations(
      ["https://example.com/a.jpg"],
      "bedroom",
      "12 × 14 ft",
    );
    const call = mockChat.mock.calls[0][0];
    const messageContent = call.messages[0].content;
    const textBlocks = Array.isArray(messageContent)
      ? messageContent.filter((b: { type: string }) => b.type === "text")
      : [];
    const allText = textBlocks.map((b: { text: string }) => b.text).join(" ");
    expect(allText).toContain("12 × 14 ft");
  });
});

describe("formatOrientationSummary", () => {
  it("returns empty string for empty input", () => {
    expect(formatOrientationSummary([])).toBe("");
  });

  it("formats a multi-photo summary with indexed bullets", () => {
    const summary = formatOrientationSummary([
      {
        index: 1,
        camera_position: "from doorway",
        facing: "window wall",
        visible_features: ["two windows"],
        light_direction: "from ahead",
        caption: "entry view",
      },
      {
        index: 2,
        camera_position: "from opposite corner",
        facing: "entry wall",
        visible_features: [],
        light_direction: "from behind",
        caption: "corner view",
      },
    ]);
    expect(summary).toContain("Photo 1");
    expect(summary).toContain("Photo 2");
    expect(summary).toContain("window wall");
    expect(summary).toContain("entry wall");
    // The closing instruction keeps the model from mirror-flipping the layout
    expect(summary).toContain("Do not flip");
  });

  it("omits features line when feature list is empty", () => {
    const summary = formatOrientationSummary([
      {
        index: 1,
        camera_position: "from doorway",
        facing: "window wall",
        visible_features: [],
        light_direction: "from ahead",
        caption: "entry",
      },
    ]);
    // Should not have a trailing "; " before the period when features empty
    expect(summary).not.toMatch(/ — \./);
  });
});
