import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Guards `text-accent-warm-strong` on a `bg-accent-warm/N` TINTED pill — the
 * shared shape behind `Badge variant="warm"` (components/ui/badge.tsx) and the
 * `warm-outline`/`warm-ghost` Button variants (components/ui/button.tsx),
 * plus several hand-rolled pills across app/.
 *
 * WHY THIS IS A SEPARATE FILE FROM warm-cta-contrast.test.ts — that file
 * guards a label on a SOLID/gradient warm FILL (`--accent-warm-on-solid`).
 * This one guards a label on a TINTED (semi-transparent) warm surface
 * (`--accent-warm-strong`), which is a genuinely different composite: the
 * "background" the text sits on is itself `accent-warm` alpha-blended over
 * whatever real surface (page background, card, elevated card, muted panel)
 * the pill happens to render on — so the pill's OWN contrast depends on where
 * it is placed, unlike a solid fill.
 *
 * Filed as issue #711 after a token-only fix was measured against just
 * `--background` and shipped a value that failed against `--card` (4.28:1 at
 * 15% tint) and `--surface-elevated` (4.00:1) — the surfaces this pill
 * actually renders on throughout the app. This test measures every
 * (surface) x (tint the codebase actually uses) combination explicitly,
 * rather than one spot check, so a future token change can't repeat that.
 *
 * TINT-ON-TINT IS A SEPARATE, UNMEASURABLE CASE. A pill nested inside another
 * translucent panel (e.g. `bg-accent-warm/15` inside a `bg-primary/5` div)
 * composites TWO alpha layers, which this single-surface model does not
 * capture — issue #711's worst measured failure (3.53:1) was exactly that
 * shape, on the /focus page. The fix there was structural, not a token value:
 * give the nested pill's container a SOLID background instead, so no real
 * composite in the app is ever more than one alpha layer deep. This test
 * cannot verify "no tint stacks on a tint" — that is a source-level property,
 * not a colour-math one — so the /focus fix is a review-verified structural
 * change, not something this file re-checks. What this file DOES continue to
 * guard is that the single-layer case, which the destacking fix reduces every
 * real pill down to, actually clears AA.
 */

const ROOT = path.resolve(__dirname, "../..");
const GLOBALS = fs.readFileSync(path.join(ROOT, "app/globals.css"), "utf8");

// ── token parsing, anchored to :root{} / .dark{} — NOT a whole-file scan ────
// A later rule redeclaring one of these custom properties (e.g. a
// `@media (prefers-contrast: more)` block) must not be silently read as the
// mode's real value. Mirrors warm-cta-contrast.test.ts / assessment-colors.test.ts.
const ROOT_AT = GLOBALS.indexOf(":root {");
const ROOT_END = GLOBALS.indexOf("\n}", ROOT_AT);
const DARK_AT = GLOBALS.indexOf(".dark {");
const DARK_END = GLOBALS.indexOf("\n}", DARK_AT);

type Mode = "light" | "dark";

