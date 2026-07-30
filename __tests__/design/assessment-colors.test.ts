import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  PRIORITY_BADGE,
  PRIORITY_ORDER,
  priorityBadge,
  ASSESSMENT_PANEL,
  CONFIDENCE_BANNER,
  CONFIDENCE_THRESHOLD,
  STEP_MARK,
  confidenceBanner,
  isHighConfidence,
  type AssessmentPriority,
} from "@/lib/utils/assessment-colors";

/**
 * Guards on the room-assessment palette (lib/utils/assessment-colors.ts), built
 * on the same three ideas as __tests__/design/tier-colors-system.test.ts:
 *
 * 1. SYSTEM-ONLY — every value resolves to a design-system token.
 * 2. CONTRAST, COMPUTED — ratios are calculated here from the token values
 *    parsed out of app/globals.css, so a token edit re-runs the maths instead
 *    of leaving a stale number in a comment.
 * 3. A CONSUMER RATCHET — every surface this palette serves is asserted to
 *    contain no off-system Tailwind palette family at all, and to actually
 *    import the palette.
 *
 * SCOPE, stated plainly: guard 3 covers exactly the files listed in CONSUMERS —
 * a ZERO bar, on the surfaces that render this palette. It is deliberately
 * stricter and narrower than the repo-wide ceiling in
 * `__tests__/design/off-system-palette-ratchet.test.ts`, which caps total
 * off-system usage everywhere but cannot demand zero (many surfaces still carry
 * raw palette utilities). The two work together: the ceiling stops new drift
 * anywhere, this one holds a hard zero where the doctrine has actually landed.
 * That drift is the failure mode which produced this palette in the first place —
 * the same `what_should_go` list was amber on /focus and rose on /saved because
 * nothing was watching.
 */

const ROOT = path.resolve(__dirname, "../..");
const GLOBALS = fs.readFileSync(path.join(ROOT, "app/globals.css"), "utf8");

/**
 * Every route that renders this palette. Kept as real paths, and asserted to
 * exist below — a renamed file must fail loudly rather than silently drop out
 * of the ratchet's coverage.
 */
const CONSUMERS = [
  "app/projects/[projectId]/rooms/[roomId]/focus/page.tsx",
  "app/projects/[projectId]/rooms/[roomId]/bundles/page.tsx",
  "app/saved/[id]/page.tsx",
  "app/shared/[token]/SharedDesignView.tsx",
  // /diagnosis is where the user FIRST meets the Keep / Replace pair, and it
  // rendered a fourth palette for it (emerald cards + amber cards) until this
  // ratchet was extended to cover it. The scene-coverage card renders inside
  // that same card stack and carried the matching emerald/amber pair.
  "app/projects/[projectId]/rooms/[roomId]/diagnosis/page.tsx",
  "components/rooms/scene-coverage-card.tsx",
];

/**
 * Tailwind palette families that are NOT part of the warm-editorial system.
 *
 * The utility prefix list includes the DIRECTIONAL border variants
 * (`border-l-…`, `border-t-…`) deliberately: without them this regex did not
 * match `border-l-amber-400`, which is exactly the class the /diagnosis issue
 * rails and the identified-product pill used. A guard that cannot see the
 * class the violation is written in reports clean while the violation ships.
 */
const OFF_SYSTEM_FAMILY =
  /\b(?:bg|text|border|border-[lrtbxy]|ring|from|to|via|fill|stroke|divide|outline|decoration)-(purple|violet|indigo|fuchsia|emerald|blue|sky|cyan|teal|green|pink|rose|amber|yellow|lime|orange|slate|gray|zinc|neutral|stone)-\d{2,3}\b/;

