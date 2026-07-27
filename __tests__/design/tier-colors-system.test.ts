import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { TIER_COLORS, TIER_LABELS, type PriceTier } from "@/lib/utils/tier-colors";

/**
 * Two guards on the price-tier palette (lib/utils/tier-colors.ts).
 *
 * 1. SYSTEM-ONLY. The palette previously used emerald → blue → purple: three
 *    unrelated Tailwind accent families on the flagship focus surface, which is
 *    two distinct VISION.md design-bar violations at once ("purple-gradient-on-
 *    white slop", "three competing accent colors"). This asserts the palette
 *    resolves entirely to design-system tokens.
 *
 * 2. CONTRAST, COMPUTED — NOT TRANSCRIBED. Ratios are calculated here from the
 *    token values parsed out of app/globals.css, so a token edit re-runs the
 *    math instead of leaving a stale number in a comment.
 *
 * SCOPE, stated plainly: guard 1 covers lib/utils/tier-colors.ts only — it is
 * NOT a repo-wide off-system-colour ratchet, and does not claim one exists.
 *
 * Guard 2 covers the surfaces this palette renders on TODAY. Those tints are
 * READ OUT OF the consumer rather than hardcoded here, because a hand-written
 * list silently goes stale: an earlier version of this file enumerated
 * muted/20, /40 and /50 and missed `bg-muted/30`, which is the background of
 * the mobile-card tier badge — a surface the doc comment explicitly claimed to
 * cover. Every `bg-muted/NN` the consumer actually uses is now composited over
 * BOTH plausible bases (`--background`, `--card`), in light and dark. It is
 * still not a claim about surfaces the palette does not currently render on.
 */

const ROOT = path.resolve(__dirname, "../..");
const GLOBALS = fs.readFileSync(path.join(ROOT, "app/globals.css"), "utf8");
const CONSUMER = "app/projects/[projectId]/rooms/[roomId]/focus/page.tsx";
const CONSUMER_SOURCE = fs.readFileSync(path.join(ROOT, CONSUMER), "utf8");

/** Tailwind palette families that are NOT part of the warm-editorial system. */
const OFF_SYSTEM_FAMILY =
  /\b(?:bg|text|border|ring|from|to|via)-(purple|violet|indigo|fuchsia|emerald|blue|sky|cyan|teal|green|pink|rose|amber|yellow|lime|orange)-\d{2,3}\b/;

// ── token parsing ────────────────────────────────────────────────────────────
// globals.css declares light tokens in `:root` and dark overrides under `.dark`.
// Read the LAST occurrence before the `.dark` block for light, and the value
// inside `.dark` for dark, so a token declared in both resolves correctly.
//
// The dark region is bounded at `.dark`'s own closing brace, not at end-of-file:
// an unbounded slice would let ANY later rule that happens to redeclare one of
// these custom properties (a print block, a scoped override) win the
// `matches.at(-1)` and be measured as if it were the dark-mode value — a silent
// wrong number rather than an error.
const DARK_AT = GLOBALS.indexOf(".dark {");
const DARK_END = GLOBALS.indexOf("\n}", DARK_AT);

