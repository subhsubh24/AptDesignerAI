import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Guards the label colour on the product's PRIMARY call to action.
 *
 * WHY THIS EXISTS — the axe gate structurally cannot see this defect.
 * `Button variant="warm"` paints `.bg-gradient-warm-button`, and axe reports a
 * gradient background as "incomplete" rather than a violation, because it will
 * not guess which stop the text sits on. So the repo's most-used CTA (50+ call
 * sites) carried white-on-gradient with NO gate watching it, and measured:
 *
 *                              light        dark
 *   old gradient, white text   5.11 → 3.32  3.32 → 2.40   <- fails at both ends in dark
 *   old solid fill, white      5.11         3.32          <- fails in dark
 *   old solid fill, near-black 3.51         5.41          <- fails in light
 *
 * The last row is the shape of the fix: the light theme wants WHITE on its dark
 * accent and the dark theme wants NEAR-BLACK on its light accent. That is what
 * `--accent-warm-on-solid` encodes — a per-theme label colour for anything
 * sitting on a solid warm fill or on the warm CTA gradient. It is deliberately
 * NOT `--accent-foreground`, which is the label for the neutral `--accent`
 * surface and is only 3.51:1 on the warm one.
 *
 * Unlike a source-text scan, the contrast assertions below are a real
 * MEASUREMENT: the token values are parsed out of app/globals.css at test time,
 * so editing a token re-runs the maths rather than leaving a stale number in a
 * comment. The final ratchet is a source scan and is scoped as such.
 */

const ROOT = path.resolve(__dirname, "../..");
const GLOBALS = fs.readFileSync(path.join(ROOT, "app/globals.css"), "utf8");

// ── token parsing ────────────────────────────────────────────────────────────
// Mirrors __tests__/design/assessment-colors.test.ts: light tokens live in
// `:root`, dark overrides under `.dark`, and the dark region is bounded at its
// own closing brace so a later rule redeclaring one of these custom properties
// cannot be measured as if it were the dark-mode value.
const DARK_AT = GLOBALS.indexOf(".dark {");
const DARK_END = GLOBALS.indexOf("\n}", DARK_AT);

type Mode = "light" | "dark";

