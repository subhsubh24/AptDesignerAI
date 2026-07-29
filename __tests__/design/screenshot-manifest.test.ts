import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { SCREENSHOT_DIR, WIDTHS } from "@/e2e/helpers/screenshot";

/**
 * F7 artifact guard — hold the committed journey screenshots ACCOUNTABLE.
 *
 * F7's whole point is that the vision lenses (the deep audit, the readiness
 * auditors) have real artifacts to LOOK at. Nothing enforced that until now:
 * `scripts/preflight.sh` GATE 1c only counts files matching `-size +0c`, so a
 * 1x1 transparent pixel, a truncated write, a PNG left behind by a journey that
 * no longer exists, or a required capture site that silently stopped firing all
 * read as "artifacts present". A guard that cannot fail is not a guard, and
 * these PNGs are exactly the kind of committed binary that rots invisibly.
 *
 * So this test asserts the four things that would actually go wrong:
 *
 *  1. REAL IMAGE — PNG signature plus an IHDR whose pixel width EQUALS the
 *     viewport the suite shoots at, and whose height is at least that viewport
 *     (a full-page capture is never shorter than the viewport). A placeholder,
 *     a 0-byte file, or a half-written PNG fails on the header, not on a size
 *     heuristic.
 *  2. NO ORPHANS — every committed file maps back to a `captureJourneyStep()`
 *     call that still exists in the spec. Deleting a journey without deleting
 *     its PNGs leaves stale evidence that a reviewer would take at face value.
 *  3. NO MISSING REQUIRED CAPTURE — every public-tier capture site has a PNG at
 *     BOTH widths. If a capture call is removed or renamed and the old images
 *     stay, (2) catches it; if a capture site is added and never committed,
 *     this catches it.
 *  4. NO DUPLICATES — byte-identical files under different names add megabytes
 *     and zero evidence. This was a real finding: five protected-route bounces
 *     all render the same /login screen and were committed five times over.
 *
 * SCOPE, and why it is honest: only the `public-` tier is REQUIRED to be
 * committed. The `authed-` capture sites are wired and run with the suite, but
 * committing them needs the seeded Supabase-local backend the CI journeys job
 * provides and a plain container does not — see e2e/__screenshots__/README.md,
 * which is also why ROADMAP F7 stays unticked. Any `authed-` PNG that IS
 * committed still has to pass (1), (2) and (4); it is simply not demanded.
 *
 * The authed tier includes a capture whose slug is built at runtime
 * (`` captureJourneyStep(page, `authed-room-${segment}`) ``), so its full name
 * appears nowhere in the source. Those are matched by their static PREFIX;
 * demanding an exact name would flag a legitimate artifact as an orphan the
 * moment someone commits the design-dense evidence F7 is waiting on. Because
 * that is a hole a reader cannot see, the parser also asserts it understood
 * EVERY call in the spec — a new argument form fails loudly rather than
 * silently shrinking what the guard covers.
 */

const ROOT = path.resolve(__dirname, "../..");
const SHOTS_DIR = path.join(ROOT, SCREENSHOT_DIR);
const SPEC = path.join(ROOT, "e2e", "journeys.spec.ts");

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * `captureJourneyStep(page, …)`, in both forms the spec uses: a quoted literal
 * (`"public-pricing"`) and a template literal (`` `authed-room-${segment}` ``,
 * whose slug is built from a loop variable and so is not statically knowable).
 */
const CAPTURE_CALL =
  /captureJourneyStep\(\s*[A-Za-z_$][\w$]*\s*,\s*(?:"([^"]+)"|'([^']+)'|`([^`]+)`)\s*\)/g;

