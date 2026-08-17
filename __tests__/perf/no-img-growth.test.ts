import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Performance ratchet: cap raw `<img>` usage so it can only go DOWN, never up.
 *
 * The scorecard's standing performance gap is that next/image adoption is 0 —
 * every image is a raw `<img>`, each individually silenced with an inline
 * `eslint-disable @next/next/no-img-element`. Because the rule is suppressed
 * per-occurrence rather than enforced, a new raw `<img>` costs only a one-line
 * disable and the count climbs invisibly on a PR (raw <img> ships no automatic
 * width/height/lazy-loading/responsive-srcset, hurting LCP/CLS). Adopting
 * next/image wholesale is blocked here — most images come from arbitrary
 * retailer CDNs that would each need a `remotePatterns` host entry — so this
 * ratchet is the pragmatic guard: it freezes the current count (30 real
 * `<img>` elements — comment prose is stripped before counting) as a ceiling.
 *
 * To LOWER the cap: convert an `<img>` to `next/image` (for a first-party or
 * whitelisted host) or delete it, then drop MAX_RAW_IMG to the new count. To
 * RAISE it you must justify why next/image cannot be used AND lower it back as
 * soon as it can — the ratchet exists precisely so that decision is explicit,
 * not silent. (Mirrors the harness-ratchet / no-alias-require structural guards.)
 */
const ROOT = path.resolve(__dirname, "../..");
const SCAN_DIRS = ["app", "components"];
const RAW_IMG = /<img\b/g;

/**
 * Current committed count of raw `<img>` ELEMENTS. Only ever ratchet this DOWN.
 * (30 == the number of inline `eslint-disable @next/next/no-img-element`
 * comments, i.e. every real usage is individually silenced.)
 */
const MAX_RAW_IMG = 30;

/**
 * Strip block + line comments so a `<img>` mentioned in prose (a code comment
 * that discusses img tags) is not miscounted as a real element.
 *
 * Tracks string-literal state (single/double/backtick) so a literal `/*`
 * inside a string is never mistaken for a comment opener. A naive
 * `/\*[\s\S]*?\*\//` replace is fooled by exactly this: this codebase has an
 * `accept: { "image/*": [...] }` MIME-type string, and the lazy regex paired
 * that stray `/*` with the next INCIDENTAL `*\/` later in the file (an
 * unrelated JSX comment), silently deleting every real line in between —
 * including a genuine `<img>` element — and undercounting the true total by
 * 1. A ratchet whose own counter can be defeated by an ordinary string
 * literal is worse than no ratchet: a new raw `<img>` could land inside a
 * similarly-swallowed range and never trip the ceiling.
 */
function stripComments(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  let inString: string | null = null;
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (inString) {
      out += c;
      if (c === "\\" && i + 1 < n) {
        out += src[i + 1];
        i += 2;
        continue;
      }
      if (c === inString) inString = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      inString = c;
      out += c;
      i++;
      continue;
    }
    if (c === "/" && c2 === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (c === "/" && c2 === "/") {
      const end = src.indexOf("\n", i + 2);
      i = end === -1 ? n : end; // keep the newline so line numbers stay meaningful
      continue;
    }
    out += c;
    i++;
  }
  return out;
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

function countRawImg(): { total: number; byFile: Record<string, number> } {
  const byFile: Record<string, number> = {};
  let total = 0;
  for (const d of SCAN_DIRS) {
    const abs = path.join(ROOT, d);
    if (!fs.existsSync(abs)) continue;
    for (const file of walk(abs)) {
      const src = stripComments(fs.readFileSync(file, "utf8"));
      const n = (src.match(RAW_IMG) ?? []).length;
      if (n > 0) {
        byFile[path.relative(ROOT, file)] = n;
        total += n;
      }
    }
  }
  return { total, byFile };
}

describe("raw <img> usage ratchet (perf: next/image adoption)", () => {
  it("does not exceed the committed ceiling", () => {
    const { total, byFile } = countRawImg();
    const detail = Object.entries(byFile)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([f, n]) => `  ${n}  ${f}`)
      .join("\n");
    expect(
      total,
      `Raw <img> count rose to ${total} (ceiling ${MAX_RAW_IMG}). A new raw <img> ships no ` +
        `automatic width/height/lazy-load/srcset and regresses LCP/CLS. Use next/image (for a ` +
        `first-party or whitelisted host) instead of adding one. Current distribution:\n${detail}`,
    ).toBeLessThanOrEqual(MAX_RAW_IMG);
  });

  it("the ceiling stays tight — lower MAX_RAW_IMG whenever the count drops", () => {
    const { total } = countRawImg();
    // If this fails, the count went DOWN (good) — update MAX_RAW_IMG to `total`
    // so the ratchet keeps holding at the new, lower ceiling.
    expect(
      total,
      `Raw <img> count is ${total} but the ratchet still allows ${MAX_RAW_IMG}. ` +
        `Lower MAX_RAW_IMG to ${total} to lock in the improvement.`,
    ).toBe(MAX_RAW_IMG);
  });

  it("stripComments does not treat a `/*` inside a string literal as a comment opener", () => {
    // Regression guard for the exact bug this fix closes: a literal `/*`
    // inside a string (e.g. a MIME-type wildcard) must not pair with a LATER,
    // unrelated `*/` and swallow real code in between.
    const src = 'const accept = "image/*"; const real = "<img data-marker=\\"keep-me\\" />";';
    const stripped = stripComments(src);
    expect(stripped).toContain("keep-me");
  });

  it("stripComments still strips real block and line comments", () => {
    const src = "/* a comment with <img> in prose */\nconst x = 1; // <img> trailing note\nconst real = \"<img data-marker='keep' />\";";
    const stripped = stripComments(src);
    expect(stripped).not.toContain("comment with");
    expect(stripped).not.toContain("trailing note");
    expect(stripped).toContain("keep");
  });
});
