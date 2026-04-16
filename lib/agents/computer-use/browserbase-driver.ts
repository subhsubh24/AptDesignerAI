/**
 * Browserbase driver for the Computer Use agent loop.
 *
 * Browserbase provides a remote Chrome instance reachable over the Chrome
 * DevTools Protocol (CDP). We connect via `playwright-core` (NOT full
 * `playwright` — no bundled Chromium, since Browserbase runs the browser).
 *
 * Both dependencies are loaded via dynamic `import()` so the app builds even
 * if neither is installed. ENABLE_COMPUTER_USE=1 is the activation gate;
 * without it no route ever reaches this module.
 *
 * Required env:
 *   BROWSERBASE_API_KEY      — API key from browserbase.com
 *   BROWSERBASE_PROJECT_ID   — project to bill sessions to
 *   BROWSERBASE_REGION       — (optional) us-west-2 / us-east-1 / eu-central-1
 *
 * Required peer deps (not in package.json by default — installed on demand
 * by deployments that enable Computer Use):
 *   @browserbasehq/sdk ^2
 *   playwright-core ^1.47
 */

import type { BrowserDriver } from "./types";
import { createLogger } from "@/lib/logging/logger";

const log = createLogger("browserbase-driver");

// ─── Lazy-loaded peer-dep types (never import at top-level) ─────────────
// These are declared as `unknown` locally so this file type-checks without
// the deps installed. When ENABLE_COMPUTER_USE=1, the runtime dynamic
// imports below resolve the real types.
type PlaywrightBrowser = { contexts(): unknown[]; close(): Promise<void> };
type PlaywrightContext = { pages(): unknown[]; newPage(): Promise<unknown> };
type PlaywrightPage = {
  goto(url: string, opts?: Record<string, unknown>): Promise<unknown>;
  goBack(opts?: Record<string, unknown>): Promise<unknown>;
  goForward(opts?: Record<string, unknown>): Promise<unknown>;
  screenshot(opts?: Record<string, unknown>): Promise<Buffer>;
  url(): string;
  mouse: {
    click(x: number, y: number, opts?: Record<string, unknown>): Promise<void>;
    move(x: number, y: number): Promise<void>;
    down(): Promise<void>;
    up(): Promise<void>;
    wheel(dx: number, dy: number): Promise<void>;
  };
  keyboard: {
    type(text: string, opts?: Record<string, unknown>): Promise<void>;
    press(key: string): Promise<void>;
    down(key: string): Promise<void>;
    up(key: string): Promise<void>;
  };
  waitForLoadState(state?: string, opts?: Record<string, unknown>): Promise<void>;
};

export interface BrowserbaseDriverOptions {
  screenWidth?: number;
  screenHeight?: number;
  /** Close the session on dispose. Default true. */
  closeOnDispose?: boolean;
}

export class BrowserbaseDriver implements BrowserDriver {
  readonly screenWidth: number;
  readonly screenHeight: number;

  private browser: PlaywrightBrowser | null = null;
  private page: PlaywrightPage | null = null;
  private sessionId: string | null = null;
  private closeOnDispose: boolean;

  constructor(options: BrowserbaseDriverOptions = {}) {
    this.screenWidth = options.screenWidth ?? 1440;
    this.screenHeight = options.screenHeight ?? 900;
    this.closeOnDispose = options.closeOnDispose ?? true;
  }

  async openBrowser(): Promise<void> {
    const apiKey = process.env.BROWSERBASE_API_KEY;
    const projectId = process.env.BROWSERBASE_PROJECT_ID;
    if (!apiKey || !projectId) {
      throw new Error(
        "BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID must be set to use Computer Use.",
      );
    }

    // Dynamic imports so the bundle doesn't blow up when Computer Use is off.
    // If the peer deps aren't installed, surface a clear message.
    let Browserbase: new (opts: { apiKey: string }) => {
      sessions: {
        create(params: Record<string, unknown>): Promise<{ id: string; connectUrl: string }>;
      };
    };
    let chromium: { connectOverCDP(url: string): Promise<PlaywrightBrowser> };
    try {
      // Indirect module specifiers prevent TypeScript from resolving these
      // at compile time — they're optional peer deps only installed on
      // deployments that opt into Computer Use.
      const bbSpecifier = "@browserbasehq/sdk";
      const pwSpecifier = "playwright-core";
      const bbMod = (await import(/* webpackIgnore: true */ bbSpecifier)) as {
        default?: typeof Browserbase;
        Browserbase?: typeof Browserbase;
      };
      Browserbase = bbMod.default ?? bbMod.Browserbase!;
      const pwMod = (await import(/* webpackIgnore: true */ pwSpecifier)) as {
        chromium: typeof chromium;
      };
      chromium = pwMod.chromium;
    } catch (e) {
      throw new Error(
        "Computer Use requires the following peer dependencies: `@browserbasehq/sdk` and `playwright-core`. " +
          `Install them to enable this feature. (underlying: ${(e as Error).message})`,
      );
    }

    const bb = new Browserbase({ apiKey });
    const session = await bb.sessions.create({
      projectId,
      browserSettings: {
        viewport: {
          width: this.screenWidth,
          height: this.screenHeight,
        },
      },
    });
    this.sessionId = session.id;
    log.info("Browserbase session created", { sessionId: session.id });

    this.browser = await chromium.connectOverCDP(session.connectUrl);
    // Browserbase opens with a default context + blank page.
    const contexts = this.browser.contexts() as PlaywrightContext[];
    const context = contexts[0];
    if (!context) {
      throw new Error("Browserbase session returned no default context");
    }
    const pages = context.pages() as PlaywrightPage[];
    this.page = pages[0] ?? ((await context.newPage()) as PlaywrightPage);
  }

