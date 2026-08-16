import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

import {
  MinTapTarget,
  SpacingStep,
  TapSlop,
  TextLineHeight,
  tapSlopFor,
} from "@/mobile/src/constants/tap-targets";

/**
 * Touch-target minimums for the mobile app's text-only controls.
 *
 * Apple's HIG asks for 44pt and Android's Material guidance for 48dp, so 48 is
 * the bar for an app shipping to both. Neither is an automated submission gate
 * and WCAG 2.5.8 (AA) only requires 24×24 — this is a design-bar standard, not
 * a release blocker.
 *
 * The values had been picked by eye, one control at a time, and the small-text
 * cases landed short: the four `type="small"` links (auth "Create one" /
 * "Sign in", the settings and home back-links) carried `hitSlop={8}` over a
 * bare 20pt line box — a **36pt** target. "Share design" on saved-designs had
 * no hitSlop at all (28pt), and the "Skip for now" / "Try Again" secondary
 * actions sat at 40pt.
 *
 * Two things are asserted, because either alone passes while the app is wrong:
 * that the ARITHMETIC clears the bar, and that every call site RESOLVES to a
 * target that clears it.
 */

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("tap-target arithmetic", () => {
  it("mirrors the constants its sources actually define", () => {
    // The maths is only meaningful if the mirrored values match their real
    // source, and both sources are unreadable from here (a StyleSheet, and a
    // module that imports global.css). A change in either must fail HERE
    // rather than silently leaving every slop value too small.
    const themedText = read("mobile/src/components/themed-text.tsx");
    const lineHeightOf = (styleName: string) => {
      const at = themedText.indexOf(`${styleName}: {`);
      expect(at, `themed-text.tsx must define a "${styleName}" style`).toBeGreaterThan(-1);
      const body = themedText.slice(at, themedText.indexOf("}", at));
      const m = body.match(/lineHeight:\s*(\d+)/);
      expect(m, `${styleName} must declare a lineHeight`).toBeTruthy();
      return Number(m![1]);
    };
    expect(TextLineHeight.small).toBe(lineHeightOf("small"));
    expect(TextLineHeight.default).toBe(lineHeightOf("default"));

    // Spacing was the gap an earlier version only CLAIMED to guard: the module
    // duplicated `Spacing.one` and a comment said a test pinned it, while no
    // such assertion existed. A change to the scale would have moved every
    // padded control under the bar with the suite still green.
    const theme = read("mobile/src/constants/theme.ts");
    const spacing = theme.slice(theme.indexOf("export const Spacing = {"));
    for (const [name, value] of Object.entries(SpacingStep)) {
      const m = spacing.match(new RegExp(`\\b${name}:\\s*(\\d+)`));
      expect(m, `theme.ts must define Spacing.${name}`).toBeTruthy();
      expect(Number(m![1]), `SpacingStep.${name} drifted from theme.ts`).toBe(value);
    }
  });

  it("grows every shape to at least the 48pt minimum", () => {
    const shapes: [keyof typeof TapSlop, number][] = [
      ["smallLabel", TextLineHeight.small],
      ["smallLabelPadded", TextLineHeight.small + 2 * SpacingStep.one],
      ["defaultLabelPadded", TextLineHeight.default + 2 * SpacingStep.two],
      ["iconRow", SpacingStep.four],
    ];
    for (const [name, content] of shapes) {
      const reached = content + 2 * TapSlop[name];
      expect(reached, `${name} reaches only ${reached}pt`).toBeGreaterThanOrEqual(MinTapTarget);
    }
  });

  it("pins the values, so a change to the formula is visible in the diff", () => {
    // 20 + 2×14 = 48; 28 + 2×10 = 48; 40 + 2×4 = 48; 24 + 2×12 = 48.
    expect(TapSlop).toEqual({
      smallLabel: 14,
      smallLabelPadded: 10,
      defaultLabelPadded: 4,
      iconRow: 12,
    });
    // The pre-existing `hitSlop={8}` on a bare small label — the defect.
    expect(TextLineHeight.small + 2 * 8).toBeLessThan(MinTapTarget);
  });
});

