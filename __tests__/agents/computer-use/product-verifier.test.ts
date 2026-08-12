import { describe, it, expect, vi, beforeEach } from "vitest";

// lib/agents/computer-use/product-verifier.ts is the ONLY consumer that ever
// calls the real runComputerUseAgent()/createDefaultBrowserDriver() here — the
// one existing test that imports this module
// (__tests__/agents/computer-use/verify-search-candidates.test.ts) mocks the
// whole module out, so `parseFinal`'s defensive JSON-fence parsing and
// runProductVerifier's own wiring (maxTurns default, excludedPredefinedFunctions,
// wall-clock budget, result shaping) had zero direct coverage. Mock the two
// module boundaries (the agent loop + the browser driver) so the real
// parseFinal/buildGoal/runProductVerifier code runs end to end.

vi.mock("@/lib/agents/computer-use/agent-loop", () => ({
  runComputerUseAgent: vi.fn(),
}));
vi.mock("@/lib/agents/computer-use/browserbase-driver", () => ({
  createDefaultBrowserDriver: vi.fn(() => ({ screenWidth: 1440, screenHeight: 900 })),
}));

import { runProductVerifier, parseFinal } from "@/lib/agents/computer-use/product-verifier";
import { runComputerUseAgent } from "@/lib/agents/computer-use/agent-loop";
import { createDefaultBrowserDriver } from "@/lib/agents/computer-use/browserbase-driver";

const mockRunAgent = runComputerUseAgent as unknown as ReturnType<typeof vi.fn>;
const mockCreateDriver = createDefaultBrowserDriver as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockRunAgent.mockReset();
  mockCreateDriver.mockClear();
});

const VALID_PRODUCT = {
  title: "Cambridge Sofa",
  price: 1299,
  currency: "USD",
  in_stock: true,
  dimensions: { width_in: 84, depth_in: 36, height_in: 32 },
  materials: ["performance linen", "solid oak legs"],
  available_colors: ["cream", "charcoal"],
  available_sizes: [],
  shipping_estimate: "ships in 3-4 weeks",
  return_policy_summary: "30-day free returns",
  caveats: ["price varies by fabric selection"],
};

describe("parseFinal — the model's JSON-fence output", () => {
  it("parses a well-formed fenced JSON block", () => {
    const text = `Found it.\n\`\`\`json\n${JSON.stringify(VALID_PRODUCT)}\n\`\`\``;
    expect(parseFinal(text)).toEqual(VALID_PRODUCT);
  });

  it("defaults array fields to [] and scalar fields to null when absent", () => {
    const text = `\`\`\`json\n{"title":"Some Chair"}\n\`\`\``;
    expect(parseFinal(text)).toEqual({
      title: "Some Chair",
      price: null,
      currency: null,
      in_stock: null,
      dimensions: null,
      materials: [],
      available_colors: [],
      available_sizes: [],
      shipping_estimate: null,
      return_policy_summary: null,
      caveats: [],
    });
  });

  it("coerces a non-number price to null rather than passing it through", () => {
    const text = `\`\`\`json\n{"price":"call for pricing"}\n\`\`\``;
    expect(parseFinal(text)!.price).toBeNull();
  });

  it("coerces a non-boolean in_stock to null", () => {
    const text = `\`\`\`json\n{"in_stock":"maybe"}\n\`\`\``;
    expect(parseFinal(text)!.in_stock).toBeNull();
  });

  it("coerces a non-array materials/colors/sizes/caveats field to []", () => {
    const text = `\`\`\`json\n{"materials":"oak","available_colors":null,"caveats":42}\n\`\`\``;
    const result = parseFinal(text)!;
    expect(result.materials).toEqual([]);
    expect(result.available_colors).toEqual([]);
    expect(result.caveats).toEqual([]);
  });

  it("uses the LAST fenced JSON block when the model emits more than one", () => {
    const text = `\`\`\`json\n{"title":"draft, ignore"}\n\`\`\`\nActually, here's the real one:\n\`\`\`json\n{"title":"final answer"}\n\`\`\``;
    expect(parseFinal(text)!.title).toBe("final answer");
  });

  it("returns undefined for malformed JSON inside the fence", () => {
    const text = "```json\n{not valid json,,,\n```";
    expect(parseFinal(text)).toBeUndefined();
  });

  it("returns undefined for empty input", () => {
    expect(parseFinal("")).toBeUndefined();
  });

  it("falls back to parsing the whole text as JSON when there's no fence at all", () => {
    const text = JSON.stringify({ title: "No fence here" });
    expect(parseFinal(text)!.title).toBe("No fence here");
  });
});

