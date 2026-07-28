import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  VERDICT_LABELS,
  VERDICT_COLORS,
  getScoreColor,
  getScoreBgColor,
  getScoreSurface,
} from "@/lib/scoring/verdicts";
import type { Verdict } from "@/lib/types/scoring";

/**
 * These pure lookups drive what the user SEES on every scored item: the verdict
 * chip, the 0–10 score colour, the score bar and the scorecard surface.
 *
 * Three guards:
 *
 * 1. BANDS. The exact threshold boundaries (≥8 excellent, ≥6 fair, else poor)
 *    are pinned so a refactor can't silently shift a score into the wrong band —
 *    an 8.0 must read "best", not "middle" — plus map completeness, so a new
 *    Verdict enum value can't ship without a label and a colour.
 *
 * 2. SYSTEM-ONLY. The palette used to be a traffic light: emerald → green →
 *    amber → red on the chip and emerald → amber → rose on the score, with a
 *    third emerald → blue → amber ladder inlined in ManualScorecardView. That is
 *    the "three competing accent colors" VISION.md names as slop, none of it
 *    from the warm-editorial token system. This asserts BOTH the exported values
 *    and the two source files resolve entirely to design-system tokens.
 *
 * 3. CONTRAST, COMPUTED — NOT TRANSCRIBED. Ratios are calculated here from the
 *    token values parsed out of app/globals.css, against the surfaces these
 *    colours actually render on, in light AND dark. A token edit re-runs the
 *    math instead of leaving a stale number in a comment. The `bg-muted/NN`
 *    tints are READ OUT OF the consumers rather than hardcoded, because a
 *    hand-written list goes stale silently (that is how `bg-muted/30` once went
 *    unmeasured in the sibling tier-colours guard).
 *
 * SCOPE, stated plainly: guard 2 covers lib/scoring/verdicts.ts and
 * components/manual-sourcing/ManualScorecardView.tsx only. It is NOT a repo-wide
 * off-system-colour ratchet and does not claim one exists. The WCAG helpers
 * below are deliberately local, mirroring the convention in
 * __tests__/design/tier-colors-system.test.ts; factoring the two copies into one
 * shared module is worthwhile follow-up, not something this change did.
 */

const ROOT = path.resolve(__dirname, "../..");
const GLOBALS = fs.readFileSync(path.join(ROOT, "app/globals.css"), "utf8");

const PALETTE_SOURCE = "lib/scoring/verdicts.ts";
/** Every file that reads a colour out of this module. */
const CONSUMERS = [
  "components/ui/score-display.tsx",
  "components/manual-sourcing/ManualScorecardView.tsx",
  "app/picks/page.tsx",
  "app/projects/[projectId]/rooms/[roomId]/focus/page.tsx",
  "app/projects/[projectId]/rooms/[roomId]/bundles/page.tsx",
  "app/projects/[projectId]/rooms/[roomId]/compare/page.tsx",
  "app/projects/[projectId]/rooms/[roomId]/products/page.tsx",
];

const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

/** Tailwind palette families that are NOT part of the warm-editorial system. */
const OFF_SYSTEM_FAMILY =
  /\b(?:bg|text|border|ring|from|to|via)-(purple|violet|indigo|fuchsia|emerald|blue|sky|cyan|teal|green|pink|rose|red|slate|gray|grey|zinc|neutral|stone|pink|amber|yellow|lime|orange)-\d{2,3}\b/g;

const ALL_VERDICTS: Verdict[] = ["strong_yes", "yes", "maybe", "no"];

// ── token parsing ────────────────────────────────────────────────────────────
// globals.css declares light tokens in `:root` and dark overrides under `.dark`.
// The dark region is bounded at `.dark`'s own closing brace, not end-of-file, so
// a later rule that redeclares one of these properties can't be measured as if
// it were the dark-mode value.
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

const parseHex = (hex: string): RGB =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as RGB;

function channelLuminance(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

const relativeLuminance = ([r, g, b]: RGB): number =>
  0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);

