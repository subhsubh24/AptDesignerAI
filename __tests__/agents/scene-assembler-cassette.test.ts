import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentContext } from "@/lib/agents/types";

/**
 * scene-assembler.ts integration test (functional reality, hermetic).
 *
 * scene-assembler.ts sat at ~1.5% coverage with no dedicated test file
 * (APT-21) despite being a load-bearing multi-view understanding stage. Follows
 * the established cassette pattern (see validation-agent-cassette.test.ts): only
 * the `geminiProvider.chat()` and `resolveImageBlocks()` boundaries are
 * substituted, so the real prompt assembly, retry loop, self-consistency
 * escalation, and scene-reconciliation call are all exercised for real.
 */

const chat = vi.fn();
vi.mock("@/lib/ai/gemini", () => ({
  geminiProvider: { chat: (...args: unknown[]) => chat(...args) },
}));

const resolveImageBlocks = vi.fn();
vi.mock("@/lib/ai/resolve-image", () => ({
  resolveImageBlocks: (...args: unknown[]) => resolveImageBlocks(...args),
}));

function chatResponse(body: unknown, model = "cassette-model") {
  return {
    content: JSON.stringify(body),
    model,
    usage: { input_tokens: 100, output_tokens: 200, thinking_tokens: 0 },
  };
}

/** A high-quality raw scene-graph body: passes sceneGraphQualityOk (>=1 object, summary >=20 chars). */
function highQualityBody(overrides?: Record<string, unknown>) {
  return {
    summary: "A living room with a sofa, coffee table, and floor lamp near the window wall.",
    objects: [
      {
        category: "sofa",
        label: "cognac leather sofa",
        observed_in: [{ image_index: 0, view: "wide", bounding_box: null }],
        materials: ["leather"],
        colors: ["cognac"],
        dimensions: null,
        placement: "against the window wall",
        disposition: "keep",
        condition: "good",
        confidence: 0.9,
      },
      {
        category: "coffee_table",
        label: "walnut coffee table",
        observed_in: [{ image_index: 0, view: "wide", bounding_box: null }],
        materials: ["wood"],
        colors: ["walnut"],
        dimensions: null,
        placement: "centered on the rug",
        disposition: "keep",
        condition: "good",
        confidence: 0.85,
      },
    ],
    relations: [],
    coverage: { walls_observed: ["north"], gaps: [], estimated_coverage: 0.6, suggested_shots: [] },
    ...overrides,
  };
}

/** Fails sceneGraphQualityOk: zero objects. */
function lowQualityBody() {
  return {
    summary: "",
    objects: [],
    relations: [],
    coverage: { walls_observed: [], gaps: [], estimated_coverage: 0, suggested_shots: [] },
  };
}

function makeContext(overrides?: Partial<AgentContext>): AgentContext {
  return {
    roomId: "room-1",
    roomType: "living_room",
    keepItems: [],
    replaceItems: [],
    priorities: [],
    budgetMode: "balanced",
    sourcingMode: "standard",
    imageUrls: ["https://example.test/photo-1.jpg", "https://example.test/photo-2.jpg"],
    ...overrides,
  };
}

beforeEach(() => {
  chat.mockReset();
  resolveImageBlocks.mockReset();
  resolveImageBlocks.mockImplementation(async (urls: string[]) =>
    urls.map((url) => ({ type: "image", source: { type: "url", url } })),
  );
});

describe("assembleRoomSceneGraph — no photos", () => {
  it("returns success:false without calling the provider when imageUrls is empty", async () => {
    const { assembleRoomSceneGraph } = await import("@/lib/agents/scene-assembler");
    const result = await assembleRoomSceneGraph(makeContext({ imageUrls: [] }));
    expect(result.success).toBe(false);
    expect(result.error).toBe("scene-assembler: no room photos");
    expect(chat).not.toHaveBeenCalled();
  });
});