// ── token parsing ────────────────────────────────────────────────────────────
// globals.css declares light tokens in `:root` and dark overrides under `.dark`.
// The dark region is bounded at `.dark`'s own closing brace, not end-of-file, so
// a later rule that happens to redeclare one of these custom properties cannot
// be measured as if it were the dark-mode value.
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
 * DERIVE the token a `text-*` class reads, never hardcode it: a lookup table
 * would keep measuring the old token after someone edited the palette, and the
 * guard would pass while the rendered colour went unmeasured. In this system
 * the Tailwind text utility and the CSS variable share a name
 * (`text-muted-foreground` → `--muted-foreground`), so the class IS the token.
 */
function textToken(classes: string): string {
  const cls = classes.split(/\s+/).find((c) => c.startsWith("text-"));
  if (!cls) throw new Error(`no text-* class in "${classes}"`);
  return cls.slice("text-".length);
}

/**
 * DERIVE the background a class string paints, as either an opaque token or a
 * `token/NN` tint. Returns null when the string paints no background of its own
 * (the caller then measures against the page/card bases).
 */
function bgSpec(classes: string): { name: string; alpha: number } | null {
  const cls = classes.split(/\s+/).find((c) => c.startsWith("bg-"));
  if (!cls) return null;
  const body = cls.slice("bg-".length);
  const [name, pct] = body.split("/");
  return { name, alpha: pct === undefined ? 1 : Number(pct) / 100 };
}

/**
 * The tinted WRAPPERS the consumers nest these palettes inside, read out of
 * their source.
 *
 * This exists because a flat "tint over card" model is not what actually
 * renders. `app/saved/[id]/page.tsx` wraps each priority row in a
 * `bg-muted/50` div inside a `bg-card` Card, so a translucent palette surface
 * there composites TWICE. Measured directly on the card, an `accent-warm/10`
 * pill reads 4.61:1 in dark mode and passes; measured on the surface it really
 * lands on it reads 4.49:1 and fails. A guard that never asks the nested
 * question would have reported the passing number while the failing one shipped.
 *
 * Derived from the consumer sources rather than hand-listed, for the same
 * reason the tier-colors guard derives its tints: a hand-written list silently
 * goes stale the moment someone adds a wrapper.
 *
 * SCOPE, and its one known limit:
 *
 * The scan covers the neutral surface families (muted / card / secondary)
 * written as literal classes in the consumer files. It does NOT cover
 * `bg-accent/50` and `bg-accent/30` in focus/page.tsx — those use `--accent`,
 * a neutral hover/highlight token entirely unrelated to the palette's
 * `--accent-warm`, and neither wraps a palette surface (checked: the active
 * progress step row and the rotating status row contain none of these classes).
 *
 * What it also cannot see is a base introduced by a COMPONENT the consumer
 * renders rather than by the consumer's own source — `<Card variant="elevated">`
 * swaps `bg-card` for `bg-surface-elevated` from inside components/ui/card.tsx,
 * and bundles/page.tsx renders the Keep/Replace panels inside exactly that. A
 * regex over the consumer file can never find it. `surface-elevated` is
 * therefore added to the flat bases below by name; a future component-supplied
 * base would need the same treatment.
 */
function wrapperTints(mode: "light" | "dark"): Array<{ label: string; rgb: RGB }> {
  const found = new Set<string>();
  for (const relPath of CONSUMERS) {
    const source = fs.readFileSync(path.join(ROOT, relPath), "utf8");
    for (const m of source.matchAll(/\bbg-(muted|card|secondary)\/(\d{1,3})\b/g)) {
      found.add(`${m[1]}/${m[2]}`);
    }
  }
  const out: Array<{ label: string; rgb: RGB }> = [];
  for (const spec of [...found].sort()) {
    const [name, pct] = spec.split("/");
    for (const baseName of ["background", "card"] as const) {
      out.push({
        label: `${spec} over ${baseName}`,
        rgb: composite(parseHex(token(name, mode)), Number(pct) / 100, parseHex(token(baseName, mode))),
      });
    }
  }
  return out;
}

