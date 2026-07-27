import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * WCAG 2.1 AA contrast for the warm accent pills (design_taste / Track F).
 *
 * `--accent-warm-strong` exists to be readable TEXT on a low-contrast tinted
 * surface — `text-accent-warm-strong` on a `bg-accent-warm/10` or `/15` pill.
 * The dark theme had it set equal to the base accent on the strength of a
 * comment claiming "5.0:1". That number was real but measured against the page
 * BACKGROUND, while the components that use it — `Badge variant="warm"` in a
 * Card, the room-overview "Next" chip, the bundles chips — sit on CARDS, where
 * it was 4.28:1, under the 4.5:1 floor.
 *
 * So this test does the thing that comment did not: it computes every
 * surface × tint pair the codebase actually renders, in BOTH themes, straight
 * from the live token values in app/globals.css. A future token edit that dips
 * any pairing below AA fails here with the offending pair named.
 *
 * Scope note: this covers the warm-accent pills specifically, not every colour
 * pairing in the app. The broad sweep is the axe run in e2e/a11y.spec.ts; this
 * is a fast deterministic guard on the one token whose safe value depends on a
 * surface the token itself cannot see.
 */

const CSS = readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");

/** WCAG 2.1 AA floor for normal-size text. These pills are text-xs. */
const AA_FLOOR = 4.5;

/** Tint alphas used with bg-accent-warm across the app (grep: /10 and /15). */
const TINTS = [0.1, 0.15] as const;

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(fg: string, bg: string): number {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

/** Composite `fg` at `alpha` over opaque `bg` — what a /10 or /15 tint renders as. */
function over(fg: string, bg: string, alpha: number): string {
  const [f, b] = [fg.replace("#", ""), bg.replace("#", "")];
  return (
    "#" +
    [0, 2, 4]
      .map((i) => {
        const v = Math.round(
          parseInt(f.slice(i, i + 2), 16) * alpha +
            parseInt(b.slice(i, i + 2), 16) * (1 - alpha),
        );
        return v.toString(16).padStart(2, "0");
      })
      .join("")
  );
}

/**
 * Reads a token's value from the light block (`:root`) or the dark block.
 *
 * Parsed from the real stylesheet rather than duplicated here: a copy would
 * happily keep passing after someone changed the actual token, which is exactly
 * the failure this test exists to prevent.
 */
function token(name: string, theme: "light" | "dark"): string {
  // The dark overrides live in the block after the light `:root` block, so the
  // last declaration wins for dark and the first for light.
  const matches = [...CSS.matchAll(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`, "g"))].map(
    (m) => m[1],
  );
  expect(matches.length, `--${name} should be declared for both themes`).toBeGreaterThanOrEqual(2);
  return theme === "light" ? matches[0] : matches[matches.length - 1];
}

type Theme = "light" | "dark";

const THEMES: Theme[] = ["light", "dark"];

describe("--accent-warm-strong clears AA on every surface it renders on", () => {
  for (const theme of THEMES) {
    for (const surface of ["background", "card"] as const) {
      it(`${theme}: plain text on --${surface}`, () => {
        const fg = token("accent-warm-strong", theme);
        const bg = token(surface, theme);
        expect(
          contrast(fg, bg),
          `${fg} on --${surface} ${bg} (${theme})`,
        ).toBeGreaterThanOrEqual(AA_FLOOR);
      });

      for (const alpha of TINTS) {
        it(`${theme}: text on a bg-accent-warm/${alpha * 100} pill over --${surface}`, () => {
          const fg = token("accent-warm-strong", theme);
          const base = token(surface, theme);
          const pill = over(token("accent-warm", theme), base, alpha);
          // This is the pairing the old dark value failed at 4.28:1 — the
          // components sit on cards, not on the page background.
          expect(
            contrast(fg, pill),
            `${fg} on ${pill} (accent-warm/${alpha * 100} over --${surface} ${base}, ${theme})`,
          ).toBeGreaterThanOrEqual(AA_FLOOR);
        });
      }
    }
  }
});

describe("contrast helpers behave", () => {
  it("computes the canonical extremes", () => {
    // Sanity-check the maths itself, so a broken helper cannot make every
    // pairing above "pass" vacuously.
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrast("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });

  it("composites a tint between its endpoints", () => {
    expect(over("#ffffff", "#000000", 0)).toBe("#000000");
    expect(over("#ffffff", "#000000", 1)).toBe("#ffffff");
  });

  it("reads the real token values, not a hardcoded copy", () => {
    // If this ever throws, the parser drifted from the stylesheet and every
    // assertion above is measuring nothing.
    expect(token("accent-warm", "light")).toMatch(/^#[0-9a-f]{6}$/i);
    expect(token("accent-warm", "dark")).not.toBe(token("accent-warm", "light"));
  });
});
