import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// WCAG 2.1 AA needs 4.5:1 for normal-size text. The design system's
// --muted-foreground clears it at full strength; every opacity modifier blends
// it toward the surface and drops it under the floor. Measured against BOTH
// surfaces the token actually renders on (app/globals.css: --background /
// --card, light and dark):
//
//              light bg   light card   dark bg   dark card
//   full        5.35:1      5.63:1      5.50:1     5.11:1    <- all clear AA
//   /70         2.92:1      3.00:1      3.31:1     3.17:1    <- all fail
//   /60         2.43:1      2.50:1      2.75:1     2.68:1    <- all fail
//
// So an opacity-modified muted foreground is only defensible on something WCAG
// 1.4.3 does not govern at all: a decorative ICON. It is NOT defensible on
// "inactive" step/status labels — 1.4.3's exemption covers disabled CONTROLS,
// not progress text a user still has to read.
//
// The ratchet is therefore DEFAULT-DENY: every `text-muted-foreground/NN` is a
// violation unless its className also carries icon sizing (h-N w-N). An earlier
// version keyed on "a font-size utility on the same line", which silently
// passed three real status labels whose size lived on a child element or
// another line of the same cn() call — the rule had been scoped to what the
// regex could see rather than to the accessibility surface.
//
// This is a source-text scan, not a rendered-contrast measurement: it proves the
// class combination is absent, not that every rendered pixel passes. The runtime
// proof is the axe pass in e2e/a11y.spec.ts; this exists because it is cheap,
// deterministic, and catches the regression at author time on routes the axe
// scan does not visit.

// Icon sizing: Tailwind h-N/w-N (incl. decimals like h-4.5) on the same element.
const ICON_SIZING = /\bh-\d+(?:\.\d+)?\s+w-\d+(?:\.\d+)?(?![\w-])/;
const MUTED_WITH_OPACITY = /text-muted-foreground\/(\d+)(?![\w-])/g;

const ROOT = path.resolve(__dirname, "../..");
const SCAN_DIRS = ["app", "components"];

// Mirrors the walk() in __tests__/perf/no-img-growth.test.ts.
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

describe("muted-foreground contrast ratchet", () => {
  it("never puts an opacity-dimmed muted foreground on anything but an icon", () => {
    const violations: string[] = [];

    for (const rel of sourceFiles()) {
      const lines = fs.readFileSync(path.join(ROOT, rel), "utf8").split("\n");
      lines.forEach((line, idx) => {
        for (const match of line.matchAll(MUTED_WITH_OPACITY)) {
          // `placeholder:text-muted-foreground/NN` styles placeholder text,
          // which has its own (looser) guidance and is not the failure mode
          // this ratchet is for.
          const prefix = line.slice(Math.max(0, match.index - 14), match.index);
          if (prefix.includes("placeholder:")) continue;
          // The ONLY allowed use: a decorative icon, identified by h-N w-N
          // sizing on the same element.
          if (ICON_SIZING.test(line)) continue;
          violations.push(`${rel}:${idx + 1} — ${match[0]} on text (not an icon)`);
        }
      });
    }

    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("still finds the pattern it is looking for (the scan is not vacuous)", () => {
    // A ratchet that matches nothing passes forever. Prove the detector fires
    // on the exact shape that was fixed, so a regex that silently stops
    // matching cannot masquerade as a clean codebase.
    const text = `<p className="text-xs text-muted-foreground/70 mt-1">10-20 seconds</p>`;
    expect([...text.matchAll(MUTED_WITH_OPACITY)]).toHaveLength(1);
    expect(ICON_SIZING.test(text)).toBe(false); // would be reported

    // ...and that the icon carve-out it relies on still recognises an icon,
    // including the decimal sizes this codebase uses (h-4.5 w-4.5).
    expect(ICON_SIZING.test(`<Star className="h-10 w-10 text-muted-foreground/30" />`)).toBe(true);
    expect(ICON_SIZING.test(`<Loader2 className="h-4.5 w-4.5 animate-spin" />`)).toBe(true);

    // The bare conditional that the previous same-line rule could not see.
    const conditional = `      !isDone && !isActive && "text-muted-foreground/60"`;
    expect([...conditional.matchAll(MUTED_WITH_OPACITY)]).toHaveLength(1);
    expect(ICON_SIZING.test(conditional)).toBe(false); // would be reported
  });

  it("scans a non-trivial number of files", () => {
    // Guards against a glob that quietly resolves to nothing.
    expect(sourceFiles().length).toBeGreaterThan(50);
  });
});
