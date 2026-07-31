import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";

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
 * How far down a capture we look for evidence that something was drawn, and how
 * many distinct colours must appear there.
 *
 * Both numbers are measured, not guessed. Across the committed set the sparsest
 * real screen (a reset-password form at 390px) shows 539 distinct colours in its
 * top 400 rows and the densest shows 4,332; a uniform image shows 1. Every page
 * this app serves puts a header, a logo and antialiased text in its first rows,
 * so 64 sits ~8x below the sparsest real capture and ~64x above a blank —
 * comfortably clear of both a false alarm and a miss.
 */
const BLANK_PROBE_ROWS = 400;
const MIN_DISTINCT_COLORS = 64;

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

type PngHeader = {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  interlace: number;
};

/** Walk the chunk stream, collecting the header and the compressed image data. */
function readPngChunks(buf: Buffer): { header: PngHeader | null; idat: Buffer[] } {
  const idat: Buffer[] = [];
  let header: PngHeader | null = null;
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) return { header, idat };

  let offset = 8;
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.subarray(offset + 4, offset + 8).toString("ascii");
    const data = buf.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      // A write truncated mid-IHDR leaves a chunk that CLAIMS 13 bytes and
      // carries fewer, and readUInt32BE throws a RangeError past the end. Stop
      // instead: a header we cannot read means no header, which the caller
      // already reports as an undecodable artifact — the same path a truncated
      // IDAT takes. Both failures should read the same to whoever hits them.
      if (data.length < 13) return { header: null, idat };
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length; // length + type + data + crc
  }
  return { header, idat };
}

/** PNG Paeth predictor (filter type 4), per the spec's reference implementation. */
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/**
 * Count distinct RGB values in the top `maxRows` scanlines of a PNG.
 *
 * This decodes real pixels rather than inferring "blank" from file size. Size
 * is only a compression proxy, and a proxy is exactly the kind of guard that
 * looks like it works until the one time it matters. Scanline filters are
 * cumulative, so rows are un-filtered in order from the top — which is also
 * where every page in this app draws its header, logo and text.
 *
 * Returns null for a format this decoder cannot vouch for (interlaced, or a bit
 * depth / colour type Playwright does not emit). Callers treat null as a FAILURE
 * rather than a pass: an artifact we cannot inspect is not an artifact we can
 * trust, and silently skipping it is how a guard goes hollow.
 */
function distinctColorsInTopRows(buf: Buffer, maxRows: number): number | null {
  const { header, idat } = readPngChunks(buf);
  if (!header || idat.length === 0) return null;

  const { width, height, bitDepth, colorType, interlace } = header;
  if (bitDepth !== 8 || interlace !== 0) return null;
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (channels === 0) return null;

  // ACCEPT ONLY WHAT THE SUITE ACTUALLY SHOOTS, and reject everything else here
  // rather than one malformed field at a time.
  //
  // Three separate crash paths were found in this function by review — a
  // truncated IDAT, an IHDR shorter than 13 bytes, and a 13-byte IHDR carrying
  // an absurd `width`, where `Buffer.alloc(width * channels)` either throws or
  // tries to reserve gigabytes (worse than throwing: on a small CI runner it
  // OOM-kills the process, which reads as infrastructure flake rather than a
  // bad artifact). They are one bug: the decoder trusted a header it had not
  // checked. Patching each input as it was found would have left the next one
  // waiting, so the header is validated against a known-good shape ONCE, before
  // any allocation, and every rejection lands on the same documented null.
  //
  // The bound is the capture widths themselves, doubled for headroom — a real
  // artifact is shot at one of WIDTHS, and a full-page height is bounded by the
  // longest page the suite visits, not by anything a file gets to claim.
  const MAX_WIDTH = Math.max(...WIDTHS.map((w) => w.width)) * 2;
  const MAX_HEIGHT = 100_000;
  if (width < 1 || width > MAX_WIDTH) return null;
  if (height < 1 || height > MAX_HEIGHT) return null;

  // Even with a sane header, IDAT can stop mid-stream (the truncated-write case
  // this file's header calls out) and inflateSync THROWS on that. Letting it
  // propagate would crash the caller with a generic zlib message naming no
  // file, when the contract above promises a null the caller reports as an
  // undecodable artifact. Same outcome (the build fails), but only one of them
  // tells you which file to look at.
  let raw: Buffer;
  try {
    raw = zlib.inflateSync(Buffer.concat(idat));
  } catch {
    return null;
  }
  const stride = width * channels;
  const rows = Math.min(height, maxRows);
  const colors = new Set<number>();

  let prev = Buffer.alloc(stride);
  let cur = Buffer.alloc(stride);

  for (let y = 0; y < rows; y++) {
    const start = y * (stride + 1);
    if (start + stride + 1 > raw.length) break;
    const filter = raw[start];
    raw.copy(cur, 0, start + 1, start + 1 + stride);

    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      if (filter === 1) cur[i] = (cur[i] + a) & 0xff;
      else if (filter === 2) cur[i] = (cur[i] + b) & 0xff;
      else if (filter === 3) cur[i] = (cur[i] + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) cur[i] = (cur[i] + paeth(a, b, c)) & 0xff;
    }

    for (let x = 0; x + channels <= stride; x += channels) {
      colors.add((cur[x] << 16) | (cur[x + 1] << 8) | cur[x + 2]);
    }

    const swap = prev;
    prev = cur;
    cur = swap;
  }

  return colors.size;
}

