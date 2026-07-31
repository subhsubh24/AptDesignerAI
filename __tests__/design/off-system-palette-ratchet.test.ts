import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Design-bar ratchet: cap OFF-SYSTEM Tailwind palette usage repo-wide so it can
 * only go DOWN, never up.
 *
 * `__tests__/design/assessment-colors.test.ts` carries a consumer ratchet, and
 * says so honestly in its own docstring: "It is NOT a repo-wide off-system-colour
 * ratchet and does not claim to be one — other surfaces still carry raw palette
 * utilities." This is that missing guard.
 *
 * WHY A CEILING RATHER THAN ZERO. A repo-wide ban would fail today on 100+ real
 * usages, so it could only ship as a skipped test — which guards nothing. The
 * `MAX_OFF_SYSTEM` ceiling is the same shape as
 * `__tests__/perf/no-img-growth.test.ts`: it cannot fix what is already there,
 * but it makes ADDING a raw palette utility a build failure rather than a silent
 * drift, and it makes every removal permanent. That drift is the exact mechanism
 * that produced four different palettes for one Keep/Replace pair.
 *
 * WHAT IS DELIBERATELY EXEMPT. `components/ui/toast.tsx` and
 * `components/ui/badge.tsx` are CATEGORICAL status feedback (success / warning /
 * info / error), not an ordinal ladder. The single-hue doctrine is about ranked
 * data, where a hue per rung is decoration; monochroming a success toast would
 * cost a real affordance. Prior runs decided this explicitly, so they are scoped
 * out by name rather than quietly inflating the ceiling — and their own counts
 * are pinned below so the exemption cannot be widened into a hiding place.
 *
 * TO LOWER THE CEILING: convert a surface to design tokens (see
 * `lib/utils/assessment-colors.ts`, `lib/utils/tier-colors.ts` and
 * `lib/scoring/verdicts.ts` for the three worked examples of the one-hue ladder),
 * then drop MAX_OFF_SYSTEM to the new count. The second test below FAILS if you
 * forget, so an improvement cannot leave slack behind.
 */
const ROOT = path.resolve(__dirname, "../..");
const SCAN_DIRS = ["app", "components"];

/**
 * The exempt files, and their pinned counts. Listed as exact paths so a NEW file
 * cannot inherit the exemption, and counted so the two that ARE exempt cannot
 * grow either.
 */
const CATEGORICAL_EXEMPT: Record<string, number> = {
  "components/ui/toast.tsx": 32,
  "components/ui/badge.tsx": 12,
};

/**
 * Off-system palette families: every Tailwind colour family that is not part of
 * the warm-editorial token system. The system's own colours are CSS variables
 * (`accent-warm`, `muted`, `foreground`, `destructive`, `border`, …), which carry
 * no numeric weight — so "family name + numeric weight" is precisely the shape of
 * an off-system utility and nothing else.
 *
 * Matched WITHOUT a utility-prefix allowlist on purpose. The sibling guard in
 * assessment-colors.test.ts enumerates prefixes, and that is how
 * `border-l-amber-400` escaped it for three cycles. A leading `-` plus family
 * plus weight matches every prefix that exists and every one someone adds.
 */
const OFF_SYSTEM = new RegExp(
  "-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose" +
    "|slate|gray|zinc|neutral|stone)-(?:50|100|200|300|400|500|600|700|800|900|950)\\b",
  "g",
);

/**
 * Current committed count OUTSIDE the categorical exemptions. Only ratchet DOWN.
 *
 * Established at 82 after a run converted the /diagnosis assessment pair and
 * issue rails, the scene-coverage verdict, the floor-plan confidence ladder, the
 * refine warning rungs, the identified-product pill and the topbar step ladder —
 * 25 usages across those six files, all of them ordinal or action ladders.
 *
 * 82 -> 78: the /compare table marked the best and lowest score in each row with
 * emerald and amber cell tints — two competing accents encoding ordinal data,
 * the same shape as the conversions above. Best now takes the single warm accent
 * and lowest takes no surface, which is the emphasis ladder rather than a hue
 * per rung, and both carry a visible word so the ranking is not colour-only.
 */
const MAX_OFF_SYSTEM = 78;

/**
 * Strip block + line comments so a palette name discussed in PROSE (this file's
 * own rationale, or a comment explaining what a conversion replaced) is not
 * counted as a live utility. Mirrors the helpers in no-img-growth.test.ts and
 * harness-ratchet.test.ts.
 */
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

function countOffSystem(): { total: number; byFile: Record<string, number>; exempt: Record<string, number> } {
  const byFile: Record<string, number> = {};
  const exempt: Record<string, number> = {};
  let total = 0;
  for (const d of SCAN_DIRS) {
    const abs = path.join(ROOT, d);
    if (!fs.existsSync(abs)) continue;
    for (const file of walk(abs)) {
      const rel = path.relative(ROOT, file);
      const n = (stripComments(fs.readFileSync(file, "utf8")).match(OFF_SYSTEM) ?? []).length;
      if (n === 0) continue;
      if (rel in CATEGORICAL_EXEMPT) {
        exempt[rel] = n;
      } else {
        byFile[rel] = n;
        total += n;
      }
    }
  }
  return { total, byFile, exempt };
}

function detail(byFile: Record<string, number>): string {
  return Object.entries(byFile)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([f, n]) => `  ${n}\t${f}`)
    .join("\n");
}