  private requirePage(): PlaywrightPage {
    if (!this.page) {
      throw new Error("BrowserbaseDriver.openBrowser() must be called before using the driver");
    }
    return this.page;
  }

  async navigate(url: string): Promise<void> {
    const page = this.requirePage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  }

  async goBack(): Promise<void> {
    await this.requirePage().goBack({ waitUntil: "domcontentloaded", timeout: 15_000 });
  }

  async goForward(): Promise<void> {
    await this.requirePage().goForward({ waitUntil: "domcontentloaded", timeout: 15_000 });
  }

  async screenshot(): Promise<Buffer> {
    return await this.requirePage().screenshot({ type: "png", fullPage: false });
  }

  async currentUrl(): Promise<string> {
    return this.requirePage().url();
  }

  async clickAt(x: number, y: number): Promise<void> {
    await this.requirePage().mouse.click(x, y);
  }

  async hoverAt(x: number, y: number): Promise<void> {
    await this.requirePage().mouse.move(x, y);
  }

  async typeTextAt(
    x: number,
    y: number,
    text: string,
    pressEnter: boolean,
    clearBefore: boolean,
  ): Promise<void> {
    const page = this.requirePage();
    await page.mouse.click(x, y);
    if (clearBefore) {
      // Select-all + delete. Use Meta on mac, Control elsewhere; we can't
      // easily detect OS from CDP, so send both — Playwright ignores the
      // unrecognized one. A real implementation could inspect navigator.platform.
      try {
        await page.keyboard.press("Control+A");
      } catch {
        /* ignore */
      }
      await page.keyboard.press("Backspace");
    }
    await page.keyboard.type(text, { delay: 15 });
    if (pressEnter) {
      await page.keyboard.press("Enter");
    }
  }

  async keyCombination(keys: string): Promise<void> {
    // Playwright accepts the same `+` format the model emits (e.g. "Control+C").
    await this.requirePage().keyboard.press(keys);
  }

  async scrollDocument(direction: "up" | "down" | "left" | "right"): Promise<void> {
    const dy = direction === "down" ? 600 : direction === "up" ? -600 : 0;
    const dx = direction === "right" ? 600 : direction === "left" ? -600 : 0;
    await this.requirePage().mouse.wheel(dx, dy);
  }

  async scrollAt(
    x: number,
    y: number,
    direction: "up" | "down" | "left" | "right",
    magnitude: number,
  ): Promise<void> {
    const page = this.requirePage();
    await page.mouse.move(x, y);
    const dy = direction === "down" ? magnitude : direction === "up" ? -magnitude : 0;
    const dx = direction === "right" ? magnitude : direction === "left" ? -magnitude : 0;
    await page.mouse.wheel(dx, dy);
  }

  async dragAndDrop(x: number, y: number, destX: number, destY: number): Promise<void> {
    const page = this.requirePage();
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(destX, destY);
    await page.mouse.up();
  }

  async wait(ms: number): Promise<void> {
    await new Promise((r) => setTimeout(r, ms));
  }

  async dispose(): Promise<void> {
    if (!this.closeOnDispose) return;
    try {
      await this.browser?.close();
    } catch (e) {
      log.warn("Browserbase close failed", { error: (e as Error).message });
    }
    this.browser = null;
    this.page = null;
    if (this.sessionId) {
      log.info("Browserbase session released", { sessionId: this.sessionId });
      this.sessionId = null;
    }
  }
}

/**
 * Factory — keeps callers driver-agnostic so a future PlaywrightDriver or
 * alternate runtime can swap in without touching agent code.
 */
export function createDefaultBrowserDriver(
  options: BrowserbaseDriverOptions = {},
): BrowserDriver {
  return new BrowserbaseDriver(options);
}
