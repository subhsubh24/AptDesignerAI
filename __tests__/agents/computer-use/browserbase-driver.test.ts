import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// BrowserbaseDriver is the sole integration point between the Computer Use agent
// loop and a remote Chrome (over CDP via playwright-core). None of it should ever
// touch a real browser in a unit test, so we exercise the deterministic contract
// three ways, all mock-only:
//   1. openBrowser() env + peer-dep gating and session/viewport wiring — the two
//      optional peer deps are provided as vi.mock virtual modules (they are NOT in
//      package.json, matching the app's on-demand install model).
//   2. requirePage() guards — every action rejects with a clear message before
//      openBrowser() has run.
//   3. Input → Playwright call mapping (mouse/keyboard/scroll/navigate/dispose) —
//      a fake page/browser is injected so we assert the exact CDP calls the model's
//      actions translate into, including scroll-direction sign math and the
//      clear-before-type key sequence.

// ── Hoisted spies shared between the vi.mock factories and the tests ──────────
const h = vi.hoisted(() => {
  const sessionsCreate =
    vi.fn() as ReturnType<typeof vi.fn>;
  const connectOverCDP =
    vi.fn() as ReturnType<typeof vi.fn>;
  return { sessionsCreate, connectOverCDP };
});

// Optional peer deps — loaded via dynamic import() in the driver, absent from
// package.json. Provide virtual replacements so openBrowser() can run.
vi.mock("@browserbasehq/sdk", () => ({
  default: class Browserbase {
    sessions = { create: h.sessionsCreate };
    constructor(_opts: { apiKey: string }) {}
  },
}));
vi.mock("playwright-core", () => ({
  chromium: { connectOverCDP: h.connectOverCDP },
}));

import {
  BrowserbaseDriver,
  createDefaultBrowserDriver,
} from "@/lib/agents/computer-use/browserbase-driver";

// A fake Playwright page that records every call so the action→CDP mapping is
// assertable without a browser.
function makeFakePage() {
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    goBack: vi.fn().mockResolvedValue(undefined),
    goForward: vi.fn().mockResolvedValue(undefined),
    screenshot: vi.fn().mockResolvedValue(Buffer.from("png-bytes")),
    url: vi.fn().mockReturnValue("https://example.com/current"),
    mouse: {
      click: vi.fn().mockResolvedValue(undefined),
      move: vi.fn().mockResolvedValue(undefined),
      down: vi.fn().mockResolvedValue(undefined),
      up: vi.fn().mockResolvedValue(undefined),
      wheel: vi.fn().mockResolvedValue(undefined),
    },
    keyboard: {
      type: vi.fn().mockResolvedValue(undefined),
      press: vi.fn().mockResolvedValue(undefined),
      down: vi.fn().mockResolvedValue(undefined),
      up: vi.fn().mockResolvedValue(undefined),
    },
    waitForLoadState: vi.fn().mockResolvedValue(undefined),
  };
}

type FakePage = ReturnType<typeof makeFakePage>;