/** A single-colour PNG — the shape a blank capture actually takes on disk. */
function uniformPng(width: number, height: number, rgb: [number, number, number]): Buffer {
  const channels = 3;
  const stride = width * channels;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    const start = y * (stride + 1);
    raw[start] = 0; // filter: none
    for (let x = 0; x < stride; x += channels) {
      raw[start + 1 + x] = rgb[0];
      raw[start + 2 + x] = rgb[1];
      raw[start + 3 + x] = rgb[2];
    }
  }
  // CRCs are left zero — this decoder does not verify them, and the fixture
  // exists only to be read back by the function under test.
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    return Buffer.concat([length, Buffer.from(type, "ascii"), data, Buffer.alloc(4)]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
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

  it("detects a blank image — the guard's own guard", () => {
    // Without this, a decoder that silently started returning null (a format
    // change, a refactor) would make the blankness test below pass over every
    // artifact, and nothing would say so. Prove the detector still separates a
    // drawn screen from an undrawn one before trusting its verdicts.
    const blank = uniformPng(1280, 800, [250, 249, 247]);
    expect(distinctColorsInTopRows(blank, BLANK_PROBE_ROWS)).toBeLessThan(MIN_DISTINCT_COLORS);

    const drawn = files.find((f) => f.startsWith("public-"));
    expect(drawn, "no public capture to compare against").toBeDefined();
    expect(
      distinctColorsInTopRows(fs.readFileSync(path.join(SHOTS_DIR, drawn!)), BLANK_PROBE_ROWS),
    ).toBeGreaterThanOrEqual(MIN_DISTINCT_COLORS);
  });

  it("commits no visually BLANK artifact", () => {
    // The hole this closes is not theoretical. A journey run at two workers
    // produced a 4.7KB all-background /login capture while every DOM assertion
    // in that test passed — a screen that rendered nothing, shot mid-paint. It
    // satisfied the PNG-header check above (correct signature, correct 1280x800
    // IHDR), so nothing stopped it being committed as evidence. Dimensions
    // prove a file is an image; only pixels prove it is a picture of something.
    const bad: string[] = [];

    for (const file of files) {
      const buf = fs.readFileSync(path.join(SHOTS_DIR, file));
      const colors = distinctColorsInTopRows(buf, BLANK_PROBE_ROWS);

      if (colors === null) {
        bad.push(`${file}: could not be decoded — an artifact we cannot inspect is not evidence`);
        continue;
      }
      if (colors < MIN_DISTINCT_COLORS) {
        bad.push(
          `${file}: only ${colors} distinct colour(s) in its top ${BLANK_PROBE_ROWS} rows — ` +
            `the page rendered nothing. Re-capture serially (--workers=1); a parallel run can ` +
            `shoot before the paint lands.`,
        );
      }
    }

    expect(bad, `Blank or undecodable screenshot artifacts:\n${bad.join("\n")}`).toEqual([]);
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
