import { describe, it, expect, vi, beforeEach } from "vitest";

// The agent loop talks to the Gemini Computer Use model through a direct
// @google/genai SDK call (it bypasses geminiProvider.chat for multi-turn
// function-calling). Mock the SDK so we drive the turn loop deterministically
// without a network call, and use an injectable clock to exercise the
// wall-clock budget guard without real time passing.
// Define the mock fn INSIDE the factory (vi.mock is hoisted above top-level
// consts, so referencing an outer `const mockGenerate` throws
// "Cannot access before initialization"). generateContent is created once in
// the factory closure, so every `new GoogleGenAI()` shares the same fn — which
// is exactly the singleton the agent loop instantiates. We retrieve it after import.
vi.mock("@google/genai", () => {
  const generateContent = vi.fn();
  // A regular (non-arrow) function so it is constructable via `new` — the agent
  // loop does `new GoogleGenAI(...)`. Returning an object makes `new` yield it.
  function GoogleGenAI() {
    return { models: { generateContent } };
  }
  return {
    GoogleGenAI,
    ThinkingLevel: { HIGH: "HIGH", MEDIUM: "MEDIUM", LOW: "LOW" },
  };
});

import { runComputerUseAgent } from "@/lib/agents/computer-use/agent-loop";
import type { BrowserDriver } from "@/lib/agents/computer-use/types";
import { GoogleGenAI } from "@google/genai";

const mockGenerate = (new (GoogleGenAI as unknown as new () => {
  models: { generateContent: ReturnType<typeof vi.fn> };
})()).models.generateContent;

function makeDriver(): BrowserDriver {
  return {
    screenWidth: 1440,
    screenHeight: 900,
    openBrowser: vi.fn().mockResolvedValue(undefined),
    screenshot: vi.fn().mockResolvedValue(Buffer.from("fake-png")),
    // A benign product URL — must NOT match the safety policy's blocked
    // patterns (login/checkout/cart/…) or actions would be refused.
    currentUrl: vi.fn().mockResolvedValue("https://example.com/product"),
    navigate: vi.fn().mockResolvedValue(undefined),
    goBack: vi.fn().mockResolvedValue(undefined),
    goForward: vi.fn().mockResolvedValue(undefined),
    clickAt: vi.fn().mockResolvedValue(undefined),
    hoverAt: vi.fn().mockResolvedValue(undefined),
    typeTextAt: vi.fn().mockResolvedValue(undefined),
    keyCombination: vi.fn().mockResolvedValue(undefined),
    scrollDocument: vi.fn().mockResolvedValue(undefined),
    scrollAt: vi.fn().mockResolvedValue(undefined),
    dragAndDrop: vi.fn().mockResolvedValue(undefined),
    wait: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn().mockResolvedValue(undefined),
  };
}

// A turn where the model keeps working: emits a safe, non-navigation action so
// the loop continues indefinitely until a turn/wall-clock limit stops it.
function actionResponse() {
  return {
    candidates: [
      {
        content: {
          parts: [
            { text: "still reading the page" },
            { functionCall: { name: "wait_5_seconds", args: {} } },
          ],
        },
      },
    ],
  };
}

// A terminal turn: text only, no function call → the model is done.
function finalResponse(text: string) {
  return { candidates: [{ content: { parts: [{ text }] } }] };
}

beforeEach(() => {
  mockGenerate.mockReset();
});

describe("runComputerUseAgent", () => {
  it("completes normally and disposes the driver when the model stops acting", async () => {
    mockGenerate.mockResolvedValue(finalResponse("Done. Price is $499."));
    const driver = makeDriver();

    const result = await runComputerUseAgent(
      driver,
      { startUrl: "https://example.com/product", goal: "verify the product" },
      {},
    );

    expect(result.status).toBe("completed");
    expect(result.totalTurns).toBe(1);
    expect(result.finalText).toContain("$499");
    expect(driver.dispose).toHaveBeenCalledTimes(1);
  });

  it("stops with max_turns once the wall-clock budget is exceeded mid-run", async () => {
    // Model never finishes on its own — only the budget can stop it.
    mockGenerate.mockResolvedValue(actionResponse());
    // Injected clock: loopStart=0, turn-1 guard=500ms (<1000 → proceed),
    // turn-2 guard=2000ms (>=1000 → trip). Later calls stay past the budget.
    const times = [0, 500, 2000, 2000, 2000, 2000];
    let i = 0;
    const now = () => times[Math.min(i++, times.length - 1)];
    const driver = makeDriver();

    const result = await runComputerUseAgent(
      driver,
      {
        startUrl: "https://example.com/product",
        goal: "verify the product",
        maxTurns: 10,
        maxWallClockMs: 1000,
      },
      { now },
    );

    expect(result.status).toBe("max_turns");
    // Exactly one turn ran before the budget tripped at the top of turn 2.
    expect(result.totalTurns).toBe(1);
    expect(result.error).toContain("wall-clock budget");
    // Cleanup still runs — the browser session is not leaked.
    expect(driver.dispose).toHaveBeenCalledTimes(1);
  });

  it("runs to the turn ceiling when no wall-clock cap is set and the model keeps acting", async () => {
    mockGenerate.mockResolvedValue(actionResponse());
    const driver = makeDriver();

    const result = await runComputerUseAgent(
      driver,
      { startUrl: "https://example.com/product", goal: "verify the product", maxTurns: 3 },
      {},
    );

    expect(result.status).toBe("max_turns");
    expect(result.totalTurns).toBe(3);
    // maxWallClockMs undefined → the guard is inert, never trips early.
  });
});