/**
 * Resolve one (foreground classes, background classes) pair into every surface
 * it can actually land on: the two opaque bases (page and card), plus every
 * tinted wrapper the consumers nest content inside.
 *
 * An OPAQUE palette fill short-circuits all of this — whatever is underneath is
 * painted over, so it is measured exactly once. That is not a shortcut, it is
 * the reason the priority pill uses opaque fills: nesting cannot reach them.
 */
function surfacesFor(bg: ReturnType<typeof bgSpec>, mode: "light" | "dark"): Record<string, RGB> {
  const out: Record<string, RGB> = {};

  if (bg !== null && bg.alpha === 1) {
    out[bg.name] = parseHex(token(bg.name, mode));
    return out;
  }

  const bases: Array<{ label: string; rgb: RGB }> = [
    { label: "background", rgb: parseHex(token("background", mode)) },
    { label: "card", rgb: parseHex(token("card", mode)) },
    // `<Card variant="elevated">` in bundles/page.tsx paints this instead of
    // --card, and the Keep/Replace panels render inside it. It is opaque and
    // has one value per mode, so it is a base, not a tint.
    { label: "surface-elevated", rgb: parseHex(token("surface-elevated", mode)) },
    ...wrapperTints(mode),
  ];

  for (const base of bases) {
    if (bg === null) {
      out[base.label] = base.rgb;
    } else {
      out[`${bg.name}/${Math.round(bg.alpha * 100)} over ${base.label}`] = composite(
        parseHex(token(bg.name, mode)),
        bg.alpha,
        base.rgb,
      );
    }
  }
  return out;
}

/**
 * Every foreground/background pair this palette renders, named. Backgrounds are
 * READ OUT OF the palette rather than hand-listed, so the enumeration cannot
 * drift from what ships.
 */
function pairs(): Array<{ label: string; fg: string; bg: string | null }> {
  return [
    // Priority pill — fg and bg both live in the same class string.
    ...(Object.keys(PRIORITY_BADGE) as AssessmentPriority[]).map((p) => ({
      label: `priority.${p}`,
      fg: PRIORITY_BADGE[p],
      bg: PRIORITY_BADGE[p],
    })),

    // Keep / Replace — heading and marker sit on the panel surface (shared,
    // bundles) and, on /saved and /focus, directly on the page with no panel.
    { label: "panel.keep.heading on surface", fg: ASSESSMENT_PANEL.keep.heading, bg: ASSESSMENT_PANEL.keep.surface },
    { label: "panel.keep.marker on surface", fg: ASSESSMENT_PANEL.keep.marker, bg: ASSESSMENT_PANEL.keep.surface },
    { label: "panel.keep.heading bare", fg: ASSESSMENT_PANEL.keep.heading, bg: null },
    { label: "panel.keep.marker bare", fg: ASSESSMENT_PANEL.keep.marker, bg: null },
    { label: "panel.replace.heading on surface", fg: ASSESSMENT_PANEL.replace.heading, bg: ASSESSMENT_PANEL.replace.surface },
    { label: "panel.replace.marker on surface", fg: ASSESSMENT_PANEL.replace.marker, bg: ASSESSMENT_PANEL.replace.surface },
    { label: "panel.replace.heading bare", fg: ASSESSMENT_PANEL.replace.heading, bg: null },
    { label: "panel.replace.marker bare", fg: ASSESSMENT_PANEL.replace.marker, bg: null },

    // Confidence banner — the surface class carries its own text colour.
    { label: "confidence.high text", fg: CONFIDENCE_BANNER.high.surface, bg: CONFIDENCE_BANNER.high.surface },
    { label: "confidence.high icon", fg: CONFIDENCE_BANNER.high.icon, bg: CONFIDENCE_BANNER.high.surface },
    { label: "confidence.low text", fg: CONFIDENCE_BANNER.low.surface, bg: CONFIDENCE_BANNER.low.surface },
    { label: "confidence.low icon", fg: CONFIDENCE_BANNER.low.icon, bg: CONFIDENCE_BANNER.low.surface },
  ];
}

