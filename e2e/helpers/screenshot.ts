/**
 * Journey screenshot capture (ROADMAP F7 / FACTORY_STANDARD §6 — "see what the
 * user sees").
 *
 * DOM assertions prove a selector matched. They do not prove the screen the
 * user actually gets is populated, styled, on-brand, or free of a stuck spinner
 * — a page can satisfy every `toBeVisible()` in the suite and still be visibly
 * broken. These PNGs exist so the deep-audit lens and the readiness auditors
 * have real artifacts to LOOK at, on both the FUNCTIONAL and the DESIGN axis.
 *
 * Captures at BOTH widths F7 requires (desktop + mobile), since the design bar
 * applies to a mobile-first audience.
 *
 * Determinism matters because these are committed: animations are frozen, the
 * caret is hidden, and we wait for fonts to settle, so re-running the suite on
 * an unchanged app does not produce a diff for its own sake.
 */
import path from "node:path";
import type { Page } from "@playwright/test";

/** Committed artifact directory — read by the F7 preflight guard (GATE 1c). */
export const SCREENSHOT_DIR = path.join("e2e", "__screenshots__");

const WIDTHS = [
  { label: "desktop", width: 1280, height: 800 },
  { label: "mobile", width: 390, height: 844 },
] as const;

/**
 * Capture `name` at both widths.
 *
 * `name` should identify the journey STEP, not just the route — F7 wants the
 * steps of a flow, not only its landing pages (e.g. "signup-form" vs
 * "signup-submitted").
 *
 * Never throws: a capture failure must not turn a passing functional journey
 * red. The artifacts are evidence for a human/vision review, not an assertion —
 * the preflight F7 guard is what fails when they are missing.
 */
/**
 * Every wait inside a capture is HARD-BOUNDED, and this is not defensive
 * padding — an unbounded one already failed CI.
 *
 * The first version settled with `waitForLoadState("networkidle")`, whose own
 * default timeout (30s) is the SAME as Playwright's per-test timeout. On the
 * public pages that is invisible: nothing polls, so networkidle resolves at
 * once. On the AUTHED screens it never settles — the dashboard polls
 * `/api/billing/status` — so two captures per step consumed the entire test
 * budget and timed out `onboarding starts without error` outright. `.catch()`
 * does not help: a wait that is still PENDING never rejects.
 *
 * So the rule is: evidence capture gets a small, fixed slice of the budget and
 * shoots whatever is on screen when it expires. A slightly-early screenshot is
 * a far better outcome than a red journey.
 */
const SETTLE_MS = 1_500;
const FONTS_MS = 1_000;

/** Resolve `p`, or give up after `ms`. Never rejects, never stays pending. */
function bounded<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([
    p.catch(() => undefined),
    new Promise<undefined>((resolve) => {
      setTimeout(resolve, ms);
    }),
  ]);
}

export async function captureJourneyStep(page: Page, name: string): Promise<void> {
  const original = page.viewportSize();
  try {
    for (const { label, width, height } of WIDTHS) {
      await page.setViewportSize({ width, height });
      // Let the layout settle at the new width — bounded; see above.
      await bounded(page.waitForLoadState("networkidle", { timeout: SETTLE_MS }), SETTLE_MS);
      await bounded(
        page.evaluate(() => document.fonts?.ready.then(() => undefined)),
        FONTS_MS,
      );
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `${name}-${label}.png`),
        fullPage: true,
        animations: "disabled",
        caret: "hide",
        scale: "css",
        timeout: 10_000,
      });
    }
  } catch {
    // Evidence capture is best-effort — see the doc comment above.
  } finally {
    if (original) await page.setViewportSize(original).catch(() => {});
  }
}