/** Every call, however its argument is written — used to detect blind spots. */
const ANY_CAPTURE_CALL = /captureJourneyStep\(/g;

/**
 * Decode a PNG header. IHDR is fixed-position in a valid PNG: an 8-byte
 * signature, then the IHDR chunk whose width/height are big-endian uint32 at
 * byte 16 and 20. Anything shorter than that is not a PNG we can vouch for.
 */
function readPngSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24) return null;
  if (!buf.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  if (buf.subarray(12, 16).toString("ascii") !== "IHDR") return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

type CaptureSites = {
  /** Slugs known in full, from a quoted literal. */
  exact: string[];
  /**
   * Static leading text of a template-literal slug, e.g. `authed-room-` from
   * `` `authed-room-${segment}` ``. The rest is a runtime value, so such a
   * capture can only ever be matched by prefix — demanding an exact name would
   * flag a legitimate artifact as an orphan.
   */
  prefixes: string[];
  /** Total `captureJourneyStep(` occurrences, parsed or not. */
  callCount: number;
  /** Occurrences whose argument this parser understood. */
  parsedCount: number;
};

function captureSites(): CaptureSites {
  const src = fs.readFileSync(SPEC, "utf8");
  const exact = new Set<string>();
  const prefixes = new Set<string>();
  let parsedCount = 0;

  for (const m of src.matchAll(CAPTURE_CALL)) {
    parsedCount += 1;
    const literal = m[1] ?? m[2];
    if (literal !== undefined) {
      exact.add(literal);
      continue;
    }
    const template = m[3];
    const interpolation = template.indexOf("${");
    // A template with no interpolation is just a literal written in backticks.
    if (interpolation === -1) exact.add(template);
    else prefixes.add(template.slice(0, interpolation));
  }

  return {
    exact: [...exact].sort(),
    prefixes: [...prefixes].sort(),
    callCount: [...src.matchAll(ANY_CAPTURE_CALL)].length,
    parsedCount,
  };
}

function committedPngs(): string[] {
  if (!fs.existsSync(SHOTS_DIR)) return [];
  return fs
    .readdirSync(SHOTS_DIR)
    .filter((f) => f.endsWith(".png"))
    .sort();
}

const WIDTH_LABELS = WIDTHS.map((w) => w.label);

/** `public-pricing-desktop.png` -> `{ slug: "public-pricing", label: "desktop" }`. */
function parseName(file: string): { slug: string; label: string } | null {
  const base = file.replace(/\.png$/, "");
  for (const label of WIDTH_LABELS) {
    const suffix = `-${label}`;
    if (base.endsWith(suffix)) return { slug: base.slice(0, -suffix.length), label };
  }
  return null;
}

describe("F7 journey screenshot artifacts", () => {
  const sites = captureSites();
  const files = committedPngs();

  it("the spec still has capture sites, and the public tier is committed", () => {
    // Guards the guard: if every captureJourneyStep call were deleted, the
    // orphan and placeholder checks below would pass over an empty set.
    expect(sites.exact.length + sites.prefixes.length).toBeGreaterThan(0);
    expect(files.length).toBeGreaterThan(0);
  });

  it("understands every capture call in the spec", () => {
    // The blind-spot check. A call whose argument this parser cannot read is
    // invisible to the orphan test, which would then flag that journey's
    // legitimate screenshots as orphans. Fail loudly here instead, naming the
    // parser as the thing to fix — rather than silently narrowing what the
    // guard covers, which is how a guard goes hollow.
    expect(
      sites.parsedCount,
      `${sites.callCount - sites.parsedCount} captureJourneyStep() call(s) in ` +
        `e2e/journeys.spec.ts use an argument form CAPTURE_CALL does not parse. ` +
        `Teach the regex that form, or the orphan check goes blind to them.`,
    ).toBe(sites.callCount);
  });

  it("resolves each dynamic capture to a non-empty prefix", () => {
    // `authed-room-${segment}` can only be matched by its static prefix. A
    // template that STARTS with an interpolation would yield "", which every
    // filename starts with — silently disabling the orphan check entirely.
    expect(sites.prefixes.filter((p) => p === "")).toEqual([]);
  });

  it("every committed file is a real PNG at the width its name claims", () => {
    const bad: string[] = [];

    for (const file of files) {
      const parsed = parseName(file);
      if (!parsed) continue; // reported by the orphan test below

      const expected = WIDTHS.find((w) => w.label === parsed.label);
      if (!expected) continue;

      const buf = fs.readFileSync(path.join(SHOTS_DIR, file));
      const size = readPngSize(buf);

      if (!size) {
        bad.push(`${file}: not a decodable PNG (${buf.length} bytes)`);
        continue;
      }
      if (size.width !== expected.width) {
        bad.push(
          `${file}: ${size.width}x${size.height} — expected width ${expected.width} ` +
            `(a placeholder or a capture at the wrong viewport)`,
        );
        continue;
      }
      // A full-page capture covers at least the viewport, so a short image
      // means the page never rendered — the classic blank/placeholder shape.
      if (size.height < expected.height) {
        bad.push(
          `${file}: ${size.width}x${size.height} — shorter than the ${expected.height}px viewport`,
        );
      }
    }

    expect(bad, `Placeholder or malformed screenshot artifacts:\n${bad.join("\n")}`).toEqual([]);
  });

  it("has no orphaned screenshots left behind by a removed journey", () => {
    const known = new Set(sites.exact);
    const orphans = files.filter((file) => {
      const parsed = parseName(file);
      if (!parsed) return true;
      if (known.has(parsed.slug)) return false;
      // A dynamically-named capture (`authed-room-${segment}`) can only be
      // matched by prefix — its full slug does not exist anywhere in the source.
      return !sites.prefixes.some((prefix) => parsed.slug.startsWith(prefix));
    });

    expect(
      orphans,
      `Committed PNGs with no captureJourneyStep() call in e2e/journeys.spec.ts — ` +
        `delete them or restore the capture site:\n${orphans.join("\n")}`,
    ).toEqual([]);
  });

  it("commits every public-tier capture site at both widths", () => {
    // Only statically-named sites can be REQUIRED — a dynamic slug's full name
    // is not knowable from the source, so there is nothing to demand.
    const required = sites.exact.filter((s) => s.startsWith("public-"));
    expect(required.length).toBeGreaterThan(0);

    const present = new Set(files);
    const missing: string[] = [];
    for (const slug of required) {
      for (const { label } of WIDTHS) {
        const name = `${slug}-${label}.png`;
        if (!present.has(name)) missing.push(name);
      }
    }

    expect(
      missing,
      `Public journey steps captured by the suite but not committed to ` +
        `${SCREENSHOT_DIR}/:\n${missing.join("\n")}`,
    ).toEqual([]);
  });

  it("commits no byte-identical duplicates", () => {
    const byHash = new Map<string, string[]>();
    for (const file of files) {
      const hash = crypto
        .createHash("sha256")
        .update(fs.readFileSync(path.join(SHOTS_DIR, file)))
        .digest("hex");
      byHash.set(hash, [...(byHash.get(hash) ?? []), file]);
    }

    const dupes = [...byHash.values()].filter((group) => group.length > 1);

    expect(
      dupes,
      `Identical images committed under different names — they add bytes and no ` +
        `evidence; keep one and let the journey's URL assertion prove the rest:\n` +
        dupes.map((g) => g.join(" == ")).join("\n"),
    ).toEqual([]);
  });
});