describe("assessment palette — design system", () => {
  it("uses only design-system tokens (no off-system Tailwind palette families)", () => {
    const offSystem: string[] = [];
    const all: Array<[string, string]> = [
      ...Object.entries(PRIORITY_BADGE),
      ...Object.entries(ASSESSMENT_PANEL).flatMap(([side, v]) =>
        Object.entries(v).map(([k, val]) => [`panel.${side}.${k}`, val] as [string, string]),
      ),
      ...Object.entries(CONFIDENCE_BANNER).flatMap(([band, v]) =>
        Object.entries(v).map(([k, val]) => [`confidence.${band}.${k}`, val] as [string, string]),
      ),
    ];
    for (const [name, value] of all) {
      const hit = value.match(OFF_SYSTEM_FAMILY);
      if (hit) offSystem.push(`${name}: "${value}" → ${hit[0]}`);
    }
    expect(offSystem, offSystem.join("\n")).toEqual([]);
  });

  it("still detects an off-system colour (the scan is not vacuous)", () => {
    // A regex that quietly stops matching would pass forever. Prove it fires on
    // the exact strings this change removed…
    expect(OFF_SYSTEM_FAMILY.test("bg-rose-100 text-rose-700 dark:bg-rose-950")).toBe(true);
    expect(OFF_SYSTEM_FAMILY.test("bg-slate-100 text-slate-600")).toBe(true);
    expect(OFF_SYSTEM_FAMILY.test("bg-emerald-50 dark:bg-emerald-950/50")).toBe(true);
    expect(OFF_SYSTEM_FAMILY.test("text-amber-700 dark:text-amber-400")).toBe(true);
    // …and does not fire on the tokens that replaced them.
    expect(OFF_SYSTEM_FAMILY.test("bg-accent-warm/15 text-accent-warm-strong")).toBe(false);
    expect(OFF_SYSTEM_FAMILY.test("bg-foreground text-background")).toBe(false);
    expect(OFF_SYSTEM_FAMILY.test("bg-muted/40 border-border")).toBe(false);
  });

  it("reads one hue family — no competing accent", () => {
    // The ladders are muted → warm accent → ink. The house accent is the only
    // hue any of them may carry; everything else is neutral. This is the
    // property VISION.md's "three competing accent colors" rule is actually
    // about, so assert it directly rather than trusting the family regex to
    // imply it.
    const values = [
      ...Object.values(PRIORITY_BADGE),
      ...Object.values(ASSESSMENT_PANEL).flatMap((v) => Object.values(v)),
      ...Object.values(CONFIDENCE_BANNER).flatMap((v) => Object.values(v)),
    ];
    const accents = new Set<string>();
    for (const v of values) {
      for (const cls of v.split(/\s+/)) {
        const m = cls.match(/-(accent-warm(?:-strong)?)(?:\/\d+)?$/);
        if (m) accents.add("accent-warm");
      }
    }
    expect([...accents]).toEqual(["accent-warm"]);

    // Exactly one rung of the priority ladder carries the accent — the middle
    // one — so the ladder reads as weight, not as a traffic light.
    const accented = Object.values(PRIORITY_BADGE).filter((v) => v.includes("accent"));
    expect(accented).toHaveLength(1);
    expect(PRIORITY_BADGE.medium).toContain("accent-warm");
  });

  it("keeps the priority ladder and its sort order in agreement", () => {
    // A rung with no sort position (or vice versa) would render a pill the list
    // can never order — assert the two records describe the same three values.
    expect(Object.keys(PRIORITY_BADGE).sort()).toEqual(Object.keys(PRIORITY_ORDER).sort());
    expect(PRIORITY_ORDER.high).toBeLessThan(PRIORITY_ORDER.medium);
    expect(PRIORITY_ORDER.medium).toBeLessThan(PRIORITY_ORDER.low);
  });

  it("falls back to the quietest rung for an absent or unknown priority", () => {
    // Both consumers previously spelled this fallback themselves (`|| .low`,
    // `?? .low`). The data is model-authored, so an unrecognised value is a
    // real case — and it must recede, never render as the heaviest mark.
    expect(priorityBadge("high")).toBe(PRIORITY_BADGE.high);
    expect(priorityBadge("critical")).toBe(PRIORITY_BADGE.low);
    expect(priorityBadge(undefined)).toBe(PRIORITY_BADGE.low);
    expect(priorityBadge(null)).toBe(PRIORITY_BADGE.low);
    expect(priorityBadge("")).toBe(PRIORITY_BADGE.low);
  });

  it("switches the confidence banner exactly at the threshold", () => {
    // The threshold used to be written out four times across two call sites.
    // Pin the boundary so a future edit to one of them cannot drift.
    expect(isHighConfidence(CONFIDENCE_THRESHOLD)).toBe(true);
    expect(isHighConfidence(CONFIDENCE_THRESHOLD - 1)).toBe(false);
    expect(confidenceBanner(CONFIDENCE_THRESHOLD)).toBe(CONFIDENCE_BANNER.high);
    expect(confidenceBanner(CONFIDENCE_THRESHOLD - 0.5)).toBe(CONFIDENCE_BANNER.low);
    expect(confidenceBanner(10)).toBe(CONFIDENCE_BANNER.high);
    expect(confidenceBanner(0)).toBe(CONFIDENCE_BANNER.low);
    // NaN must not read as confident: it fails `>=` and lands on the banner
    // that tells the user to look twice.
    expect(confidenceBanner(Number.NaN)).toBe(CONFIDENCE_BANNER.low);
  });
});

