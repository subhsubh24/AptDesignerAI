import { describe, it, expect, vi, beforeEach } from "vitest";

// runFloorPlanExtraction resolves the image, makes one geminiProvider.chat call,
// then normalizes a loosely-typed LLM response into a strict ExtractedFloorPlan.
// Mock the provider + image resolver so we exercise the normalization/coercion
// branches, the unexpected-shape + error fail-open, and the determinism contract.
vi.mock("@/lib/ai/gemini", () => ({
  geminiProvider: { chat: vi.fn() },
}));
vi.mock("@/lib/ai/resolve-image", () => ({
  resolveImageBlock: vi.fn(),
}));

import { runFloorPlanExtraction } from "@/lib/agents/floor-plan-extractor";
import { geminiProvider } from "@/lib/ai/gemini";
import { resolveImageBlock } from "@/lib/ai/resolve-image";
import { DETERMINISTIC_SEED } from "@/lib/ai/determinism";
import { thinkingFor } from "@/lib/ai/thinking";

const mockChat = geminiProvider.chat as unknown as ReturnType<typeof vi.fn>;
const mockResolve = resolveImageBlock as unknown as ReturnType<typeof vi.fn>;

const IMG = "https://cdn/plan.png";

function chatResponse(raw: unknown) {
  return {
    content: JSON.stringify(raw),
    usage: { input_tokens: 200, output_tokens: 80, thinking_tokens: 20 },
    model: "gemini-floorplan",
  };
}

describe("runFloorPlanExtraction", () => {
  beforeEach(() => {
    mockChat.mockReset();
    mockResolve.mockReset();
    mockResolve.mockResolvedValue({ type: "image", source: { type: "url", url: IMG } });
  });

  it("normalizes a well-formed plan and reports tokens + model", async () => {
    mockChat.mockResolvedValue(
      chatResponse({
        confidence: "high",
        total_sqft: "850",
        rooms: [
          {
            room_type: "living_room",
            label: "Great Room",
            sqft: "320",
            shape: "L-shaped",
            natural_light: "high",
            walls: [
              {
                direction: "north",
                length_ft: "16",
                features: [{ type: "window", position_on_wall: "center", width_ft: "4" }],
              },
            ],
          },
        ],
      }),
    );

    const result = await runFloorPlanExtraction(IMG);

    expect(result.success).toBe(true);
    if (!result.success || !result.data) throw new Error("expected success");
    expect(result.data.image_url).toBe(IMG);
    expect(result.data.confidence).toBe("high");
    expect(result.data.total_sqft).toBe(850);
    expect(result.data.rooms).toHaveLength(1);
    const room = result.data.rooms[0];
    expect(room).toMatchObject({ room_type: "living_room", shape: "L-shaped", natural_light: "high", sqft: 320 });
    expect(room.walls[0]).toMatchObject({ direction: "north", length_ft: 16 });
    expect(room.walls[0].features[0]).toMatchObject({ type: "window", position_on_wall: "center", width_ft: 4 });
    expect(result.tokensUsed).toBe(300); // 200 + 80 + 20
    expect(result.model).toBe("gemini-floorplan");
  });

  it("coerces invalid enums to safe defaults and bad numbers to undefined", async () => {
    mockChat.mockResolvedValue(
      chatResponse({
        confidence: "wild-guess", // invalid → "low"
        total_sqft: "not-a-number", // → undefined
        rooms: [
          {
            room_type: "dungeon", // invalid → "other"
            sqft: "abc", // → undefined
            shape: "blob", // invalid → "rectangular"
            natural_light: "blinding", // invalid → "medium"
            walls: [
              {
                // no direction → "wall_1"
                features: [{ type: "portal", position_on_wall: "ceiling" }], // → window / center
              },
            ],
          },
        ],
      }),
    );

    const result = await runFloorPlanExtraction(IMG);

    expect(result.success).toBe(true);
    if (!result.success || !result.data) throw new Error("expected success");
    expect(result.data.confidence).toBe("low");
    expect(result.data.total_sqft).toBeUndefined();
    const room = result.data.rooms[0];
    expect(room.room_type).toBe("other");
    expect(room.sqft).toBeUndefined();
    expect(room.shape).toBe("rectangular");
    expect(room.natural_light).toBe("medium");
    expect(room.walls[0].direction).toBe("wall_1");
    expect(room.walls[0].features[0].type).toBe("window");
    expect(room.walls[0].features[0].position_on_wall).toBe("center");
  });

  it("defaults missing room walls/label and tolerates an empty rooms array", async () => {
    mockChat.mockResolvedValue(chatResponse({ rooms: [{ room_type: "kitchen" }] }));

    const result = await runFloorPlanExtraction(IMG);

    expect(result.success).toBe(true);
    if (!result.success || !result.data) throw new Error("expected success");
    const room = result.data.rooms[0];
    expect(room.label).toBe("kitchen"); // falls back to room_type
    expect(room.walls).toEqual([]);
  });

  it("passes the deterministic seed, JSON mime, and the diagnosis thinking config, and resolves via Files API", async () => {
    mockChat.mockResolvedValue(chatResponse({ rooms: [] }));

    await runFloorPlanExtraction(IMG, "developer PDF, 2BR");

    expect(mockResolve).toHaveBeenCalledWith(IMG, { preferFilesApi: true });
    const arg = mockChat.mock.calls[0][0] as {
      seed?: number;
      responseMimeType?: string;
      thinkingConfig?: unknown;
    };
    expect(arg.seed).toBe(DETERMINISTIC_SEED);
    expect(arg.responseMimeType).toBe("application/json");
    expect(arg.thinkingConfig).toEqual(thinkingFor("diagnosis"));
  });

  it("fails (not throws) when the response has no rooms array", async () => {
    mockChat.mockResolvedValue(chatResponse({ confidence: "high" })); // no rooms

    const result = await runFloorPlanExtraction(IMG);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/unexpected shape/i);
  });

  it("fails open when image resolution throws", async () => {
    mockResolve.mockRejectedValue(new Error("file upload failed"));

    const result = await runFloorPlanExtraction(IMG);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/file upload failed/i);
    expect(mockChat).not.toHaveBeenCalled();
  });

  it("fails open when the LLM call throws", async () => {
    mockChat.mockRejectedValue(new Error("model unavailable"));

    const result = await runFloorPlanExtraction(IMG);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/model unavailable/i);
  });
});
