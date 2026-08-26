import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Design-bar ratchet: no interactive control's focus RING/OUTLINE/BORDER may
 * use the bare `focus:` Tailwind variant — it must be `focus-visible:`.
 *
 * WHY THIS MATTERS. `focus:` fires on every focus event, including a plain
 * mouse click — so a control styled with `focus:ring-2` shows a persistent
 * keyboard-style focus ring to every mouse user too, which reads as a visual
 * bug (a "stuck" highlight) even though it is working as coded. `focus-visible:`
 * is the browser's own heuristic for "this focus was probably from a keyboard,
 * so a visible indicator is actually useful here" — which is what an
 * accessible, non-noisy focus treatment needs.
 *
 * This board has fixed this exact class of bug before: components/ui/button.tsx
 * has always used `focus-visible:` and is the reference implementation, and a
 * prior run converted 6 controls across 4 files from `focus:` to `focus-visible:`
 * (account/page.tsx, dashboard/page.tsx x2, waitlist-form.tsx x2,
 * email-preferences.tsx). This run's deep-audit a11y scout found a second wave:
 * components/ui/select.tsx, components/ui/place-autocomplete.tsx (x2),
 * components/ui/dialog.tsx, components/ui/badge.tsx, and THREE more instances
 * in app/dashboard/page.tsx + app/account/page.tsx that had already been
 * PARTIALLY converted (their `ring`/`outline` classes used `focus-visible:` but
 * a sibling `border` class in the same className was left on bare `focus:` —
 * a mixed state that still shows a border flash on every mouse click even
 * though the ring itself was already fixed).
 *
 * Set at ceiling 0 rather than a ratchet-down count: after this run's fix,
 * the repo-wide count IS zero, and there is no legitimate reason for a NEW
 * `focus:ring`/`focus:outline`/`focus:border` to ever be added — unlike the
 * off-system-palette ratchet (which has genuine categorical exemptions), a
 * focus ring/outline/border always wants `focus-visible:`, full stop.
 *
 * DELIBERATELY NOT MATCHED: `focus:bg-*` / `focus:text-*` (e.g.
 * components/ui/select.tsx's `SelectItem` highlight) — that is Radix's roving
 * highlight for the currently-active option in an open listbox, which SHOULD
 * show on mouse hover as well as keyboard arrow navigation (that is how a
 * combobox is expected to behave); it is not a persistent focus indicator on
 * the trigger control, so `focus-visible:` would be the wrong fix there.
 */
const ROOT = path.resolve(__dirname, "../..");
const SCAN_DIRS = ["app", "components"];

// Only the three utilities that render a VISIBLE focus indicator (ring,
// outline, border) — never `focus:bg-`/`focus:text-` state-highlight classes,
// which are a different, legitimate pattern (see docstring above).
const BARE_FOCUS_INDICATOR = /\bfocus:(ring|outline|border)\b/g;

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
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

function countBareFocus(): { total: number; byFile: Record<string, number> } {
  const byFile: Record<string, number> = {};
  let total = 0;
  for (const d of SCAN_DIRS) {
    const abs = path.join(ROOT, d);
    if (!fs.existsSync(abs)) continue;
    for (const file of walk(abs)) {
      const rel = path.relative(ROOT, file);
      const n = (stripComments(fs.readFileSync(file, "utf8")).match(BARE_FOCUS_INDICATOR) ?? []).length;
      if (n === 0) continue;
      byFile[rel] = n;
      total += n;
    }
  }
  return { total, byFile };
}

function detail(byFile: Record<string, number>): string {
  return Object.entries(byFile)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([f, n]) => `  ${n}\t${f}`)
    .join("\n");
}

describe("focus-visible ratchet (VISION design bar)", () => {
  it("no interactive control uses bare focus:ring / focus:outline / focus:border", () => {
    const { total, byFile } = countBareFocus();
    expect(
      total,
      `Found ${total} bare focus:ring/focus:outline/focus:border usage(s) — these must be ` +
        `focus-visible: so a mouse click does not trigger a keyboard-style focus indicator. ` +
        `See components/ui/button.tsx for the reference implementation.\n` +
        `Offending files:\n${detail(byFile)}`,
    ).toBe(0);
  });

  it("the scan is not vacuous — it would catch a real bare focus:ring", () => {
    // outline, ring-2, ring-ring — three distinct focus:ring/outline hits.
    const src = stripComments('className="focus:outline-none focus:ring-2 focus:ring-ring"');
    expect((src.match(BARE_FOCUS_INDICATOR) ?? []).length).toBe(3);
  });

  it("does not flag the legitimate focus:bg- listbox-highlight pattern", () => {
    const src = stripComments('className="outline-none focus:bg-accent focus:text-accent-foreground"');
    expect((src.match(BARE_FOCUS_INDICATOR) ?? []).length).toBe(0);
  });
});