describe("runProductVerifier — wiring", () => {
  it("passes the goal, default maxTurns, blocked drag_and_drop, and a sub-route wall-clock budget to the agent loop", async () => {
    mockRunAgent.mockResolvedValue({
      status: "completed",
      finalText: "",
      parsedOutput: VALID_PRODUCT,
      steps: [],
      totalTurns: 4,
    });

    await runProductVerifier({ productUrl: "https://example.com/product/123" });

    expect(mockCreateDriver).toHaveBeenCalledWith({ screenWidth: 1440, screenHeight: 900 });
    expect(mockRunAgent).toHaveBeenCalledTimes(1);
    const [, config, hooks] = mockRunAgent.mock.calls[0];
    expect(config.startUrl).toBe("https://example.com/product/123");
    expect(config.maxTurns).toBe(10); // default when caller doesn't specify one
    expect(config.excludedPredefinedFunctions).toEqual(["drag_and_drop"]);
    // Must leave headroom under the route's 300s maxDuration, not equal/exceed it.
    expect(config.maxWallClockMs).toBeLessThan(300_000);
    expect(typeof hooks.parseFinal).toBe("function");
  });

  it("honors an explicit maxTurns override", async () => {
    mockRunAgent.mockResolvedValue({ status: "completed", finalText: "", steps: [], totalTurns: 1 });
    await runProductVerifier({ productUrl: "https://example.com/p", maxTurns: 3 });
    expect(mockRunAgent.mock.calls[0][1].maxTurns).toBe(3);
  });

  it("includes expectedTitle/expectedColor/expectedSize hints in the goal when provided", async () => {
    mockRunAgent.mockResolvedValue({ status: "completed", finalText: "", steps: [], totalTurns: 1 });
    await runProductVerifier({
      productUrl: "https://example.com/p",
      expectedTitle: "Cambridge Sofa",
      expectedColor: "cream",
      expectedSize: "84 inch",
    });
    const goal = mockRunAgent.mock.calls[0][1].goal as string;
    expect(goal).toContain("Cambridge Sofa");
    expect(goal).toContain("cream");
    expect(goal).toContain("84 inch");
  });

  it("shapes a successful result: product, source_url, agent_status, turns", async () => {
    mockRunAgent.mockResolvedValue({
      status: "completed",
      finalText: "",
      parsedOutput: VALID_PRODUCT,
      steps: [],
      totalTurns: 6,
    });
    const result = await runProductVerifier({ productUrl: "https://example.com/product/123" });
    expect(result).toEqual({
      product: VALID_PRODUCT,
      source_url: "https://example.com/product/123",
      agent_status: "completed",
      turns: 6,
      notes: undefined,
    });
  });

  it("returns product:null (not a throw) when the agent never produced parsed output", async () => {
    mockRunAgent.mockResolvedValue({
      status: "max_turns",
      finalText: "gave up",
      steps: [],
      totalTurns: 10,
      error: "hit the turn cap before finding product data",
    });
    const result = await runProductVerifier({ productUrl: "https://example.com/product/123" });
    expect(result.product).toBeNull();
    expect(result.agent_status).toBe("max_turns");
    expect(result.notes).toBe("hit the turn cap before finding product data");
  });

  it("forwards onStep through to the agent loop config", async () => {
    mockRunAgent.mockResolvedValue({ status: "completed", finalText: "", steps: [], totalTurns: 1 });
    const onStep = vi.fn();
    await runProductVerifier({ productUrl: "https://example.com/p", onStep });
    expect(mockRunAgent.mock.calls[0][1].onStep).toBe(onStep);
  });
});