describe("assembleRoomSceneGraph — happy path (single high-quality sample)", () => {
  it("assembles a reconciled scene graph from one Gemini call, no judge needed", async () => {
    const { assembleRoomSceneGraph } = await import("@/lib/agents/scene-assembler");
    chat.mockResolvedValueOnce(chatResponse(highQualityBody()));

    const result = await assembleRoomSceneGraph(makeContext());

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    const graph = result.data!;
    expect(graph.objects.length).toBe(2);
    expect(graph.objects.map((o) => o.category)).toEqual(
      expect.arrayContaining(["sofa", "coffee_table"]),
    );
    // No floor plan → source_image_urls is exactly the photo list, not "photos + 1".
    expect(graph.source_image_urls).toEqual(makeContext().imageUrls);
    expect(graph.floor_plan_grounded).toBe(false);
    // Single quality-passing sample: no judge call needed.
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it("passes an explicit thinkingConfig and the deterministic seed to Gemini", async () => {
    const { assembleRoomSceneGraph } = await import("@/lib/agents/scene-assembler");
    const { DETERMINISTIC_SEED } = await import("@/lib/ai/determinism");
    chat.mockResolvedValueOnce(chatResponse(highQualityBody()));

    await assembleRoomSceneGraph(makeContext());

    expect(chat).toHaveBeenCalledTimes(1);
    const [params] = chat.mock.calls[0];
    expect(params.thinkingConfig).toBeDefined();
    expect(params.seed).toBe(DETERMINISTIC_SEED);
    expect(params.responseMimeType).toBe("application/json");
  });

  it("labels the floor plan as authoritative and offsets photo indices when floorPlanImageUrl is set", async () => {
    const { assembleRoomSceneGraph } = await import("@/lib/agents/scene-assembler");
    chat.mockResolvedValueOnce(chatResponse(highQualityBody()));

    const result = await assembleRoomSceneGraph(
      makeContext({ floorPlanImageUrl: "https://example.test/floor-plan.png" }),
    );

    expect(result.success).toBe(true);
    // resolveImageBlocks is called with the floor plan prepended to the photos.
    expect(resolveImageBlocks).toHaveBeenCalledWith(
      ["https://example.test/floor-plan.png", ...makeContext().imageUrls],
      { preferFilesApi: true },
    );
    const [params] = chat.mock.calls[0];
    const cacheableBlocks = params.cacheScope.content as Array<{ type: string; text?: string }>;
    const floorPlanCaption = cacheableBlocks.find(
      (b) => b.type === "text" && b.text?.includes("AUTHORITATIVE FLOOR PLAN"),
    );
    expect(floorPlanCaption).toBeDefined();
    // The floor plan's own slot is excluded from the persisted photo list.
    expect(result.data!.source_image_urls).toEqual(makeContext().imageUrls);
  });

  it("stamps assembled_at as undefined under deterministic mode (byte-stable output)", async () => {
    const { assembleRoomSceneGraph } = await import("@/lib/agents/scene-assembler");
    chat.mockResolvedValueOnce(chatResponse(highQualityBody()));

    const result = await assembleRoomSceneGraph(makeContext());
    expect(result.data!.assembled_at).toBeUndefined();
  });
});

describe("assembleRoomSceneGraph — retry on invalid JSON", () => {
  it("retries once after a response with no parseable JSON, then succeeds", async () => {
    const { assembleRoomSceneGraph } = await import("@/lib/agents/scene-assembler");
    // No braces/brackets at all — extractJsonObject's last-resort JSON.parse
    // throws, unlike a well-formed-but-wrong-shape object (which the lenient
    // .default()/.catch() schema would silently coerce instead of rejecting).
    chat
      .mockResolvedValueOnce({
        content: "Sorry, I can't help with that request.",
        model: "cassette-model",
        usage: { input_tokens: 10, output_tokens: 5, thinking_tokens: 0 },
      })
      .mockResolvedValueOnce(chatResponse(highQualityBody()));

    const result = await assembleRoomSceneGraph(makeContext());

    expect(result.success).toBe(true);
    expect(chat).toHaveBeenCalledTimes(2);
    // The retry prompt tells the model its previous response was invalid.
    const [retryParams] = chat.mock.calls[1];
    const retryText = (retryParams.messages[0].content[0] as { text: string }).text;
    expect(retryText).toContain("Your previous response was invalid");
  });

  it("returns success:false when both attempts fail", async () => {
    const { assembleRoomSceneGraph } = await import("@/lib/agents/scene-assembler");
    chat.mockRejectedValue(new Error("gemini unavailable"));

    const result = await assembleRoomSceneGraph(makeContext());

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(chat).toHaveBeenCalledTimes(2);
  });
});

describe("assembleRoomSceneGraph — self-consistency escalation on low quality", () => {
  it("escalates to N=3 + judge when the sole sample is degenerate (no objects)", async () => {
    const { assembleRoomSceneGraph } = await import("@/lib/agents/scene-assembler");
    let generateCalls = 0;
    chat.mockImplementation(async (params: { responseMimeType?: string }) => {
      if (params.responseMimeType === "application/json") {
        generateCalls++;
        // First (sole, n=1) sample is degenerate; every escalated sample is high-quality.
        return chatResponse(generateCalls === 1 ? lowQualityBody() : highQualityBody());
      }
      // Judge call carries no responseMimeType.
      return chatResponse({ best_index: 1, reason: "candidate 1 has the most complete inventory" });
    });

    const result = await assembleRoomSceneGraph(makeContext());

    expect(result.success).toBe(true);
    expect(result.data!.objects.length).toBe(2);
    // 1 (degenerate sole sample) + 3 (escalated samples) generate calls + 1 judge call.
    expect(chat).toHaveBeenCalledTimes(5);
  });
});