function token(name: string, mode: Mode): string {
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

/**
 * The hover state is a second fixed TOKEN PAIR, not a filter.
 *
 * An earlier version modelled `hover:brightness-110` here — multiply-and-clamp
 * in sRGB, which is what browsers do for the CSS filter shorthand. The model
 * was correct and it caught a real 4.36:1 hover failure, but modelling was the
 * wrong answer: because the filter lightens the fill uncontrollably, the REST
 * stops had to be deep enough to survive it, which left the button darker at
 * its lightest point than the brand accent's darkest. Pinning hover to explicit
 * tokens removes the filter, so both states are measured directly rather than
 * simulated, and the rest pair gets its vibrancy back.
 */
/** WCAG 2.1 AA for normal-size text. Button labels are 14–18px, never "large". */
const AA_NORMAL_TEXT = 4.5;

const MODES: Mode[] = ["light", "dark"];

describe("warm CTA label contrast", () => {
  describe.each(MODES)("%s theme", (mode) => {
    const label = () => parseHex(token("accent-warm-on-solid", mode));

    it("clears AA on the solid warm fill (bg-accent-warm)", () => {
      const ratio = contrastRatio(label(), parseHex(token("accent-warm", mode)));
      expect(
        ratio,
        `--accent-warm-on-solid on --accent-warm is ${ratio.toFixed(2)}:1 in ${mode}`
      ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    });

    // BOTH stops, because a gradient label crosses the whole ramp — measuring
    // only the dark end is exactly how the old value passed review.
    it.each(["start", "end"])("clears AA at the CTA gradient's %s stop", (stop) => {
      const ratio = contrastRatio(label(), parseHex(token(`gradient-warm-button-${stop}`, mode)));
      expect(
        ratio,
        `--accent-warm-on-solid on --gradient-warm-button-${stop} is ${ratio.toFixed(2)}:1 in ${mode}`
      ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    });

    it.each(["start", "end"])(
      "still clears AA at the %s stop while HOVERED",
      (stop) => {
        const bg = parseHex(token(`gradient-warm-button-hover-${stop}`, mode));
        const ratio = contrastRatio(label(), bg);
        expect(
          ratio,
          `hovered --gradient-warm-button-${stop} is ${ratio.toFixed(2)}:1 in ${mode}`
        ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
      }
    );

    it("clears AA on the solid CTA's HOVER fill", () => {
      const ratio = contrastRatio(label(), parseHex(token("accent-warm-solid-hover", mode)));
      expect(
        ratio,
        `--accent-warm-on-solid on --accent-warm-solid-hover is ${ratio.toFixed(2)}:1 in ${mode}`
      ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    });
  });

  it("exposes both new tokens as Tailwind utilities", () => {
    // Without the `@theme inline` re-export, `text-accent-warm-on-solid` and
    // `hover:bg-accent-warm-solid-hover` generate NO css — every CTA silently
    // inherits its label colour and the contrast maths above keeps passing on
    // tokens nothing reads. So assert the mapping, not just the values.
    const theme = GLOBALS.slice(GLOBALS.indexOf("@theme inline"), GLOBALS.indexOf("\n}"));
    for (const t of ["accent-warm-on-solid", "accent-warm-solid-hover"]) {
      expect(theme, `--color-${t} must be re-exported for the utility to exist`).toContain(
        `--color-${t}: var(--${t});`
      );
    }
  });

  it("keeps the CTA gradient separate from the decorative one", () => {
    // The decorative pair (--gradient-warm-start/end) paints the hero
    // `.text-gradient-warm` heading and the gradient border, carries no label,
    // and is intentionally brighter. If `.bg-gradient-warm-button` were ever
    // pointed back at it, every assertion above would be measuring tokens the
    // button no longer uses — passing while the button failed.
    const rule = GLOBALS.slice(GLOBALS.indexOf(".bg-gradient-warm-button"));
    const body = rule.slice(0, rule.indexOf("}"));
    expect(body).toContain("--gradient-warm-button-start");
    expect(body).toContain("--gradient-warm-button-end");
    expect(body).not.toMatch(/var\(--gradient-warm-(start|end)\)/);
  });

  it("has the warm Button variant reading the token, not a hardcoded colour", () => {
    const button = fs.readFileSync(path.join(ROOT, "components/ui/button.tsx"), "utf8");
    const warm = button.split("\n").find((l) => l.includes("bg-gradient-warm-button"));
    expect(warm, "the warm variant disappeared from button.tsx").toBeDefined();
    expect(warm).toContain("text-accent-warm-on-solid");
    // No brightness filter: the hover assertions above measure explicit tokens,
    // and a filter reintroduced here would lighten the fill past what they
    // measure — passing while the hovered button failed.
    expect(warm).not.toMatch(/brightness-\d+/);

    // ...and the hover really is wired, scoped to interactive elements only so
    // the decorative step-number circles sharing this class stay inert.
    const hoverRule = GLOBALS.slice(GLOBALS.indexOf("a.bg-gradient-warm-button:hover"));
    expect(hoverRule.slice(0, hoverRule.indexOf("}"))).toContain(
      "--gradient-warm-button-hover-start"
    );
  });
});

// ── consumer ratchet ─────────────────────────────────────────────────────────
// A source-text scan, and scoped as one: it proves the failing class
// combinations are absent from author-time source, not that every rendered
// pixel passes. It exists because a hand-rolled warm fill bypasses the Button
// component entirely, so no amount of component-level correctness stops the
// next one from being written.

const SCAN_DIRS = ["app", "components"];

/** Any solid/gradient warm FILL — the surface a label would have to clear. */
const WARM_FILL = /bg-accent-warm(?![\w-/])|bg-gradient-warm-button(?![\w-])/;

/**
 * Label colours that fail on a warm fill, in at least one theme.
 *
 * These are matched INDEPENDENTLY of the fill, then attributed to a fill by the
 * scan below. The first version of this ratchet folded the fill and the label
 * into one regex (`bg-accent-warm\s+text-white`), which is precisely why it
 * could never see a glyph on a child element — the child line contains the
 * label and no fill at all, so a combined pattern cannot match it by
 * construction.
 */
const BAD_LABELS: ReadonlyArray<readonly [RegExp, string]> = [
  [/text-white(?![\w-])/, "text-white on a warm fill (3.32:1 solid / 2.40:1 gradient, in dark)"],
  [
    /text-accent-foreground(?![\w-])/,
    "text-accent-foreground on a warm fill (3.51:1 light / 2.75:1 dark)",
  ],
];

/**
 * Modifiers that are a defect on the FILL element itself.
 *
 * opacity is NOT brightness: it composites the fill AND its label toward the
 * surface behind, so it lowers contrast from both sides at once. On a warm
 * fill, `hover:opacity-90` drops white from 5.11:1 to 4.26:1 over a white
 * panel — a fail reachable only by hovering, which no scan of the rest state
 * would surface. Change the FILL on hover instead
 * (`hover:bg-accent-warm-solid-hover`), which leaves the label opaque.
 */
const BAD_FILL_MODIFIERS: ReadonlyArray<readonly [RegExp, string]> = [
  [
    /hover:opacity-\d+(?![\w-])/,
    "hover:opacity-NN on a warm fill (blends the label too — 4.26:1 in light)",
  ],
];

/**
 * Lines that carry a warm fill, plus the few lines that follow.
 *
 * The window is the point. `__tests__/design/muted-text-contrast.test.ts`
 * records this exact lesson — a same-line rule "silently passed three real
 * status labels whose size lived on a child element" — and the first version of
 * THIS ratchet reintroduced the same assumption, which is how it reported clean
 * while `app/dashboard/page.tsx` had a `text-white` spinner inside a
 * `bg-gradient-warm-button` circle at 2.40:1. In JSX the fill sits on the
 * wrapper and the glyph on the child element a line or two below, so a
 * per-line scan structurally cannot see the pair.
 *
 * The region is the fill's own JSX ELEMENT. Two details, each of which was
 * wrong in an earlier version and produced a real defect:
 *
 * 1. It is anchored to the element's OPENING TAG, not to the line the fill
 *    class happens to sit on. Those differ whenever the class is a ternary
 *    argument inside a multi-line `cn(...)` — a shape this codebase already
 *    ships (`app/account/email-preferences.tsx:97-101`). Keying off the class
 *    line puts `base` at the argument's indentation, so the `)}` on the next
 *    line dedents and the region ends before reaching a single child.
 * 2. It ends only on a line that STARTS a tag (`<div`, `</button>`) at or
 *    outside the anchor's indentation. A pure-indentation rule ends the region
 *    on the `)}` and `>` that close a multi-line opening tag, which are at the
 *    element's own indentation but are not the end of anything.
 *
 * Ending at the element is what keeps a SIBLING out: `app/dashboard/page.tsx`
 * has a `bg-accent-warm` badge whose sibling nine lines later is a
 * photo-overlay `text-white` room title, correct on a dark photo, which a
 * fixed line count would flag the moment someone shortened the gap.
 *
 * Still a heuristic on formatted source, and a floor rather than a proof: it
 * assumes the codebase's consistent JSX indentation, and both bounds below cap
 * how far it looks.
 */
const MAX_CHILD_LINES = 16;
const MAX_ANCHOR_LOOKBACK = 12;

/** Indentation width of a line, or null for a blank one. */
function indentOf(line: string): number | null {
  if (!line.trim()) return null;
  return line.length - line.trimStart().length;
}

/** A line that opens or closes a JSX tag, e.g. `<div ...` or `</button>`. */
const TAG_LINE = /^<\/?[A-Za-z]/;

/**
 * Index of the opening tag owning the fill on `idx` — itself, or the nearest
 * preceding tag line when the class lives inside a multi-line prop.
 */
function elementAnchor(lines: string[], idx: number): number {
  for (let i = idx; i >= Math.max(0, idx - MAX_ANCHOR_LOOKBACK); i--) {
    if (TAG_LINE.test(lines[i].trim())) return i;
  }
  return idx;
}

/**
 * The fill's opening tag plus the lines nested INSIDE that element, with the
 * index it starts at — the caller needs that to report a real line number,
 * since the region can begin BEFORE the line the fill class sits on.
 */
function fillRegion(lines: string[], idx: number): { start: number; region: string[] } {
  const anchor = elementAnchor(lines, idx);
  const base = indentOf(lines[anchor]) ?? 0;
  const region = [lines[anchor]];
  for (let i = anchor + 1; i < Math.min(lines.length, anchor + 1 + MAX_CHILD_LINES); i++) {
    const ind = indentOf(lines[i]);
    // `)}`/`>` closing a multi-line opening tag sit at `base` but end nothing.
    if (ind !== null && ind <= base && TAG_LINE.test(lines[i].trim())) break;
    region.push(lines[i]);
  }
  return { start: anchor, region };
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".next" || e.name === "dist") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.(tsx|ts)$/.test(e.name)) out.push(p);
  }
  return out;
}

function sourceFiles(): string[] {
  return SCAN_DIRS.flatMap((d) => {
    const abs = path.join(ROOT, d);
    return fs.existsSync(abs) ? walk(abs).map((f) => path.relative(ROOT, f)) : [];
  });
}

/**
 * Every violation in `lines`, scanning each warm-fill line together with the
 * next CHILD_WINDOW lines so a glyph on a child element is in scope.
 */
function scan(lines: string[], rel: string): string[] {
  const violations: string[] = [];
  lines.forEach((line, idx) => {
    if (!WARM_FILL.test(line)) return;

    for (const [re, why] of BAD_FILL_MODIFIERS) {
      if (re.test(line)) violations.push(`${rel}:${idx + 1} — ${why}`);
    }

    // A label is only a violation INSIDE a warm fill, which is why this is
    // anchored on a fill line rather than run over the whole file: `text-white`
    // is perfectly correct on a photo overlay two components away.
    const { start, region } = fillRegion(lines, idx);
    for (const [re, why] of BAD_LABELS) {
      region.forEach((l, i) => {
        if (!re.test(l)) return;
        const line = start + i + 1;
        violations.push(
          line === idx + 1
            ? `${rel}:${line} — ${why}`
            : `${rel}:${line} — ${why} (on a child of the fill above)`
        );
      });
    }
  });
  return violations;
}

describe("warm CTA consumer ratchet", () => {
  it("has no hand-rolled warm fill carrying a failing label colour", () => {
    const violations = sourceFiles().flatMap((rel) =>
      scan(fs.readFileSync(path.join(ROOT, rel), "utf8").split("\n"), rel)
    );
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("still finds the patterns it is looking for (the scan is not vacuous)", () => {
    // A ratchet that matches nothing passes forever. These are the exact strings
    // that were in the tree before this fix.
    const samples = [
      `className="inline-flex ... rounded-xl bg-accent-warm text-white font-semibold px-7 py-3"`,
      `className="... rounded-xl bg-accent-warm text-accent-foreground font-semibold text-sm"`,
      `<span className="... rounded-full bg-gradient-warm-button text-white text-xs font-bold">`,
      `className="... bg-accent-warm text-accent-warm-on-solid px-7 py-3 hover:opacity-90 transition-opacity"`,
    ];
    samples.forEach((s, i) => {
      expect(scan([s], "sample.tsx"), `sample ${i} no longer matches`).not.toEqual([]);
    });

    // The wrapper→child shape that shipped past the first version of this
    // ratchet: `app/dashboard/page.tsx`'s analysing spinner, white on the dark
    // gradient's light end at 2.40:1 — below even the 3:1 non-text floor.
    const nested = [
      `<div className="relative h-20 w-20 rounded-full bg-gradient-warm-button flex items-center justify-center">`,
      `  <Loader2 className="h-9 w-9 text-white animate-spin" />`,
      `</div>`,
    ];
    expect(scan(nested, "sample.tsx")).toHaveLength(1);

    // ...and that the replacements do NOT trip the ratchet.
    const fixed = [
      `<div className="rounded-full bg-gradient-warm-button flex items-center justify-center">`,
      `  <Loader2 className="h-9 w-9 text-accent-warm-on-solid animate-spin" />`,
      `</div>`,
      `<a className="rounded-xl bg-accent-warm text-accent-warm-on-solid hover:bg-accent-warm-solid-hover transition-colors">go</a>`,
    ];
    expect(scan(fixed, "sample.tsx")).toEqual([]);

    // `text-white` away from any warm fill is not this ratchet's business —
    // guards against the over-broad version of the same rule.
    expect(scan([`<p className="text-white bg-black">unrelated</p>`], "sample.tsx")).toEqual([]);

    // The fill class as a ternary argument inside a multi-line `cn(...)`, the
    // shape app/account/email-preferences.tsx:97-101 already ships. Anchoring
    // on the CLASS line instead of the element puts `base` at the argument's
    // indentation, so the `)}` on the next line ends the region before a single
    // child is seen — a silent false negative on a real, in-use idiom.
    const inCnCall = [
      `            <button`,
      `              role="switch"`,
      `              className={cn(`,
      `                "relative inline-flex h-6 w-11 rounded-full transition-colors",`,
      `                marketingEmails ? "bg-accent-warm" : "bg-muted",`,
      `              )}`,
      `            >`,
      `              <span className="text-white">On</span>`,
      `            </button>`,
    ];
    expect(scan(inCnCall, "sample.tsx")).toHaveLength(1);

    // A SIBLING of the fill, not a child: this is app/dashboard/page.tsx's
    // shape — an accent-warm badge, then a photo-overlay panel whose white
    // title is correct on a dark photo. A fixed-line-count window flags it the
    // moment the gap shortens; stopping at the fill's own closing tag does not.
    const sibling = [
      `      <div className="absolute top-3 right-3 h-7 w-7 rounded-full bg-accent-warm">`,
      `        <CheckCircle2 className="h-4 w-4 text-accent-warm-on-solid" />`,
      `      </div>`,
      `      <div className="absolute bottom-0 p-4 bg-gradient-to-t from-black/60">`,
      `        <h3 className="font-semibold text-white text-lg">Living room</h3>`,
      `      </div>`,
    ];
    expect(scan(sibling, "sample.tsx")).toEqual([]);
  });

  it("scans a non-trivial number of files", () => {
    // Guards against a glob that quietly resolves to nothing.
    expect(sourceFiles().length).toBeGreaterThan(50);
  });
});
