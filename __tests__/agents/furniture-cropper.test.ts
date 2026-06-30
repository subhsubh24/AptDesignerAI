import { describe, it, expect, vi, beforeEach } from "vitest";

// runFurnitureCropper makes one geminiProvider.chat call per photo, then clamps
// + filters the returned boxes. Mock the provider so we exercise the happy
// path, per-photo error resilience, box clamping, the tiny-box filter, and the
// determinism contract without a real vision call.
vi.mock("@/lib/ai/gemini", () => ({
  geminiProvider: { chat: vi.fn() },
}));

import { runFurnitureCropper } from "@/lib/agents/furniture-cropper";
import { geminiProvider } from "@/lib/ai/gemini";
import { DETERMINISTIC_SEED } from "@/lib/ai/determinism";

const mockChat = geminiProvider.chat as unknown as ReturnType<typeof vi.fn>;

type Box = { x: number; y: number; w: number; h: number };

function chatResponse(crops: Array<{ label?: string; box: Box }>, tokens = { i: 10, o: 20, t: 5 }) {
  return {
    content: JSON.stringify({ crops }),
    usage: { input_tokens: tokens.i, output_tokens: tokens.o, thinking_tokens: tokens.t },
    model: "gemini-test",
  };
}

/** Pull the text block out of the Nth chat call's user message. */
function promptText(callIndex = 0): string {
  const arg = mockChat.mock.calls[callIndex][0] as {
    messages: Array<{ content: Array<{ type: string; text?: string }> }>;
  };
  return arg.messages[0].content
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("\n");
}