function contrastRatio(fg: RGB, bg: RGB): number {
  const a = relativeLuminance(fg);
  const b = relativeLuminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/** Tailwind's `/NN` opacity modifier composites the tint over an opaque base. */
const composite = (tint: RGB, alpha: number, base: RGB): RGB =>
  tint.map((c, i) => Math.round(c * alpha + base[i] * (1 - alpha))) as RGB;

/** WCAG 2.1 AA for normal-size text — the chips render at 10–12px, so no relief. */
const AA_NORMAL_TEXT = 4.5;

/**
 * `text-<token>` and `bg-<token>` in this system share a name with the CSS
 * custom property, so the class IS the token. Resolving it here (rather than via
 * a lookup table) means an edit to the palette re-measures the NEW colour; a
 * table would keep measuring the old one and pass while the UI went unchecked.
 */
function classToken(classes: string, prefix: "text-" | "bg-" | "border-"): string | null {
  const cls = classes.split(/\s+/).find((c) => c.startsWith(prefix));
  if (!cls) return null;
  const bare = cls.slice(prefix.length);
  return bare === "transparent" ? null : bare.split("/")[0];
}

/** The `/NN` alpha on a class, or 1 when it carries none. */
function classAlpha(classes: string, prefix: "text-" | "bg-"): number {
  const cls = classes.split(/\s+/).find((c) => c.startsWith(prefix));
  const pct = cls?.split("/")[1];
  return pct ? Number(pct) / 100 : 1;
}

/**
 * Every `bg-muted/NN` tint the CONSUMERS actually render score colours on, read
 * out of their source so the enumeration cannot drift from the UI.
 */
function consumerMutedTints(): number[] {
  const pcts = new Set<number>();
  for (const rel of CONSUMERS) {
    for (const m of read(rel).matchAll(/\bbg-muted\/(\d{1,3})\b/g)) pcts.add(Number(m[1]));
  }
  return [...pcts].sort((a, b) => a - b);
}

/** Opaque surfaces a score colour can land on today. */
function surfaces(mode: "light" | "dark"): Record<string, RGB> {
  const muted = parseHex(token("muted", mode));
  const out: Record<string, RGB> = {};
  for (const baseName of ["background", "card"] as const) {
    const base = parseHex(token(baseName, mode));
    out[baseName] = base;
    out[`muted over ${baseName}`] = muted;
    for (const pct of consumerMutedTints()) {
      out[`muted/${pct} over ${baseName}`] = composite(muted, pct / 100, base);
    }
  }
  return out;
}

// ── 1. bands + completeness ──────────────────────────────────────────────────

describe("verdict maps", () => {
  it("has a human label for every Verdict value", () => {
    for (const v of ALL_VERDICTS) {
      expect(VERDICT_LABELS[v]).toBeTruthy();
      expect(typeof VERDICT_LABELS[v]).toBe("string");
    }
    expect(Object.keys(VERDICT_LABELS).sort()).toEqual([...ALL_VERDICTS].sort());
  });

  it("has a colour class set for every Verdict value", () => {
    for (const v of ALL_VERDICTS) expect(VERDICT_COLORS[v]).toBeTruthy();
    expect(Object.keys(VERDICT_COLORS).sort()).toEqual([...ALL_VERDICTS].sort());
  });

  it("gives each verdict a visually DISTINCT rung of the ladder", () => {
    // The chip is the only ordering signal when the four labels are scanned as a
    // column, so no two may resolve to the same treatment.
    const seen = new Set(ALL_VERDICTS.map((v) => VERDICT_COLORS[v]));
    expect(seen.size).toBe(ALL_VERDICTS.length);
  });
});

describe("getScoreColor — text colour by score band", () => {
  it("returns the top rung at and above 8", () => {
    for (const s of [8, 8.0, 9.5, 10]) expect(getScoreColor(s)).toBe("text-foreground");
  });

  it("returns the middle rung in [6, 8)", () => {
    for (const s of [6, 7, 7.999]) expect(getScoreColor(s)).toBe("text-accent-warm-strong");
  });

  it("returns the bottom rung below 6", () => {
    for (const s of [5.999, 0, -3]) expect(getScoreColor(s)).toBe("text-muted-foreground");
  });

  it("pins the exact boundaries (8 and 6 flip the band)", () => {
    // 7.999 → middle, 8 → top: the excellent cutoff is inclusive at 8.
    expect(getScoreColor(7.999)).not.toEqual(getScoreColor(8));
    // 5.999 → bottom, 6 → middle: the fair cutoff is inclusive at 6.
    expect(getScoreColor(5.999)).not.toEqual(getScoreColor(6));
  });

  it("treats a large or NaN score deterministically (never throws)", () => {
    expect(getScoreColor(1000)).toBe("text-foreground");
    // NaN fails every >= comparison and falls through to the bottom rung, which
    // is the safe default: an unknown score should recede, not read as the best.
    expect(getScoreColor(Number.NaN)).toBe("text-muted-foreground");
  });
});

describe("getScoreBgColor / getScoreSurface — same bands as the text colour", () => {
  it("tracks the text bands exactly", () => {
    for (const s of [10, 8, 7.999, 6, 5.999, 0, Number.NaN]) {
      // Same band boundaries in all three, so a bar can never disagree with the
      // number printed next to it.
      const band = (f: (n: number) => string) => f(s);
      expect([band(getScoreColor), band(getScoreBgColor), band(getScoreSurface)]).toEqual(
        [getScoreColor(s), getScoreBgColor(s), getScoreSurface(s)]
      );
    }
    expect(getScoreBgColor(8)).toBe("bg-foreground");
    expect(getScoreBgColor(7.999)).toBe("bg-accent-warm");
    expect(getScoreBgColor(5.999)).toBe("bg-muted-foreground");
    expect(getScoreBgColor(Number.NaN)).toBe("bg-muted-foreground");
  });

  it("moves the surface with the band and never repeats a rung", () => {
    const rungs = [getScoreSurface(9), getScoreSurface(7), getScoreSurface(3)];
    expect(new Set(rungs).size).toBe(3);
    expect(getScoreSurface(Number.NaN)).toBe(getScoreSurface(0));
  });
});

// ── 2. system-only ───────────────────────────────────────────────────────────

describe("scoring palette — design system", () => {
  it("exports only design-system tokens (no off-system Tailwind families)", () => {
    const values = [
      ...Object.values(VERDICT_COLORS),
      ...[10, 7, 3, Number.NaN].flatMap((s) => [
        getScoreColor(s),
        getScoreBgColor(s),
        getScoreSurface(s),
      ]),
    ];
    const offSystem = values.filter((v) => new RegExp(OFF_SYSTEM_FAMILY.source).test(v));
    expect(offSystem).toEqual([]);
  });

  it("keeps the palette module and the scorecard surface free of raw palette hues", () => {
    // ManualScorecardView is included because it INLINED its own third ladder
    // (emerald → blue → amber) rather than consuming this module — the exact
    // regression this guard exists to stop recurring.
    for (const rel of [PALETTE_SOURCE, "components/manual-sourcing/ManualScorecardView.tsx"]) {
      const hits = [...read(rel).matchAll(OFF_SYSTEM_FAMILY)].map((m) => m[0]);
      expect(hits, `${rel} uses off-system Tailwind palette utilities`).toEqual([]);
    }
  });
});

// ── 3. contrast, computed ────────────────────────────────────────────────────

describe("scoring palette — contrast (computed from globals.css)", () => {
  for (const mode of ["light", "dark"] as const) {
    it(`score text clears WCAG AA on every surface it renders on (${mode})`, () => {
      const failures: string[] = [];
      for (const score of [10, 7, 3]) {
        const fg = parseHex(token(getScoreColor(score).slice("text-".length), mode));
        for (const [name, bg] of Object.entries(surfaces(mode))) {
          const ratio = contrastRatio(fg, bg);
          if (ratio < AA_NORMAL_TEXT) {
            failures.push(`score ${score} on ${name}: ${ratio.toFixed(2)}:1`);
          }
        }
      }
      expect(failures).toEqual([]);
    });

    it(`every verdict chip clears WCAG AA against its OWN fill (${mode})`, () => {
      // Each chip carries its own background, so it is measured against that —
      // composited over both plausible bases when the fill is tinted or absent.
      const failures: string[] = [];
      for (const v of ALL_VERDICTS) {
        const classes = VERDICT_COLORS[v];
        const fgToken = classToken(classes, "text-");
        if (!fgToken) throw new Error(`${v} has no text-* class`);
        const fg = parseHex(token(fgToken, mode));
        const bgToken = classToken(classes, "bg-");
        const alpha = classAlpha(classes, "bg-");

        for (const baseName of ["background", "card"] as const) {
          const base = parseHex(token(baseName, mode));
          // bg-transparent → the chip shows the surface underneath.
          const bg = bgToken
            ? composite(parseHex(token(bgToken, mode)), alpha, base)
            : base;
          const ratio = contrastRatio(fg, bg);
          if (ratio < AA_NORMAL_TEXT) {
            failures.push(`${v} over ${baseName}: ${ratio.toFixed(2)}:1`);
          }
        }
      }
      expect(failures).toEqual([]);
    });
  }
});
