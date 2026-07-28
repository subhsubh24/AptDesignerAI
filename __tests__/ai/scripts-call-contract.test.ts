/**
 * Cost + determinism contract for provider calls under `scripts/`.
 *
 * `__tests__/ai/harness-ratchet.test.ts` is the ratchet for the cost contract,
 * but it scans `lib/` and `app/` only. A live `geminiProvider.chat()` in
 * `scripts/` is therefore invisible to it BY CONSTRUCTION — not by exemption —
 * and that blind spot is exactly where one turned up:
 * `scripts/seed-product-embeddings.ts` carried a googleSearch-grounded call
 * with no `thinkingConfig` and no `seed`, violating both the cost contract
 * ("every .chat() passes an explicit thinkingConfig") and the determinism rule
 * ("all LLM calls pass seed").
 *
 * This closes the hole without touching the ratchet itself (a hook forbids
 * editing it), and it ratchets in BOTH directions the sibling does not: seed as
 * well as thinkingConfig.
 *
 * If this fails, do NOT relax it — add the missing config to the call site.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { join, relative } from "path";

const ROOT = join(__dirname, "..", "..");
const SCAN_DIR = "scripts";

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry === "node_modules" || entry === ".next") continue;
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

/** Strip comments so a commented-out example can't false-positive. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** Brace-match each `.chat({ ... })` argument object. */
function findChatCalls(src: string): string[] {
  const calls: string[] = [];
  const marker = ".chat({";
  let idx = src.indexOf(marker);
  while (idx !== -1) {
    let depth = 0;
    let i = idx + marker.length - 1;
    const start = i;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === "{") depth++;
      else if (c === "}" && --depth === 0) break;
    }
    calls.push(src.slice(start, i + 1));
    idx = src.indexOf(marker, i + 1);
  }
  return calls;
}

const files = existsSync(join(ROOT, SCAN_DIR)) ? walk(join(ROOT, SCAN_DIR)) : [];

describe("scripts/ provider calls honour the cost + determinism contracts", () => {
  it("actually finds the scripts directory and files in it", () => {
    // Without this, a rename of scripts/ would turn the whole suite into a
    // vacuous pass — the failure mode where a guard scans nothing and reports
    // success.
    expect(files.length).toBeGreaterThanOrEqual(3);
  });

  it("finds at least one .chat() call to check", () => {
    // Same reasoning one level down: if every provider call moved out of
    // scripts/, this file should be deleted deliberately, not silently pass.
    const total = files.reduce(
      (n, f) => n + findChatCalls(stripComments(readFileSync(f, "utf8"))).length,
      0,
    );
    expect(total).toBeGreaterThan(0);
  });

  it("passes an explicit thinkingConfig on every .chat() call", () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const call of findChatCalls(stripComments(readFileSync(file, "utf8")))) {
        if (!/\bthinkingConfig\s*:/.test(call)) offenders.push(relative(ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("passes a seed on every .chat() call", () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const call of findChatCalls(stripComments(readFileSync(file, "utf8")))) {
        if (!/\bseed\s*:/.test(call)) offenders.push(relative(ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});