describe("runFurnitureCropper", () => {
  beforeEach(() => {
    mockChat.mockReset();
  });

  it("parses crops, tags them with the source image, and sums tokens", async () => {
    mockChat.mockResolvedValue(
      chatResponse([{ label: "sofa", box: { x: 0.1, y: 0.1, w: 0.4, h: 0.3 } }]),
    );

    const result = await runFurnitureCropper(["https://cdn/photo1.jpg"]);

    expect(result.crops).toHaveLength(1);
    expect(result.crops[0]).toMatchObject({
      source_image_url: "https://cdn/photo1.jpg",
      label: "sofa",
      box: { x: 0.1, y: 0.1, w: 0.4, h: 0.3 },
    });
    expect(result.tokensUsed).toBe(35); // 10 + 20 + 5
    expect(typeof result.model).toBe("string");
    expect(result.model.length).toBeGreaterThan(0);
  });

  it("passes the deterministic seed, cheap thinking, schema, and ultra-high media", async () => {
    mockChat.mockResolvedValue(chatResponse([]));

    await runFurnitureCropper(["https://cdn/photo1.jpg"]);

    expect(mockChat).toHaveBeenCalledTimes(1);
    const arg = mockChat.mock.calls[0][0] as {
      seed?: number;
      thinkingConfig?: { thinkingLevel?: string };
      responseSchema?: unknown;
      mediaResolution?: string;
    };
    expect(arg.seed).toBe(DETERMINISTIC_SEED);
    expect(arg.thinkingConfig?.thinkingLevel).toBe("low");
    expect(arg.responseSchema).toBeTruthy();
    expect(arg.mediaResolution).toBe("ultra_high");
  });

  it("makes one call per photo and accumulates crops + tokens across them", async () => {
    mockChat
      .mockResolvedValueOnce(chatResponse([{ label: "sofa", box: { x: 0, y: 0, w: 0.3, h: 0.3 } }]))
      .mockResolvedValueOnce(chatResponse([{ label: "bed", box: { x: 0.2, y: 0.2, w: 0.3, h: 0.3 } }]));

    const result = await runFurnitureCropper(["https://cdn/a.jpg", "https://cdn/b.jpg"]);

    expect(mockChat).toHaveBeenCalledTimes(2);
    expect(result.crops.map((c) => c.label)).toEqual(["sofa", "bed"]);
    expect(result.crops.map((c) => c.source_image_url)).toEqual([
      "https://cdn/a.jpg",
      "https://cdn/b.jpg",
    ]);
    expect(result.tokensUsed).toBe(70); // 35 per call
  });

  it("clamps a box that overflows the right/bottom edge", async () => {
    // x + w = 1.4 > 1 → w must clamp to 1 - x = 0.5; h overflow clamps similarly.
    mockChat.mockResolvedValue(
      chatResponse([{ label: "sectional", box: { x: 0.5, y: 0.7, w: 0.9, h: 0.8 } }]),
    );

    const result = await runFurnitureCropper(["https://cdn/a.jpg"]);

    expect(result.crops).toHaveLength(1);
    const { box } = result.crops[0];
    expect(box.x).toBeCloseTo(0.5, 10);
    expect(box.y).toBeCloseTo(0.7, 10);
    expect(box.w).toBeCloseTo(0.5, 10); // clamped from 0.9 → 1 - x
    expect(box.h).toBeCloseTo(0.3, 10); // clamped from 0.8 → 1 - y
  });

  it("drops tiny boxes (width or height <= 0.02) as noise", async () => {
    mockChat.mockResolvedValue(
      chatResponse([
        { label: "speck", box: { x: 0, y: 0, w: 0.01, h: 0.5 } }, // too narrow
        { label: "sliver", box: { x: 0, y: 0, w: 0.5, h: 0.02 } }, // too short
        { label: "armchair", box: { x: 0.1, y: 0.1, w: 0.3, h: 0.3 } }, // kept
      ]),
    );

    const result = await runFurnitureCropper(["https://cdn/a.jpg"]);

    expect(result.crops.map((c) => c.label)).toEqual(["armchair"]);
  });

  it("falls back to the 'other' label when the model emits an empty label", async () => {
    mockChat.mockResolvedValue(
      chatResponse([{ label: "", box: { x: 0.1, y: 0.1, w: 0.3, h: 0.3 } }]),
    );

    const result = await runFurnitureCropper(["https://cdn/a.jpg"]);

    expect(result.crops[0].label).toBe("other");
  });

  it("skips a photo whose call fails without dropping the others", async () => {
    mockChat
      .mockRejectedValueOnce(new Error("vision model unavailable"))
      .mockResolvedValueOnce(chatResponse([{ label: "desk", box: { x: 0.1, y: 0.1, w: 0.3, h: 0.3 } }]));

    const result = await runFurnitureCropper(["https://cdn/bad.jpg", "https://cdn/good.jpg"]);

    expect(mockChat).toHaveBeenCalledTimes(2);
    expect(result.crops.map((c) => c.label)).toEqual(["desk"]);
    expect(result.crops[0].source_image_url).toBe("https://cdn/good.jpg");
    expect(result.tokensUsed).toBe(35); // only the successful call counted
  });

  it("makes no calls and returns an empty result for no photos", async () => {
    const result = await runFurnitureCropper([]);

    expect(mockChat).not.toHaveBeenCalled();
    expect(result.crops).toEqual([]);
    expect(result.tokensUsed).toBe(0);
  });

  it("injects the room-type priority hint and omits it when the room is unknown", async () => {
    mockChat.mockResolvedValue(chatResponse([]));

    await runFurnitureCropper(["https://cdn/a.jpg"], "living_room");
    const withRoom = promptText(0);
    expect(withRoom).toContain("ROOM TYPE: living_room");
    expect(withRoom).toContain("Typical high-value pieces in this room type");
    expect(withRoom).toContain("sofa, sectional, armchair");

    mockChat.mockClear();
    mockChat.mockResolvedValue(chatResponse([]));
    await runFurnitureCropper(["https://cdn/a.jpg"]);
    expect(promptText(0)).not.toContain("ROOM TYPE:");
  });
});
