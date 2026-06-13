/**
 * Harness ratchet — mechanical enforcement of the cost contract.
 *
 * Osmani's ratchet principle: "anytime you find an agent makes a mistake, you
 * engineer a solution such that the agent never makes that mistake again."
 *
 * The mistake this guards: the global Gemini default was once forced to HIGH
 * thinking (gemini.ts), so ~60 structured-output call sites silently paid
 * top-tier reasoning cost. We fixed the default to "low" and annotated every
 * call site with an explicit, task-appropriate `thinkingConfig`. This test
 * locks that in: a NEW `.chat({...})` call with no explicit thinkingConfig
 * fails CI, and the provider floors can never drift back to expensive.
 *
 * If this test fails, do NOT relax it — add the missing thinkingConfig (use
 * `thinkingFor(task)` from lib/ai/thinking.ts) to the offending call site.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..", "..");
const SCAN_DIRS = ["lib", "app"];

// The provider *implementations* define and forward .chat(); they are the
// floor itself, not callers bound by the contract.
const EXEMPT_FILES = new Set([
  "lib/ai/gemini.ts",
  "lib/ai/deepseek.ts",
  "lib/ai/provider-factory.ts",
  "lib/ai/provider.ts",
]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry === "node_modules" || entry === ".next") continue;
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

/** Strip block + line comments so commented-out examples don't false-positive. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "") // block comments (incl. JSDoc)
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1"); // line comments, preserving URLs (://)
}

/** Find each `.chat({ ... })` call and return the brace-matched argument text. */
function findChatCalls(src: string): string[] {
  const calls: string[] = [];
  const marker = ".chat({";
  let idx = src.indexOf(marker);
  while (idx !== -1) {
    // Start at the opening brace of the object literal.
    let depth = 0;
    let i = idx + marker.length - 1; // points at '{'
    const start = i;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    calls.push(src.slice(start, i + 1));
    idx = src.indexOf(marker, i + 1);
  }
  return calls;
}

describe("harness ratchet: every .chat() call sets explicit thinkingConfig", () => {
  const files = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)));

  it("scans a non-trivial number of source files", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("has no .chat() call without an explicit thinkingConfig", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = file.slice(ROOT.length + 1);
      if (EXEMPT_FILES.has(rel)) continue;
      const src = stripComments(readFileSync(file, "utf8"));
      for (const call of findChatCalls(src)) {
        if (!call.includes("thinkingConfig")) {
          const firstLine = call.split("\n").slice(0, 2).join(" ").slice(0, 80);
          offenders.push(`${rel}: ${firstLine}`);
        }
      }
    }
    expect(
      offenders,
      `Found .chat() calls without explicit thinkingConfig. Add thinkingFor(task):\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