// ── call sites ───────────────────────────────────────────────────────────────
// RESOLVES each text-only Pressable to a real pixel height rather than banning
// a syntax. An earlier version banned every bare `hitSlop={N}` literal, which
// forced four `hitSlop={12}` → `TapSlop.defaultLabel` rewrites that changed no
// behaviour at all — 12 was already correct for a 24pt line box. The bar is the
// resulting TARGET, not the spelling, so a literal that clears 48 is fine.
//
// It also computes the STYLED controls, which the same earlier version skipped
// with a note deferring them to manual review. That review did not happen, and
// two 40pt recovery CTAs ("Skip for now", "Try Again") shipped past it.

describe("tap-target call sites", () => {
  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules") continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) out.push(...walk(p));
      else if (/\.tsx$/.test(e.name)) out.push(p);
    }
    return out;
  }
  const files = walk(path.join(ROOT, "mobile/src")).map((f) => path.relative(ROOT, f));

  /**
   * The lines of a `<Pressable`'s OPENING TAG. Cannot cut at the first `>`:
   * `style={({ pressed }) => [...]}` contains one, so that truncates the tag
   * before its later props and reports controls that DO carry a hitSlop.
   */
  function openingTag(lines: string[], idx: number): string {
    const out: string[] = [];
    for (let i = idx; i < Math.min(lines.length, idx + 16); i++) {
      out.push(lines[i]);
      if (i === idx && lines[i].trim().endsWith(">")) break;
      if (lines[i].trim() === ">") break;
    }
    return out.join("\n");
  }

  /**
   * The Pressable's own element, ending at its closing tag.
   *
   * A fixed line window runs past the control into whatever JSX follows: on
   * `results.tsx` the next block contains a `type="small"` label, which made
   * this read a 24pt line box as 20pt and report a compliant 48pt back-link as
   * a 44pt violation. The control's own body is the only thing that determines
   * its content height.
   */
  function elementBody(lines: string[], idx: number): string {
    const out: string[] = [];
    let inOpeningTag = true;
    for (let i = idx; i < Math.min(lines.length, idx + 28); i++) {
      out.push(lines[i]);
      if (/<\/Pressable>/.test(lines[i])) break;
      // A `/>` only ends the element while we are still INSIDE the Pressable's
      // own opening tag. Once that tag has closed, the next `/>` belongs to a
      // CHILD — which is what hid collapsible.tsx: its nested `<SymbolView />`
      // ended the body before the scan ever reached the label below it, so the
      // control fell out of every bucket instead of being measured.
      if (inOpeningTag && /\/>\s*$/.test(lines[i])) break;
      const t = lines[i].trim();
      if (t.endsWith(">") && !t.endsWith("/>")) inOpeningTag = false;
    }
    return out.join("\n");
  }

  /**
   * The content box a set of named styles produces, given a text line height.
   *
   * Reads EVERY `styles.NAME` referenced inside the element, not just the one
   * on the Pressable: `app-tabs.web.tsx`'s TabButton puts its padding on an
   * inner `ThemedView`, so reading only the Pressable's own style computed 20pt
   * for a control that really renders 28pt — a false positive.
   *
   * `height`/`minHeight` is a FLOOR, not a replacement. Treating it as the whole
   * box discarded the padding on `_layout.tsx`'s errorButton (`minHeight: 48`
   * PLUS `paddingVertical: Spacing.three`), reporting 48pt for a 56pt control —
   * harmless there, but it would misreport any control whose minHeight sits
   * below its own padded content.
   *
   * Returns null if any referenced style cannot be read, so the caller reports
   * it rather than guessing.
   */
  const LAYOUT_SIZED = Symbol("sized by layout, not a fixed box");

  function contentBox(
    source: string,
    styleNames: string[],
    lineBox: number,
    own: Set<string> = new Set(styleNames)
  ): number | null | typeof LAYOUT_SIZED {
    let padding = 0;
    let floor = 0;
    for (const name of styleNames) {
      const at = source.search(new RegExp(`\\b${name}:\\s*\\{`));
      if (at === -1) return null;
      const body = source.slice(at, source.indexOf("}", at));
      // `aspectRatio`/`flex` size the box from the LAYOUT, not from its own
      // declarations, so there is no fixed height to compute. photo.tsx's
      // 4:3 photo preview is a large tap area that a fixed-box reading scored
      // at 36pt — a false positive. Surface these instead of guessing.
      //
      // Only the control's OWN style counts. A CHILD with `flex: 1` (a label
      // filling a row) says nothing about the row's height: reading it that way
      // put room-type.tsx's option rows — a plain 56pt padded row — in the
      // unmeasurable bucket.
      if (own.has(name) && /\b(?:aspectRatio|flex|flexGrow):/.test(body)) return LAYOUT_SIZED;
      const h = body.match(/\b(?:height|minHeight):\s*(?:Spacing\.(\w+)|(\d+))/);
      if (h) {
        const v = h[1] ? (SpacingStep as Record<string, number>)[h[1]] : Number(h[2]);
        if (v === undefined) return null;
        floor = Math.max(floor, v);
      }
      const pv = body.match(/\b(?:paddingVertical|padding):\s*(?:Spacing\.(\w+)|(\d+))/);
      if (pv) {
        const v = pv[1] ? (SpacingStep as Record<string, number>)[pv[1]] : Number(pv[2]);
        if (v === undefined) return null;
        padding = Math.max(padding, v);
      }
    }
    return Math.max(lineBox + 2 * padding, floor);
  }

  /** The slop a call site actually applies, from a literal or a TapSlop shape. */
  function slopOf(open: string): number | null {
    const shape = open.match(/hitSlop=\{TapSlop\.(\w+)\}/);
    if (shape) return (TapSlop as Record<string, number>)[shape[1]] ?? null;
    const literal = open.match(/hitSlop=\{(\d+)\}/);
    return literal ? Number(literal[1]) : 0;
  }

  it("resolves every text-only Pressable to a target of at least 48pt", () => {
    const violations: string[] = [];
    const unresolved: string[] = [];
    const layoutSized: string[] = [];

    let measured = 0;
    for (const rel of files) {
      const source = read(rel);
      const lines = source.split("\n");
      lines.forEach((line, idx) => {
        if (!/<Pressable/.test(line)) return;
        const open = openingTag(lines, idx);
        const body = elementBody(lines, idx);
        // Scope: controls whose tappable area is a text label. A Pressable with
        // no ThemedText at all is an icon/image button sized by its own asset,
        // and is out of scope by construction rather than skipped silently.
        if (!/<ThemedText/.test(body)) return;

        // An icon ALONGSIDE the text still counts: it sets the row height, so
        // it is read through its style below rather than used to exclude the
        // control. Excluding on sight is what hid collapsible.tsx (24pt) and
        // app-tabs.web.tsx (28pt) from every bucket at once.
        // One line box, taken from whether the element renders `type="small"`
        // anywhere. KNOWN LIMIT: a control with two STACKED labels of different
        // sizes gets its content understated — room-type.tsx's option rows
        // render a `defaultSemiBold` label above a `type="small"` hint, so this
        // reads 20 where the real stack is 24 + 2 + 20 = 46. It is a floor, so
        // it can only over-report a violation, never hide one, and both those
        // rows clear the bar by a wide margin either way.
        const lineBox = /type="small"/.test(body) ? TextLineHeight.small : TextLineHeight.default;
        const styleNames = [...body.matchAll(/styles\.(\w+)/g)].map((m) => m[1]);
        const ownStyles = new Set([...open.matchAll(/styles\.(\w+)/g)].map((m) => m[1]));
        const content = contentBox(source, styleNames, lineBox, ownStyles);
        if (content === LAYOUT_SIZED) {
          layoutSized.push(`${rel}:${idx + 1}`);
          return;
        }
        if (content === null) {
          // Report rather than skip: a style this cannot read is a HOLE in the
          // guard, and a silent skip is how the 40pt CTAs survived.
          unresolved.push(`${rel}:${idx + 1} — cannot resolve one of its styles`);
          return;
        }

        const slop = slopOf(open);
        if (slop === null) {
          unresolved.push(`${rel}:${idx + 1} — cannot resolve its hitSlop`);
          return;
        }

        measured++;
        const target = content + 2 * slop;
        if (target < MinTapTarget) {
          violations.push(
            `${rel}:${idx + 1} — ${target}pt target (${content} content + ${2 * slop} slop), ` +
              `under ${MinTapTarget}. Required slop: ${tapSlopFor(content)}`
          );
        }
      });
    }

    expect(violations, violations.join("\n")).toEqual([]);
    // Every control must be MEASURABLE, not merely un-flagged.
    expect(unresolved, unresolved.join("\n")).toEqual([]);
    // Controls sized by layout rather than by their own style are listed
    // EXPLICITLY, so the boundary of what this guard measures is reviewable
    // instead of implicit. A new one has to be looked at, not absorbed.
    expect(layoutSized).toEqual(["mobile/src/app/photo.tsx:125"]);
    // ...and the count is ASSERTED, not described. Two successive commit
    // messages quoted a figure nobody had counted — first "all 15 resolve",
    // then "the scan processes 29" — and both were wrong, the second because it
    // was not recounted after the detection holes above were closed. Pinning it
    // exactly means the next miscount fails here instead of shipping in prose.
    // 36 measured + 1 layout-sized = 37 = every `<Pressable` in mobile/src.
    // (was 34 — APT-37 added results.tsx's ErrorBoundary "Try again"/"Go back"
    // Pressables, both correctly sized via TapSlop.defaultLabelPadded, so both
    // count here rather than landing in `violations`/`unresolved` above.)
    expect(measured).toBe(36);
  });

  it("scans a non-trivial number of files, and actually finds Pressables", () => {
    expect(files.length).toBeGreaterThan(10);
    const pressables = files.reduce((n, f) => n + (read(f).match(/<Pressable/g)?.length ?? 0), 0);
    expect(pressables).toBeGreaterThan(20);
  });

  it("reads the whole opening tag, arrow-function style prop included", () => {
    // Cutting at the first `>` stopped inside `({ pressed }) =>` and reported a
    // control that does carry a hitSlop.
    const withArrow = [
      `        <Pressable`,
      `          style={({ pressed }) => [styles.shareButton, { opacity: pressed ? 0.6 : 1 }]}`,
      `          hitSlop={TapSlop.smallLabelPadded}`,
      `        >`,
    ];
    expect(openingTag(withArrow, 0)).toContain("hitSlop=");
    expect(openingTag([...withArrow, `  <ThemedText>x</ThemedText>`], 0)).not.toContain("ThemedText");
    // A single-line opening tag must not swallow the body.
    expect(openingTag([`<Pressable onPress={x}>`, `  <ThemedText>x</ThemedText>`], 0)).toBe(
      `<Pressable onPress={x}>`
    );
  });

  it("computes the shapes it claims to (the scan is not vacuous)", () => {
    const source = [
      `const styles = StyleSheet.create({`,
      `  skipButton: {`,
      `    paddingVertical: Spacing.two,`,
      `  },`,
      `  errorButton: {`,
      `    paddingVertical: Spacing.three,`,
      `    minHeight: 48,`,
      `  },`,
      `});`,
    ].join("\n");
    // padding widens the line box...
    expect(contentBox(source, ["skipButton"], TextLineHeight.default)).toBe(40);
    // ...and minHeight is a FLOOR, not a replacement: 24 + 2x16 = 56 > 48.
    expect(contentBox(source, ["errorButton"], TextLineHeight.default)).toBe(56);
    // an unreadable style is null, so the caller REPORTS rather than guesses
    expect(contentBox(source, ["noSuchStyle"], TextLineHeight.default)).toBeNull();

    expect(slopOf(`hitSlop={12}`)).toBe(12);
    expect(slopOf(`hitSlop={TapSlop.smallLabel}`)).toBe(TapSlop.smallLabel);
    expect(slopOf(`onPress={x}`)).toBe(0);
    // An unknown shape must be UNRESOLVED, never silently zero or passing.
    expect(slopOf(`hitSlop={TapSlop.notAShape}`)).toBeNull();

    // A child's self-closing tag must not end the element body.
    const withIconChild = [
      `      <Pressable style={styles.heading} onPress={x}>`,
      `        <ThemedView style={styles.button}>`,
      `          <SymbolView name="chevron" size={14} />`,
      `        </ThemedView>`,
      `        <ThemedText type="small">{title}</ThemedText>`,
      `      </Pressable>`,
    ];
    expect(elementBody(withIconChild, 0)).toContain("ThemedText");

    // The two defects this change fixes, as arithmetic:
    expect(TextLineHeight.small + 2 * 8).toBe(36); // bare small label, old slop
    expect(TextLineHeight.default + 2 * SpacingStep.two + 0).toBe(40); // "Skip for now"
  });
});