function token(name: string, mode: Mode): string {
  const region =
    mode === "light" ? GLOBALS.slice(ROOT_AT, ROOT_END) : GLOBALS.slice(DARK_AT, DARK_END);
  const matches = [...region.matchAll(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`, "g"))];
  const found = matches.at(-1)?.[1];
  if (!found) throw new Error(`globals.css: --${name} not found for ${mode} mode (anchored scan)`);
  return found;
}

// ── WCAG 2.1 relative luminance + contrast ratio ─────────────────────────────
type RGB = [number, number, number];

function parseHex(hex: string): RGB {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as RGB;
}

function channelLuminance(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance([r, g, b]: RGB): number {
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

function contrastRatio(fg: RGB, bg: RGB): number {
  const a = relativeLuminance(fg);
  const b = relativeLuminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/** Alpha-composite `fg` over `bg` (both opaque sRGB), as a browser would. */
function alphaComposite(fg: RGB, bg: RGB, alpha: number): RGB {
  return fg.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha))) as RGB;
}

const AA_NORMAL_TEXT = 4.5;

/**
 * The real tint percentages the codebase renders this pill at:
 * `Badge variant="warm"` and the /focus style-name pill use /15;
 * `warm-outline`/`warm-ghost`'s hover state and several hand-rolled pills use
 * /10; the lightest hand-rolled instances use /5. All three are in scope
 * because the token has to hold on whichever one a given pill uses.
 */
const TINTS = [0.05, 0.1, 0.15];

/**
 * Every real (non-stacked) surface this pill is placed directly on somewhere
 * in the app: the page background, a default Card, an elevated Card
 * (`variant="elevated"`), and a muted panel (the /focus fix's replacement for
 * the tint that used to stack).
 */
const SURFACES = ["background", "card", "surface-elevated", "muted"] as const;

const MODES: Mode[] = ["light", "dark"];

describe("warm pill (tinted) label contrast", () => {
  describe.each(MODES)("%s theme", (mode) => {
    const label = () => parseHex(token("accent-warm-strong", mode));
    const fill = () => parseHex(token("accent-warm", mode));

    describe.each(SURFACES)("on --%s", (surfaceName) => {
      it.each(TINTS)("clears AA at bg-accent-warm/%s", (alpha) => {
        const surface = parseHex(token(surfaceName, mode));
        const composite = alphaComposite(fill(), surface, alpha);
        const ratio = contrastRatio(label(), composite);
        expect(
          ratio,
          `--accent-warm-strong on bg-accent-warm/${Math.round(alpha * 100)} over --${surfaceName} ` +
            `is ${ratio.toFixed(2)}:1 in ${mode}`
        ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
      });
    });
  });

  it("exposes accent-warm-strong as a Tailwind utility", () => {
    const theme = GLOBALS.slice(GLOBALS.indexOf("@theme inline"), GLOBALS.indexOf("\n}"));
    expect(theme).toContain("--color-accent-warm-strong: var(--accent-warm-strong);");
  });

  it("keeps accent-warm-strong distinct from the solid-fill label token", () => {
    // A regression that pointed accent-warm-strong at accent-warm-on-solid (or
    // vice versa) would pass warm-cta-contrast.test.ts's solid-fill checks
    // while silently breaking every tinted pill, since the two tokens solve
    // different composites (solid fill vs. alpha-tinted fill).
    for (const mode of MODES) {
      expect(token("accent-warm-strong", mode)).not.toBe(token("accent-warm-on-solid", mode));
    }
  });

  // ── sanity check on the luminance model itself ───────────────────────────
  it("the contrast formula is exponent-sensitive (guards against a silently wrong sRGB curve)", () => {
    // A prior version of this style of sanity check only asserted black-on-white
    // (≈21) and white-on-white (≈1), which are BOTH invariant to the sRGB
    // exponent — mutating 2.4 → 2.2 in channelLuminance left that check green
    // (caught in review of the abandoned #711 attempt). A genuine MID-TONE pair
    // is not exponent-invariant, so this fails loudly if the curve regresses.
    const ratio = contrastRatio([255, 255, 255], [128, 128, 128]);
    // True WCAG (exponent 2.4): ≈3.95:1. A 2.2 exponent computes ≈4.28:1 — far
    // enough apart that a wrong exponent cannot pass this assertion.
    expect(ratio).toBeGreaterThan(3.9);
    expect(ratio).toBeLessThan(4.05);
  });
});

// ── structural check: the two named #711 fixes stay fixed ───────────────────
describe("warm pill de-stacking (issue #711 fixes)", () => {
  it("the /focus Design Direction panel is a SOLID surface, not a tint the pill's own tint would stack on", () => {
    const file = fs.readFileSync(
      path.join(ROOT, "app/projects/[projectId]/rooms/[roomId]/focus/page.tsx"),
      "utf8"
    );
    expect(file).toContain('bg-accent-warm/15 text-accent-warm-strong');
    // The panel wrapping the style-name pill must not carry a fractional-opacity
    // fill of its own (bg-*/N) — that is precisely the stacked composite issue
    // #711 measured at 3.53:1, well below AA, in both themes. Locate the actual
    // containing div (a few lines above the "Design Direction" heading).
    const lines = file.split("\n");
    const headingIdx = lines.findIndex((l) => l.includes("Design Direction"));
    expect(headingIdx).toBeGreaterThan(0);
    const containerLine = lines
      .slice(Math.max(0, headingIdx - 5), headingIdx)
      .find((l) => l.includes("rounded-xl border"));
    expect(containerLine, "could not locate the Design Direction panel's container div").toBeDefined();
    expect(containerLine).not.toMatch(/bg-(primary|accent-warm|accent|secondary)\/\d+/);
  });

  it("the room-photo budget-mode badge is a SOLID fill, not verifiable via any CSS-token composite", () => {
    const file = fs.readFileSync(
      path.join(ROOT, "app/projects/[projectId]/rooms/[roomId]/page.tsx"),
      "utf8"
    );
    // Renders directly over an arbitrary user photo behind a gradient scrim —
    // no surface token describes what's behind it, so it must not depend on
    // tint-over-unknown-content for its contrast.
    expect(file).toContain("bg-accent-warm text-accent-warm-on-solid border-transparent");
  });
});
