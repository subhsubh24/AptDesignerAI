/**
 * Ratchet for `.chat()` call sites that pass a literal `thinkingConfig: {...}`
 * object instead of `thinkingConfig: thinkingFor(task)` (lib/ai/thinking.ts).
 *
 * harness-ratchet.test.ts only checks that SOME `thinkingConfig` is present at
 * a call site — it does not check that the value came from the central
 * `thinkingFor()` policy. A literal object currently happens to match
 * `DEFAULT_THINKING` for its task, so there is no live cost-contract violation
 * today, but if `DEFAULT_THINKING` (lib/ai/models.ts) ever changes for that
 * task, a literal site silently does NOT follow — and nothing fails (APT-24).
 *
 * This is a debt register, not a blessed exception, in the same shape as
 * high-thinking-exceptions.test.ts and the off-system-palette ratchet: it pins
 * the CURRENT literal sites in place (per file, exact count) so the number can
 * only go DOWN as sites migrate to thinkingFor(), and any NEW literal
 * thinkingConfig site — anywhere, including a file with zero today — fails CI
 * immediately instead of silently growing the debt.
 *
 * TO MIGRATE A SITE: replace `thinkingConfig: { thinkingLevel: "X" }` with
 * `thinkingConfig: thinkingFor("task-name")`, where `defaultThinking("task-name")`
 * resolves to the same "X" (verify behavior is unchanged), then lower or delete
 * that file's entry below. The second test FAILS if you forget, so an
 * improvement cannot leave slack behind.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

const ROOT = join(__dirname, "..", "..");
const SCAN_DIRS = ["lib", "app"];

// The provider *implementations* define and forward .chat(); they are the
// floor itself, not callers bound by the contract (same exemption as
// harness-ratchet.test.ts).
const EXEMPT_FILES = new Set([
  "lib/ai/gemini.ts",
  "lib/ai/deepseek.ts",
  "lib/ai/provider-factory.ts",
  "lib/ai/provider.ts",
]);

/**
 * Known literal `thinkingConfig: {...}` sites, by file, with their current
 * count (APT-24). A debt register — migrate entries out via thinkingFor(task),
 * never add a new one, never quietly raise a count.
 */
const KNOWN_LITERAL_SITES: Record<string, number> = {
  "app/api/apartment-research/route.ts": 5,
  "app/api/area-analysis/refine/route.ts": 2,
  "app/api/area-analysis/route.ts": 2,
  "app/api/mobile/analyze/route.ts": 1,
  "lib/agents/bundle-optimizer.ts": 2,
  "lib/agents/category-planner.ts": 2,
  "lib/agents/computer-use/agent-loop.ts": 1,
  "lib/agents/correction-planner.ts": 1,
  "lib/agents/design-coordinator.ts": 1,
  "lib/agents/fit-scorer.ts": 3,
  "lib/agents/furniture-cropper.ts": 1,
  "lib/agents/greedy-decorator.ts": 3,
  "lib/agents/infer-replacements.ts": 1,
  "lib/agents/keep-replace-reconciler.ts": 1,
  "lib/agents/mockup-agent.ts": 1,
  "lib/agents/mockup-prompt-validator.ts": 1,
  "lib/agents/mockup-verifier.ts": 1,
  "lib/agents/photo-grounding-validator.ts": 2,
  "lib/agents/photo-orientation-analyzer.ts": 1,
  "lib/agents/post-search-coordinator.ts": 1,
  "lib/agents/product-extractor.ts": 3,
  "lib/agents/product-identifier.ts": 1,
  "lib/agents/product-verifier.ts": 2,
  "lib/agents/refine-summarizer.ts": 1,
  "lib/agents/reranker.ts": 1,
  "lib/agents/requirement-validator.ts": 1,
  "lib/agents/room-architecture-extractor.ts": 1,
  "lib/agents/room-diagnostician.ts": 1,
  "lib/agents/scene-assembler.ts": 1,
  "lib/agents/self-correction.ts": 3,
  "lib/agents/shopping-researcher.ts": 2,
  "lib/agents/validation-agent.ts": 2,
  "lib/agents/whatitneeds-enricher.ts": 1,
  "lib/ai/complexity-router.ts": 1,
  "lib/ai/semantic-extract.ts": 1,
  "lib/scoring/pairwise-reranker.ts": 1,
};

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

/** Strip block + line comments so prose/examples don't false-positive. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/**
 * A literal `thinkingConfig: {` object. `thinkingConfig: thinkingFor(...)` is
 * NOT matched, which is the point: routing through the policy is how a site
 * leaves this register.
 */
const LITERAL = /\bthinkingConfig\s*:\s*\{/g;

function countLiterals(src: string): number {
  return (stripComments(src).match(LITERAL) ?? []).length;
}

const files = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)));

describe("literal thinkingConfig sites are pinned debt, not free to add (APT-24)", () => {
  it("scans a non-trivial number of source files", () => {
    // Without this, a rename of lib/ or app/ turns every assertion below into
    // a vacuous pass — a guard that scans nothing and reports success.
    expect(files.length).toBeGreaterThan(50);
  });

  it("finds literal thinkingConfig sites only where the register says, at the register's count", () => {
    const found: Record<string, number> = {};
    for (const file of files) {
      const rel = relative(ROOT, file).split("\\").join("/");
      if (EXEMPT_FILES.has(rel)) continue;
      const n = countLiterals(readFileSync(file, "utf8"));
      if (n > 0) found[rel] = n;
    }
    expect(
      found,
      "A literal thinkingConfig site appeared, disappeared, or changed count outside the " +
        "register. New sites: use thinkingFor(task) from lib/ai/thinking.ts instead of a " +
        "literal object. Migrated/removed sites: lower or delete the entry in " +
        "KNOWN_LITERAL_SITES so the ratchet locks in the improvement instead of banking slack.",
    ).toEqual(KNOWN_LITERAL_SITES);
  });

  it("still detects a literal thinkingConfig object (the scan is not vacuous)", () => {
    for (const s of [
      'thinkingConfig: { thinkingLevel: "low" }',
      "thinkingConfig: { thinkingLevel },",
      'thinkingConfig: { thinkingLevel: "low", includeThoughts: true }',
    ]) {
      expect((s.match(LITERAL) ?? []).length, `should have matched in "${s}"`).toBeGreaterThan(0);
    }
    // ...and does not fire on the policy-routed form that replaces it.
    for (const s of ['thinkingConfig: thinkingFor("validation")', "thinkingConfig: thinkingFor(task)"]) {
      expect(s.match(LITERAL), `should NOT have matched in "${s}"`).toBeNull();
    }
  });
});