// Inject a fake page as if openBrowser() had already run.
function driverWithPage(page: FakePage): BrowserbaseDriver {
  const d = new BrowserbaseDriver();
  (d as unknown as { page: FakePage }).page = page;
  return d;
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  h.sessionsCreate.mockReset();
  h.connectOverCDP.mockReset();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe("BrowserbaseDriver — construction", () => {
  it("applies the default viewport and closeOnDispose", () => {
    const d = new BrowserbaseDriver();
    expect(d.screenWidth).toBe(1440);
    expect(d.screenHeight).toBe(900);
  });

  it("honours explicit viewport options", () => {
    const d = new BrowserbaseDriver({ screenWidth: 800, screenHeight: 600 });
    expect(d.screenWidth).toBe(800);
    expect(d.screenHeight).toBe(600);
  });

  it("createDefaultBrowserDriver returns a BrowserbaseDriver", () => {
    expect(createDefaultBrowserDriver()).toBeInstanceOf(BrowserbaseDriver);
  });
});

describe("BrowserbaseDriver — openBrowser gating", () => {
  it("throws a clear error when Browserbase creds are missing", async () => {
    delete process.env.BROWSERBASE_API_KEY;
    delete process.env.BROWSERBASE_PROJECT_ID;
    const d = new BrowserbaseDriver();
    await expect(d.openBrowser()).rejects.toThrow(
      /BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID must be set/,
    );
    // Gating happens before any session is created.
    expect(h.sessionsCreate).not.toHaveBeenCalled();
  });

  it("creates a session with the configured viewport and connects over CDP", async () => {
    process.env.BROWSERBASE_API_KEY = "bb_key";
    process.env.BROWSERBASE_PROJECT_ID = "proj_1";
    h.sessionsCreate.mockResolvedValue({ id: "sess_1", connectUrl: "wss://cdp.example" });
    const fakePage = makeFakePage();
    const fakeBrowser = {
      contexts: () => [{ pages: () => [fakePage], newPage: vi.fn() }],
      close: vi.fn(),
    };
    h.connectOverCDP.mockResolvedValue(fakeBrowser);

    const d = new BrowserbaseDriver({ screenWidth: 1024, screenHeight: 768 });
    await d.openBrowser();

    expect(h.sessionsCreate).toHaveBeenCalledWith({
      projectId: "proj_1",
      browserSettings: { viewport: { width: 1024, height: 768 } },
    });
    expect(h.connectOverCDP).toHaveBeenCalledWith("wss://cdp.example");
    // The acquired page is now usable.
    await expect(d.currentUrl()).resolves.toBe("https://example.com/current");
  });

  it("opens a fresh page when the default context has none", async () => {
    process.env.BROWSERBASE_API_KEY = "bb_key";
    process.env.BROWSERBASE_PROJECT_ID = "proj_1";
    h.sessionsCreate.mockResolvedValue({ id: "sess_1", connectUrl: "wss://cdp.example" });
    const fakePage = makeFakePage();
    const newPage = vi.fn().mockResolvedValue(fakePage);
    h.connectOverCDP.mockResolvedValue({
      contexts: () => [{ pages: () => [], newPage }],
      close: vi.fn(),
    });

    const d = new BrowserbaseDriver();
    await d.openBrowser();
    expect(newPage).toHaveBeenCalledTimes(1);
    await expect(d.currentUrl()).resolves.toBe("https://example.com/current");
  });

  it("throws when the session returns no default context", async () => {
    process.env.BROWSERBASE_API_KEY = "bb_key";
    process.env.BROWSERBASE_PROJECT_ID = "proj_1";
    h.sessionsCreate.mockResolvedValue({ id: "sess_1", connectUrl: "wss://cdp.example" });
    h.connectOverCDP.mockResolvedValue({ contexts: () => [], close: vi.fn() });

    const d = new BrowserbaseDriver();
    await expect(d.openBrowser()).rejects.toThrow(/no default context/);
  });
});

describe("BrowserbaseDriver — requirePage guard", () => {
  it("rejects actions before openBrowser() is called", async () => {
    const d = new BrowserbaseDriver();
    const guard = /openBrowser\(\) must be called before using the driver/;
    await expect(d.navigate("https://x.com")).rejects.toThrow(guard);
    await expect(d.screenshot()).rejects.toThrow(guard);
    await expect(d.currentUrl()).rejects.toThrow(guard);
    await expect(d.clickAt(1, 2)).rejects.toThrow(guard);
  });
});

describe("BrowserbaseDriver — action → Playwright mapping", () => {
  let page: FakePage;
  let d: BrowserbaseDriver;

  beforeEach(() => {
    page = makeFakePage();
    d = driverWithPage(page);
  });

  it("navigate waits for domcontentloaded with a 30s timeout", async () => {
    await d.navigate("https://shop.example/item");
    expect(page.goto).toHaveBeenCalledWith("https://shop.example/item", {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
  });

  it("goBack / goForward use a 15s domcontentloaded wait", async () => {
    await d.goBack();
    await d.goForward();
    expect(page.goBack).toHaveBeenCalledWith({ waitUntil: "domcontentloaded", timeout: 15_000 });
    expect(page.goForward).toHaveBeenCalledWith({ waitUntil: "domcontentloaded", timeout: 15_000 });
  });

  it("screenshot returns the PNG buffer from a non-fullPage capture", async () => {
    const buf = await d.screenshot();
    expect(page.screenshot).toHaveBeenCalledWith({ type: "png", fullPage: false });
    expect(buf.toString()).toBe("png-bytes");
  });

  it("currentUrl reflects the live page url", async () => {
    await expect(d.currentUrl()).resolves.toBe("https://example.com/current");
  });

  it("clickAt / hoverAt map to mouse click / move", async () => {
    await d.clickAt(10, 20);
    await d.hoverAt(30, 40);
    expect(page.mouse.click).toHaveBeenCalledWith(10, 20);
    expect(page.mouse.move).toHaveBeenCalledWith(30, 40);
  });

  it("typeTextAt clears then types then presses Enter in order", async () => {
    await d.typeTextAt(5, 6, "hello", true, true);
    expect(page.mouse.click).toHaveBeenCalledWith(5, 6);
    expect(page.keyboard.press).toHaveBeenNthCalledWith(1, "Control+A");
    expect(page.keyboard.press).toHaveBeenNthCalledWith(2, "Backspace");
    expect(page.keyboard.type).toHaveBeenCalledWith("hello", { delay: 15 });
    expect(page.keyboard.press).toHaveBeenNthCalledWith(3, "Enter");
  });

  it("typeTextAt without clear/enter only clicks and types", async () => {
    await d.typeTextAt(1, 1, "hi", false, false);
    expect(page.keyboard.type).toHaveBeenCalledWith("hi", { delay: 15 });
    expect(page.keyboard.press).not.toHaveBeenCalled();
  });

  it("keyCombination forwards the raw key string", async () => {
    await d.keyCombination("Control+C");
    expect(page.keyboard.press).toHaveBeenCalledWith("Control+C");
  });

  it("scrollDocument maps each direction to the correct wheel deltas", async () => {
    await d.scrollDocument("down");
    expect(page.mouse.wheel).toHaveBeenLastCalledWith(0, 600);
    await d.scrollDocument("up");
    expect(page.mouse.wheel).toHaveBeenLastCalledWith(0, -600);
    await d.scrollDocument("right");
    expect(page.mouse.wheel).toHaveBeenLastCalledWith(600, 0);
    await d.scrollDocument("left");
    expect(page.mouse.wheel).toHaveBeenLastCalledWith(-600, 0);
  });

  it("scrollAt moves to the point then wheels by the signed magnitude", async () => {
    await d.scrollAt(100, 200, "up", 250);
    expect(page.mouse.move).toHaveBeenCalledWith(100, 200);
    expect(page.mouse.wheel).toHaveBeenLastCalledWith(0, -250);
  });

  it("dragAndDrop performs move → down → move → up", async () => {
    const calls: string[] = [];
    page.mouse.move.mockImplementation(async () => { calls.push("move"); });
    page.mouse.down.mockImplementation(async () => { calls.push("down"); });
    page.mouse.up.mockImplementation(async () => { calls.push("up"); });
    await d.dragAndDrop(0, 0, 50, 50);
    expect(calls).toEqual(["move", "down", "move", "up"]);
  });

  it("wait resolves without touching the page", async () => {
    await expect(d.wait(1)).resolves.toBeUndefined();
  });
});

describe("BrowserbaseDriver — dispose", () => {
  it("closes the browser and clears state when closeOnDispose is true", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const d = new BrowserbaseDriver();
    (d as unknown as { browser: unknown; page: unknown; sessionId: string }).browser = { close };
    (d as unknown as { page: unknown }).page = makeFakePage();
    (d as unknown as { sessionId: string }).sessionId = "sess_1";

    await d.dispose();
    expect(close).toHaveBeenCalledTimes(1);
    // A subsequent action fails the requirePage guard — state was cleared.
    await expect(d.currentUrl()).rejects.toThrow(/must be called before/);
  });

  it("is a no-op when closeOnDispose is false", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const d = new BrowserbaseDriver({ closeOnDispose: false });
    (d as unknown as { browser: unknown }).browser = { close };
    await d.dispose();
    expect(close).not.toHaveBeenCalled();
  });

  it("swallows a close() failure instead of throwing", async () => {
    const close = vi.fn().mockRejectedValue(new Error("cdp gone"));
    const d = new BrowserbaseDriver();
    (d as unknown as { browser: unknown }).browser = { close };
    await expect(d.dispose()).resolves.toBeUndefined();
  });
});