describe("off-system palette ratchet (VISION design bar)", () => {
  it("does not exceed the committed ceiling", () => {
    const { total, byFile } = countOffSystem();
    expect(
      total,
      `Off-system Tailwind palette usage rose to ${total} (ceiling ${MAX_OFF_SYSTEM}).\n` +
        `VISION.md's design bar forbids competing accent colours; ranked data takes a ` +
        `SINGLE-HUE emphasis ladder built from design tokens. See lib/utils/assessment-colors.ts, ` +
        `lib/utils/tier-colors.ts and lib/scoring/verdicts.ts for the worked pattern.\n` +
        `Current distribution:\n${detail(byFile)}`,
    ).toBeLessThanOrEqual(MAX_OFF_SYSTEM);
  });

  it("the ceiling stays tight — lower MAX_OFF_SYSTEM whenever the count drops", () => {
    const { total } = countOffSystem();
    // If this fails, the count went DOWN (good) — set MAX_OFF_SYSTEM to `total`
    // so the ratchet holds at the new, lower ceiling instead of banking slack a
    // future change could silently spend.
    expect(
      total,
      `Off-system palette count is ${total} but the ratchet still allows ${MAX_OFF_SYSTEM}. ` +
        `Lower MAX_OFF_SYSTEM to ${total} to lock in the improvement.`,
    ).toBe(MAX_OFF_SYSTEM);
  });

  it("the categorical exemptions are pinned, so the carve-out cannot widen", () => {
    const { exempt } = countOffSystem();
    // Toast/Badge are exempt because their hues are categorical status, not an
    // ordinal ladder. That reasoning does not license MORE colour inside them,
    // and it must not become a place to park a ladder that belongs on tokens.
    expect(exempt).toEqual(CATEGORICAL_EXEMPT);
  });

  it("the six surfaces converted this run carry no off-system palette at all", () => {
    // A pure count ceiling can be satisfied by removing colour anywhere. Pin the
    // specific files this change cleaned so they cannot regress under cover of a
    // reduction somewhere else.
    const CLEANED = [
      "app/projects/[projectId]/rooms/[roomId]/diagnosis/page.tsx",
      "components/rooms/scene-coverage-card.tsx",
      "components/projects/floor-plan-upload-zone.tsx",
      "components/rooms/identified-product-pill.tsx",
      "components/refine/RefineChat.tsx",
      "components/layout/topbar.tsx",
    ];
    const dirty: string[] = [];
    for (const rel of CLEANED) {
      const abs = path.join(ROOT, rel);
      expect(fs.existsSync(abs), `${rel} not found — renamed? update CLEANED`).toBe(true);
      const hits = stripComments(fs.readFileSync(abs, "utf8")).match(OFF_SYSTEM) ?? [];
      if (hits.length > 0) dirty.push(`${rel}: ${[...new Set(hits)].join(", ")}`);
    }
    expect(dirty, dirty.join("\n")).toEqual([]);
  });

  it("the /diagnosis celebration confetti stays in the warm family", () => {
    // The confetti burst paints opaque hex rather than tokens (a particle needs a
    // paint value, and the intermediate shades between the accent and its
    // gradient end are not tokens). The palette regex above cannot see hex, so
    // pin it here: every colour must sit in the warm hue range, which is what
    // kept emerald + teal out of a warm-editorial celebration.
    const src = fs.readFileSync(
      path.join(ROOT, "app/projects/[projectId]/rooms/[roomId]/diagnosis/page.tsx"),
      "utf8",
    );
    const decl = /const CONFETTI_COLORS = \[([^\]]+)\]/.exec(src);
    expect(decl, "CONFETTI_COLORS declaration not found").not.toBeNull();
    const hexes = [...decl![1].matchAll(/#([0-9a-fA-F]{6})/g)].map((m) => m[1]);
    expect(hexes.length, "expected a non-empty confetti palette").toBeGreaterThan(0);

    for (const hex of hexes) {
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
      // Warm means red-dominant with green above blue — the ordering that holds
      // for the accent (#b4501e) and its gradient end (#d4733e), and that
      // emerald (#059669: g > r) and teal (#0d9488: b > r) both fail.
      expect(r, `#${hex} is not red-dominant`).toBeGreaterThan(g);
      expect(g, `#${hex} has more blue than green — that is a cool hue`).toBeGreaterThan(b);
    }
  });

  it("still detects an off-system colour (the scan is not vacuous)", () => {
    // A regex that quietly stops matching would pass forever. Prove it fires on
    // the exact strings this change removed — including the directional-border
    // form that the sibling prefix-allowlist guard could not see…
    for (const s of [
      "bg-emerald-500/10 text-emerald-700",
      "border-l-amber-400 bg-amber-50/50",
      "border-l-rose-500",
      "text-green-600",
      "bg-emerald-500",
      "text-amber-800 dark:text-amber-200",
    ]) {
      expect((s.match(OFF_SYSTEM) ?? []).length, `should have matched in "${s}"`).toBeGreaterThan(0);
    }
    // …and does not fire on the tokens that replaced them.
    for (const s of [
      "bg-accent-warm/10 text-accent-warm-strong",
      "border-l-accent-warm",
      "bg-muted/40 border-border text-foreground",
      "bg-foreground text-background",
      "bg-destructive/10 text-destructive",
      "text-muted-foreground",
    ]) {
      expect(s.match(OFF_SYSTEM), `should NOT have matched in "${s}"`).toBeNull();
    }
  });
});
