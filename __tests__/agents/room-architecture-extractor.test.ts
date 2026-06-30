import { describe, it, expect, vi, beforeEach } from "vitest";

// extractRoomArchitecture runs a single vision call through geminiProvider.chat,
// then extractJsonObject + a shape check (wall_color must be a string). Mock the
// provider so we drive the empty-input / success / parse-fail / shape-fail /
// throw branches and assert the determinism contract without a real model call.
vi.mock("@/lib/ai/gemini", () => ({
  geminiProvider: { chat: vi.fn() },
}));

import {
  extractRoomArchitecture,
  formatArchitectureForPrompt,
  type RoomArchitecture,
} from "@/lib/agents/room-architecture-extractor";
import { geminiProvider } from "@/lib/ai/gemini";
import { DETERMINISTIC_SEED } from "@/lib/ai/determinism";

const mockChat = geminiProvider.chat as unknown as ReturnType<typeof vi.fn>;

function chatResponse(content: string) {
  return {
    content,
    usage: { input_tokens: 80, output_tokens: 40, thinking_tokens: 5 },
    model: "gemini-test",
  };
}

function fullArchitecture(overrides: Partial<RoomArchitecture> = {}): RoomArchitecture {
  return {
    floor_material: "hardwood",
    floor_color: "warm honey/medium oak",
    floor_plank_or_tile: "~4 inch planks running east-west",
    floor_sheen: "satin",
    wall_color: "warm off-white with greige undertone",
    wall_finish: "flat matte paint",
    accent_wall: "none",
    ceiling_height: "~9 feet",
    ceiling_color: "white",
    ceiling_features: "flat, no molding",
    window_count: 2,
    window_descriptions: ["south wall: two double-hung windows ~5ft wide, white wood frames"],
    dominant_light_direction: "strong southwest afternoon light",
    door_descriptions: ["north wall: solid panel entry door, white painted"],
    built_ins: [],
    baseboards: "white painted wood, ~4 inch",
    crown_molding: "none",
    other_features: [],
    room_shape_notes: "rectangular, ~12×18 ft",
    ...overrides,
  };
}

const PHOTOS = ["https://example.com/room-1.jpg", "https://example.com/room-2.jpg"];

beforeEach(() => {
  mockChat.mockReset();
});

describe("extractRoomArchitecture", () => {
  it("returns null without calling the model when there are no photos", async () => {
    expect(await extractRoomArchitecture([], "living_room")).toBeNull();
    expect(mockChat).not.toHaveBeenCalled();
  });

  it("parses a well-formed vision response into structured architecture", async () => {
    const arch = fullArchitecture();
    mockChat.mockResolvedValue(chatResponse(JSON.stringify(arch)));

    const result = await extractRoomArchitecture(PHOTOS, "living_room");

    expect(result).not.toBeNull();
    expect(result?.wall_color).toBe("warm off-white with greige undertone");
    expect(result?.window_count).toBe(2);
    expect(mockChat).toHaveBeenCalledTimes(1);
  });

  it("passes the deterministic seed + cheap thinking to the model", async () => {
    mockChat.mockResolvedValue(chatResponse(JSON.stringify(fullArchitecture())));

    await extractRoomArchitecture(PHOTOS, "bedroom");

    const callArg = mockChat.mock.calls[0][0];
    expect(callArg).toHaveProperty("seed", DETERMINISTIC_SEED);
    expect(callArg.thinkingConfig).toEqual({ thinkingLevel: "low" });
  });

  it("caps the vision input at 4 photos", async () => {
    mockChat.mockResolvedValue(chatResponse(JSON.stringify(fullArchitecture())));
    const sixPhotos = Array.from({ length: 6 }, (_, i) => `https://example.com/p${i}.jpg`);

    await extractRoomArchitecture(sixPhotos, "living_room");

    const content = mockChat.mock.calls[0][0].messages[0].content as Array<{ type: string }>;
    const imageBlocks = content.filter((c) => c.type === "image");
    expect(imageBlocks).toHaveLength(4);
  });

  it("includes the floor plan as an extra image when provided", async () => {
    mockChat.mockResolvedValue(chatResponse(JSON.stringify(fullArchitecture())));

    await extractRoomArchitecture(["https://example.com/room.jpg"], "living_room", "https://example.com/floorplan.png");

    const content = mockChat.mock.calls[0][0].messages[0].content as Array<{ type: string }>;
    // 1 room photo + 1 floor plan = 2 image blocks
    expect(content.filter((c) => c.type === "image")).toHaveLength(2);
  });

  it("returns null (fail-open) when the response is not valid JSON", async () => {
    mockChat.mockResolvedValue(chatResponse("the room has nice walls"));
    expect(await extractRoomArchitecture(PHOTOS, "living_room")).toBeNull();
  });

  it("returns null when the parsed object is missing the required wall_color string", async () => {
    // window_count present but wall_color absent → shape check rejects it.
    mockChat.mockResolvedValue(chatResponse(JSON.stringify({ floor_material: "tile", window_count: 1 })));
    expect(await extractRoomArchitecture(PHOTOS, "living_room")).toBeNull();
  });

  it("returns null (fail-open) when the model call throws", async () => {
    mockChat.mockRejectedValue(new Error("gemini timeout"));
    expect(await extractRoomArchitecture(PHOTOS, "living_room")).toBeNull();
  });
});

describe("formatArchitectureForPrompt", () => {
  it("renders core surfaces and omits 'none' accent walls / crown molding", () => {
    const out = formatArchitectureForPrompt(fullArchitecture());
    expect(out).toContain("Floor: hardwood, warm honey/medium oak");
    expect(out).toContain("Walls: warm off-white with greige undertone");
    expect(out).not.toContain("Accent wall:");
    expect(out).not.toContain("Crown molding:");
    expect(out).toContain("CRITICAL: Do NOT change any architectural feature");
  });

  it("includes an accent wall and crown molding when present", () => {
    const out = formatArchitectureForPrompt(
      fullArchitecture({ accent_wall: "north wall: exposed brick", crown_molding: "simple 3-inch white cove molding" }),
    );
    expect(out).toContain("Accent wall: north wall: exposed brick");
    expect(out).toContain("Crown molding: simple 3-inch white cove molding");
  });

  it("lists each window when window_count > 0 and skips the block when zero", () => {
    const withWindows = formatArchitectureForPrompt(fullArchitecture());
    expect(withWindows).toContain("Windows: 2 total");
    expect(withWindows).toContain("south wall: two double-hung windows");

    const noWindows = formatArchitectureForPrompt(
      fullArchitecture({ window_count: 0, window_descriptions: [] }),
    );
    expect(noWindows).not.toContain("Windows:");
  });
});