describe("assessment palette — computed contrast", () => {
  for (const mode of ["light", "dark"] as const) {
    it(`clears WCAG AA on every surface it renders on (${mode})`, () => {
      const all = pairs();
      // Guard the enumeration itself: it is derived, so assert it did not
      // silently degrade to a handful of pairs.
      expect(all.length).toBe(15);
      // And guard the NESTED half specifically. `bg-muted/50` is the wrapper in
      // app/saved/[id]/page.tsx that made a passing pill actually fail; if the
      // scan stops finding wrappers, every translucent surface silently reverts
      // to being measured only against the flat bases.
      const wrappers = wrapperTints(mode).map((w) => w.label);
      expect(wrappers.length, "no tinted wrappers found in the consumers").toBeGreaterThan(0);
      expect(wrappers).toContain("muted/50 over card");

      const failures: string[] = [];
      for (const { label, fg, bg } of all) {
        const tokenName = textToken(fg);
        const fgRgb = parseHex(token(tokenName, mode));
        for (const [surfaceName, bgRgb] of Object.entries(surfacesFor(bg ? bgSpec(bg) : null, mode))) {
          const ratio = contrastRatio(fgRgb, bgRgb);
          if (ratio < AA_NORMAL_TEXT) {
            failures.push(`${label} (--${tokenName}) on ${surfaceName}: ${ratio.toFixed(2)}:1`);
          }
        }
      }
      expect(failures, failures.join("\n")).toEqual([]);
    });
  }

  /**
   * WCAG 2.1 1.4.11 (non-text contrast): a graphical object needed to understand
   * the content must reach 3:1 against what is adjacent to it.
   */
  const AA_NON_TEXT = 3;

  for (const mode of ["light", "dark"] as const) {
    it(`the step marks stay distinguishable without text or icons (${mode})`, () => {
      // These three marks are pure colour — no label, no icon, no tooltip — so
      // unlike every other palette here, colour IS the signal and a pretty token
      // is not enough. This guard exists because it was NOT here: the first
      // version of the one-hue conversion gave `done` an `accent-warm/40` wash,
      // which measures 1.44:1 against the not-reached mark in BOTH modes, and
      // nothing in the suite looked at topbar.tsx to notice.
      const bgOf = (classes: string): RGB => {
        const spec = bgSpec(classes);
        if (!spec) throw new Error(`no bg-* class in "${classes}"`);
        const rgb = parseHex(token(spec.name, mode));
        // The marks sit on the page background, not a card.
        return spec.alpha === 1
          ? rgb
          : composite(rgb, spec.alpha, parseHex(token("background", mode)));
      };

      const done = bgOf(STEP_MARK.done);
      const current = bgOf(STEP_MARK.current);
      const upcoming = bgOf(STEP_MARK.upcoming);

      // `done` vs `upcoming` are the SAME size, so nothing but colour separates
      // them. This pair must clear the non-text floor.
      const doneVsUpcoming = contrastRatio(done, upcoming);
      expect(
        doneVsUpcoming,
        `done (${STEP_MARK.done}) vs upcoming (${STEP_MARK.upcoming}) is ` +
          `${doneVsUpcoming.toFixed(2)}:1 — same size, so colour is the only ` +
          `signal and it must clear ${AA_NON_TEXT}:1`,
      ).toBeGreaterThanOrEqual(AA_NON_TEXT);

      // `current` vs `upcoming` likewise: the wide accent mark against a mark
      // the user has not reached.
      expect(contrastRatio(current, upcoming)).toBeGreaterThanOrEqual(AA_NON_TEXT);

      // `current` vs `done` is the pair colour CANNOT carry — they sit within
      // ~1.1:1 of each other by design. State the compensating signal as a hard
      // requirement rather than a comment: the current mark must differ in SIZE.
      // If someone later equalises the widths, this fails and points at why.
      expect(
        STEP_MARK.current,
        "current and done are near-identical in luminance, so the current mark " +
          "must be distinguished by width (w-6) — colour cannot do it",
      ).toMatch(/\bw-\d/);
      expect(STEP_MARK.done).not.toMatch(/\bw-\d/);
    });
  }

  it("computes a real ratio (the maths is not vacuous)", () => {
    // Anchor the arithmetic against the two values WCAG fixes by definition,
    // so a broken luminance function cannot pass everything.
    expect(contrastRatio([255, 255, 255], [0, 0, 0])).toBeCloseTo(21, 5);
    expect(contrastRatio([255, 255, 255], [255, 255, 255])).toBeCloseTo(1, 5);
    // And prove the AA floor would actually reject something: mid-grey on white
    // is a known fail.
    expect(contrastRatio([150, 150, 150], [255, 255, 255])).toBeLessThan(AA_NORMAL_TEXT);
  });
});

describe("assessment palette — consumer ratchet", () => {
  it.each(CONSUMERS)("%s carries no off-system palette family", (relPath) => {
    const abs = path.join(ROOT, relPath);
    expect(fs.existsSync(abs), `${relPath} not found — renamed? update CONSUMERS`).toBe(true);
    const source = fs.readFileSync(abs, "utf8");
    const hits = [...source.matchAll(new RegExp(OFF_SYSTEM_FAMILY.source, "g"))].map((m) => m[0]);
    expect([...new Set(hits)], `off-system colours in ${relPath}`).toEqual([]);
  });

  it("every consumer actually imports the palette (the ratchet guards live code)", () => {
    // Without this, deleting the import and hand-rolling tokens inline would
    // still pass the scan above — clean colours, duplicated palette, which is
    // precisely the state this module was written to end.
    for (const relPath of CONSUMERS) {
      const source = fs.readFileSync(path.join(ROOT, relPath), "utf8");
      expect(source, `${relPath} no longer imports the shared palette`).toContain(
        "@/lib/utils/assessment-colors",
      );
    }
  });
});