function token(name: string, mode: "light" | "dark"): string {
  const region =
    mode === "light" ? GLOBALS.slice(0, DARK_AT) : GLOBALS.slice(DARK_AT, DARK_END);
  const matches = [...region.matchAll(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`, "g"))];
  const found = matches.at(-1)?.[1];
  if (!found) throw new Error(`globals.css: --${name} not found for ${mode} mode`);
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

/** Tailwind's `/NN` opacity modifier composites the tint over an opaque base. */
function composite(tint: RGB, alpha: number, base: RGB): RGB {
  return tint.map((c, i) => Math.round(c * alpha + base[i] * (1 - alpha))) as RGB;
}

/** WCAG 2.1 AA for normal-size text. */
const AA_NORMAL_TEXT = 4.5;

/**
 * Resolve a tier's `text` class to the globals.css custom property it reads.
 *
 * DERIVED from the palette, never hardcoded: a lookup table here would keep
 * measuring the old token after someone edited TIER_COLORS, and the guard would
 * pass while the rendered colour went unmeasured. In this system the Tailwind
 * text utility and the CSS variable share a name (`text-muted-foreground` →
 * `--muted-foreground`), so the class IS the token.
 */
function textToken(tier: PriceTier): string {
  const cls = TIER_COLORS[tier].text.split(/\s+/).find((c) => c.startsWith("text-"));
  if (!cls) throw new Error(`${tier}.text has no text-* class: "${TIER_COLORS[tier].text}"`);
  return cls.slice("text-".length);
}

/**
 * The `bg-muted/NN` tints the CONSUMER actually uses, read from its source so
 * the enumeration cannot drift from the UI. Hardcoding this list is what let
 * `bg-muted/30` (the mobile-card badge wrapper) go unmeasured.
 */
function consumerMutedTints(): number[] {
  const pcts = new Set<number>();
  for (const m of CONSUMER_SOURCE.matchAll(/\bbg-muted\/(\d{1,3})\b/g)) {
    pcts.add(Number(m[1]));
  }
  return [...pcts].sort((a, b) => a - b);
}

/** Every surface the palette renders on today — see the SCOPE note above. */
function surfaces(mode: "light" | "dark"): Record<string, RGB> {
  const muted = parseHex(token("muted", mode));
  const out: Record<string, RGB> = {};
  for (const baseName of ["background", "card"] as const) {
    const base = parseHex(token(baseName, mode));
    // Untinted: table body rows (`bg-background`) and the outline badge, which
    // has no fill of its own.
    out[baseName] = base;
    for (const pct of consumerMutedTints()) {
      out[`muted/${pct} over ${baseName}`] = composite(muted, pct / 100, base);
    }
  }
  return out;
}

describe("price-tier palette — design system", () => {
  it("uses only design-system tokens (no off-system Tailwind palette families)", () => {
    const offSystem: string[] = [];
    for (const [tier, variants] of Object.entries(TIER_COLORS)) {
      for (const [key, value] of Object.entries(variants)) {
        const hit = value.match(OFF_SYSTEM_FAMILY);
        if (hit) offSystem.push(`${tier}.${key}: "${value}" → ${hit[0]}`);
      }
    }
    expect(offSystem, offSystem.join("\n")).toEqual([]);
  });

  it("still detects an off-system colour (the scan is not vacuous)", () => {
    // A regex that quietly stops matching would pass forever. Prove it fires on
    // the exact strings this change removed.
    expect(OFF_SYSTEM_FAMILY.test("text-purple-700 dark:text-purple-400")).toBe(true);
    expect(OFF_SYSTEM_FAMILY.test("bg-emerald-50 dark:bg-emerald-950/40")).toBe(true);
    expect(OFF_SYSTEM_FAMILY.test("border-blue-200 dark:border-blue-800")).toBe(true);
    // …and does not fire on the system tokens that replaced them.
    expect(OFF_SYSTEM_FAMILY.test("text-accent-warm-strong border-border")).toBe(false);
    expect(OFF_SYSTEM_FAMILY.test("text-muted-foreground")).toBe(false);
  });

  it("reads one hue family — no third competing accent", () => {
    // The ladder is muted → warm accent → ink. Exactly one entry may carry an
    // accent; the other two are neutral. This is the property VISION.md's
    // "three competing accent colors" rule is actually about, so assert it
    // directly rather than trusting the palette-family regex to imply it.
    const accented = Object.values(TIER_COLORS).filter((v) => v.text.includes("accent"));
    expect(accented).toHaveLength(1);
    expect(TIER_COLORS.balanced.text).toContain("accent-warm");
  });

  it("keeps a label for every tier", () => {
    for (const tier of Object.keys(TIER_COLORS) as PriceTier[]) {
      expect(TIER_LABELS[tier], `no label for ${tier}`).toBeTruthy();
    }
  });
});

describe("price-tier palette — computed contrast", () => {
  for (const mode of ["light", "dark"] as const) {
    it(`clears WCAG AA on every surface it renders on (${mode})`, () => {
      const surfaceMap = surfaces(mode);
      // Guard the enumeration itself. It is derived, so assert it found the
      // real tints rather than silently degrading to the two opaque bases —
      // and pin the one that was missed before, so a regex that stops matching
      // it cannot pass as "nothing to measure".
      const tints = consumerMutedTints();
      expect(tints.length, `no bg-muted/NN found in ${CONSUMER}`).toBeGreaterThanOrEqual(4);
      expect(tints, "the mobile-card badge tint must be measured").toContain(30);
      expect(Object.keys(surfaceMap)).toHaveLength(2 * (1 + tints.length));

      const failures: string[] = [];
      for (const tier of Object.keys(TIER_COLORS) as PriceTier[]) {
        const tokenName = textToken(tier);
        const fg = parseHex(token(tokenName, mode));
        for (const [surfaceName, bg] of Object.entries(surfaceMap)) {
          const ratio = contrastRatio(fg, bg);
          if (ratio < AA_NORMAL_TEXT) {
            failures.push(`${tier} (--${tokenName}) on ${surfaceName}: ${ratio.toFixed(2)}:1`);
          }
        }
      }
      expect(failures, `below ${AA_NORMAL_TEXT}:1 —\n${failures.join("\n")}`).toEqual([]);
    });
  }

  it("the contrast math is correct on known reference pairs", () => {
    // Black on white is exactly 21:1 and white on white exactly 1:1 — if the
    // luminance implementation drifts, these move before any token does.
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    expect(contrastRatio([255, 255, 255], [255, 255, 255])).toBeCloseTo(1, 5);
    // A 50% composite of black over white is mid-grey.
    expect(composite([0, 0, 0], 0.5, [255, 255, 255])).toEqual([128, 128, 128]);
  });

  it("would FAIL a token that does not clear AA (the gate has teeth)", () => {
    // Prove the assertion can fail: the plain `--accent-warm` at 30% opacity
    // over the page background is nowhere near the floor.
    const faint = composite(parseHex(token("accent-warm", "light")), 0.3, parseHex(token("background", "light")));
    expect(contrastRatio(faint, parseHex(token("background", "light")))).toBeLessThan(AA_NORMAL_TEXT);
  });
});
