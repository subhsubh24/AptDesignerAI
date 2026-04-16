import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock geminiProvider before importing greedy-decorator ────────────────────
const { mockChat } = vi.hoisted(() => ({ mockChat: vi.fn() }));
vi.mock("@/lib/ai/gemini", () => ({
  geminiProvider: { chat: mockChat },
}));
vi.mock("@/lib/ai/models", () => ({
  selectModel: () => "gemini-test-model",
}));

import { runDiagnosisExpansion } from "@/lib/agents/greedy-decorator";
import type { ActionItem } from "@/lib/types/database";

function makeItem(category: string): ActionItem {
  return { category, action: `Buy a ${category}`, priority: 4, reasoning: "" };
}

function llmResponse(verdict: "ADD" | "STOP", category?: string, densityFeel = "balanced"): string {
  if (verdict === "STOP") {
    return JSON.stringify({
      verdict: "STOP",
      density_feel: densityFeel,
      overall_reasoning: "Room is complete.",
    });
  }
  return JSON.stringify({
    verdict: "ADD",
    item: {
      category: category ?? "candles",
      action: `3 pillar candles on the coffee table`,
      variant: null,
      quantity: 3,
      priority: 5,
      reasoning: "Adds warmth to the empty coffee table",
    },
    density_feel: densityFeel,
    overall_reasoning: "Room has headroom for more small decor.",
  });
}

