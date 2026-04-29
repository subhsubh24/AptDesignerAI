import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/ai/gemini", () => ({
  geminiProvider: { chat: vi.fn() },
}));

import { verifyWhatShouldGoAgainstPhotos } from "@/lib/agents/photo-grounding-validator";
import { geminiProvider } from "@/lib/ai/gemini";

const mockChat = geminiProvider.chat as unknown as ReturnType<typeof vi.fn>;

function mockResponse(payload: object) {
  mockChat.mockResolvedValueOnce({
    content: JSON.stringify(payload),
    usage: { input_tokens: 0, output_tokens: 0, thinking_tokens: 0 },
  });
}

const PHOTOS = ["https://example.com/room1.jpg", "https://example.com/room2.jpg"];

describe("verifyWhatShouldGoAgainstPhotos", () => {
  beforeEach(() => {
    mockChat.mockReset();
  });

  it("short-circuits without an LLM call when the list is empty", async () => {
    const result = await verifyWhatShouldGoAgainstPhotos([], PHOTOS, "living_room");
    expect(mockChat).not.toHaveBeenCalled();
    expect(result.what_should_go).toEqual([]);
    expect(result.dropped).toEqual([]);
    expect(result.fellBack).toBe(false);
  });

  it("short-circuits when no photo URLs are provided", async () => {
    const result = await verifyWhatShouldGoAgainstPhotos(
      ["Sectional sofa — wrong scale"],
      [],
      "living_room",
    );
    expect(mockChat).not.toHaveBeenCalled();
    expect(result.what_should_go).toEqual(["Sectional sofa — wrong scale"]);
    expect(result.fellBack).toBe(false);
  });

  it("drops entries the LLM cannot locate in the photos", async () => {
    const input = [
      "Dark charcoal sectional sofa — too heavy",
      "Mismatched metal dining chairs — cold and industrial",
      "Plastic storage bins under the console — visual clutter",
    ];
    mockResponse({
      verdicts: [
        { entry: input[0], visible: true, reason: "Visible against the back wall in photo 1" },
        { entry: input[1], visible: false, reason: "No dining chairs are visible in any photo" },
        { entry: input[2], visible: false, reason: "No plastic storage bins are visible under the console" },
      ],
    });
    const result = await verifyWhatShouldGoAgainstPhotos(input, PHOTOS, "living_room");
    expect(result.fellBack).toBe(false);
    expect(result.what_should_go).toEqual([input[0]]);
    expect(result.dropped).toHaveLength(2);
    expect(result.dropped[0].entry).toBe(input[1]);
    expect(result.dropped[1].entry).toBe(input[2]);
  });

  it("keeps all entries when the LLM marks them all visible", async () => {
    const input = ["Sofa — too small", "Coffee table — wrong material"];
    mockResponse({
      verdicts: [
        { entry: input[0], visible: true, reason: "centered in photo" },
        { entry: input[1], visible: true, reason: "between sofa and TV" },
      ],
    });
    const result = await verifyWhatShouldGoAgainstPhotos(input, PHOTOS, "living_room");
    expect(result.fellBack).toBe(false);
    expect(result.what_should_go).toEqual(input);
    expect(result.dropped).toEqual([]);
  });

  it("falls open and keeps everything when the LLM returns invalid JSON", async () => {
    mockChat.mockResolvedValueOnce({
      content: "not json at all",
      usage: { input_tokens: 0, output_tokens: 0, thinking_tokens: 0 },
    });
    const input = ["Sofa — too small"];
    const result = await verifyWhatShouldGoAgainstPhotos(input, PHOTOS, "living_room");
    expect(result.fellBack).toBe(true);
    expect(result.what_should_go).toEqual(input);
  });

  it("falls open when the LLM throws", async () => {
    mockChat.mockRejectedValueOnce(new Error("API timeout"));
    const input = ["Sofa — too small"];
    const result = await verifyWhatShouldGoAgainstPhotos(input, PHOTOS, "living_room");
    expect(result.fellBack).toBe(true);
    expect(result.what_should_go).toEqual(input);
  });

  it("refuses to drop ALL entries (likely LLM misread) and falls back", async () => {
    const input = ["Sofa", "Coffee table", "TV stand"];
    mockResponse({
      verdicts: [
        { entry: "Sofa", visible: false, reason: "?" },
        { entry: "Coffee table", visible: false, reason: "?" },
        { entry: "TV stand", visible: false, reason: "?" },
      ],
    });
    const result = await verifyWhatShouldGoAgainstPhotos(input, PHOTOS, "living_room");
    expect(result.fellBack).toBe(true);
    expect(result.what_should_go).toEqual(input);
  });

  it("defaults to keeping entries with no matching verdict (conservative)", async () => {
    const input = ["Sofa", "Coffee table"];
    // LLM only returned a verdict for one entry — the other should be kept by default.
    mockResponse({
      verdicts: [
        { entry: "Sofa", visible: true, reason: "centered in photo" },
      ],
    });
    const result = await verifyWhatShouldGoAgainstPhotos(input, PHOTOS, "living_room");
    expect(result.fellBack).toBe(false);
    expect(result.what_should_go).toEqual(input);
    expect(result.dropped).toEqual([]);
  });

  it("preserves original entry ordering for kept items", async () => {
    const input = ["A", "B", "C", "D"];
    mockResponse({
      verdicts: [
        { entry: "B", visible: false, reason: "not visible" },
        { entry: "D", visible: false, reason: "not visible" },
        { entry: "A", visible: true, reason: "ok" },
        { entry: "C", visible: true, reason: "ok" },
      ],
    });
    const result = await verifyWhatShouldGoAgainstPhotos(input, PHOTOS, "living_room");
    expect(result.what_should_go).toEqual(["A", "C"]);
  });

  it("sends one image content block per photo URL", async () => {
    mockResponse({
      verdicts: [{ entry: "Sofa", visible: true, reason: "ok" }],
    });
    await verifyWhatShouldGoAgainstPhotos(["Sofa"], PHOTOS, "living_room");
    const call = mockChat.mock.calls[0][0];
    const content = call.messages[0].content as Array<{ type: string }>;
    const imageBlocks = content.filter((c) => c.type === "image");
    expect(imageBlocks).toHaveLength(PHOTOS.length);
  });
});