describe("runDiagnosisExpansion", () => {
  beforeEach(() => {
    mockChat.mockReset();
  });

  it("appends items and stops when LLM returns STOP", async () => {
    // ADD candles → ADD books → STOP
    mockChat
      .mockResolvedValueOnce({ content: llmResponse("ADD", "candles") })
      .mockResolvedValueOnce({ content: llmResponse("ADD", "books") })
      .mockResolvedValueOnce({ content: llmResponse("STOP") });

    const result = await runDiagnosisExpansion({
      currentItems: [makeItem("sofa"), makeItem("area_rug")],
      room: { type: "living_room", sqft: 280 },
      designDirection: null,
    });

    expect(result.added_count).toBe(2);
    expect(result.stop_reason).toBe("llm_stop");
    expect(result.expanded_items.map(i => i.category)).toContain("candles");
    expect(result.expanded_items.map(i => i.category)).toContain("books");
  });

  it("stops immediately on first STOP verdict", async () => {
    mockChat.mockResolvedValueOnce({ content: llmResponse("STOP") });

    const result = await runDiagnosisExpansion({
      currentItems: [makeItem("sofa")],
      room: { type: "bedroom", sqft: 180 },
      designDirection: null,
    });

    expect(result.added_count).toBe(0);
    expect(result.stop_reason).toBe("llm_stop");
    expect(mockChat).toHaveBeenCalledTimes(1);
  });

  it("stops when density_feel is cluttered", async () => {
    mockChat.mockResolvedValueOnce({
      content: llmResponse("ADD", "plant", "cluttered"),
    });

    const result = await runDiagnosisExpansion({
      currentItems: [makeItem("sofa"), makeItem("area_rug"), makeItem("coffee_table")],
      room: { type: "living_room", sqft: 200 },
    });

    expect(result.stop_reason).toBe("llm_cluttered");
    expect(result.added_count).toBe(0);
  });

  it("retries once on guardrail rejection and accepts retry item", async () => {
    // First call: suggests plant (but we'll make plant at hard cap for tiny room)
    // Second call (retry): suggests candles (passes guardrail)
    // Third call: STOP
    mockChat
      .mockResolvedValueOnce({ content: llmResponse("ADD", "plant") })
      .mockResolvedValueOnce({ content: llmResponse("ADD", "candles") }) // retry
      .mockResolvedValueOnce({ content: llmResponse("STOP") });

    // Seed with max plants for sqft=60 (floor(60/60)=1 plant, modifier 1.0)
    const result = await runDiagnosisExpansion({
      currentItems: [makeItem("sofa"), makeItem("plant")],
      room: { type: "living_room", sqft: 60 },
      designDirection: null,
    });

    // candles should have been added (retry succeeded)
    expect(result.expanded_items.map(i => i.category)).toContain("candles");
  });

  it("stops after 3 consecutive guardrail rejections", async () => {
    // Suggest items from same at-cap category repeatedly; retry always fails too
    mockChat.mockResolvedValue({ content: llmResponse("ADD", "plant") });

    // 1 sqft room — basically everything is at hard cap immediately
    const result = await runDiagnosisExpansion({
      currentItems: Array.from({ length: 30 }, (_, i) => makeItem(`item_${i}`)),
      room: { type: "living_room", sqft: 1 },
      designDirection: null,
      maxIterations: 20,
    });

    expect(result.stop_reason).toBe("consecutive_rejections");
  });

  it("marks added items with source: expansion", async () => {
    mockChat
      .mockResolvedValueOnce({ content: llmResponse("ADD", "baskets") })
      .mockResolvedValueOnce({ content: llmResponse("STOP") });

    const result = await runDiagnosisExpansion({
      currentItems: [makeItem("sofa")],
      room: { type: "living_room", sqft: 250 },
    });

    const expansionItems = result.expanded_items.filter(i =>
      (i as ActionItem & { source?: string }).source === "expansion",
    );
    expect(expansionItems.length).toBeGreaterThan(0);
    expect(expansionItems[0].category).toBe("baskets");
  });

  it("Bohemian direction allows more additions than Japandi before saturation", async () => {
    // For this test, keep LLM saying ADD for both runs
    // Bohemian should allow more items (higher caps) before stopping on its own
    // We just verify hard_cap is higher by checking decision_log saturation_pct

    // Both run to max_iterations=3 with 3 ADDs
    mockChat.mockResolvedValue({ content: llmResponse("ADD", "candles") });

    const bohemian = await runDiagnosisExpansion({
      currentItems: [makeItem("sofa")],
      room: { type: "living_room", sqft: 250 },
      designDirection: { style: "Bohemian" } as unknown as import("@/lib/types/database").DesignDirection,
      maxIterations: 3,
    });

    mockChat.mockResolvedValue({ content: llmResponse("ADD", "candles") });

    const japandi = await runDiagnosisExpansion({
      currentItems: [makeItem("sofa")],
      room: { type: "living_room", sqft: 250 },
      designDirection: { style: "Japandi" } as unknown as import("@/lib/types/database").DesignDirection,
      maxIterations: 3,
    });

    // Bohemian saturation_pct should be lower for same number of items
    // (because hard_cap is higher)
    const bohemianLastPct = bohemian.decision_log.at(-1)?.saturation_pct ?? 1;
    const japandiLastPct = japandi.decision_log.at(-1)?.saturation_pct ?? 1;
    expect(bohemianLastPct).toBeLessThan(japandiLastPct);
  });

  it("records a decision_log entry for each iteration", async () => {
    mockChat
      .mockResolvedValueOnce({ content: llmResponse("ADD", "vase") })
      .mockResolvedValueOnce({ content: llmResponse("ADD", "baskets") })
      .mockResolvedValueOnce({ content: llmResponse("STOP") });

    const result = await runDiagnosisExpansion({
      currentItems: [makeItem("sofa")],
      room: { type: "living_room", sqft: 250 },
    });

    expect(result.decision_log.length).toBe(3);
    expect(result.decision_log[0].verdict).toBe("ADD");
    expect(result.decision_log[2].verdict).toBe("STOP");
  });

  it("passes budget context into the LLM prompt", async () => {
    mockChat.mockResolvedValueOnce({ content: llmResponse("STOP") });

    await runDiagnosisExpansion({
      currentItems: [makeItem("sofa")],
      room: { type: "living_room", sqft: 250 },
      budget: { totalDollars: 5000, mode: "balanced", committedDollars: 1500 },
    });

    const call = mockChat.mock.calls[0][0];
    const messages = call.messages as Array<{ content: Array<{ type: string; text?: string }> }>;
    const promptText = messages[0].content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n");

    expect(promptText).toContain("Budget Context");
    expect(promptText).toContain("$5,000");
    expect(promptText).toContain("balanced");
    expect(promptText).toContain("$1,500");
  });

  it("passes sibling-room summaries into the LLM prompt", async () => {
    mockChat.mockResolvedValueOnce({ content: llmResponse("STOP") });

    await runDiagnosisExpansion({
      currentItems: [makeItem("sofa")],
      room: { type: "living_room", sqft: 250 },
      siblingRooms: [
        {
          roomType: "bedroom",
          palette: ["warm walnut", "ivory", "sage green"],
          materials: ["oak", "linen"],
          styleNotes: "Japandi with soft wood tones",
          topCategories: ["bed", "nightstand", "rug"],
        },
      ],
    });

    const call = mockChat.mock.calls[0][0];
    const messages = call.messages as Array<{ content: Array<{ type: string; text?: string }> }>;
    const promptText = messages[0].content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n");

    expect(promptText).toContain("Other Rooms in This Apartment");
    expect(promptText).toContain("bedroom");
    expect(promptText).toContain("warm walnut");
    expect(promptText).toContain("oak");
    expect(promptText).toContain("Japandi");
  });

  it("omits budget + sibling sections when neither is provided", async () => {
    mockChat.mockResolvedValueOnce({ content: llmResponse("STOP") });

    await runDiagnosisExpansion({
      currentItems: [makeItem("sofa")],
      room: { type: "living_room", sqft: 250 },
    });

    const call = mockChat.mock.calls[0][0];
    const messages = call.messages as Array<{ content: Array<{ type: string; text?: string }> }>;
    const promptText = messages[0].content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n");

    expect(promptText).not.toContain("Budget Context");
    expect(promptText).not.toContain("Other Rooms in This Apartment");
  });
});
