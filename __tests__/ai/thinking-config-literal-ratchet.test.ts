/**
 * Ratchet for `.chat()` call sites whose `thinkingConfig` value isn't routed
 * through the central `thinkingFor(task)` policy (lib/ai/thinking.ts).
 *
 * harness-ratchet.test.ts only checks that SOME `thinkingConfig` is present at
 * a call site — it does not check that the value came from `thinkingFor()`.
 * A literal object currently happens to match `DEFAULT_THINKING` for its task,
 * so there is no live cost-contract violation today, but if `DEFAULT_THINKING`
 * (lib/ai/models.ts) ever changes for that task, a non-policy-routed site
 * silently does NOT follow — and nothing fails (APT-24).
 *
 * DETECTION: mirrors harness-ratchet.test.ts's `.chat({...})` brace-matching
 * (not a naive whole-file regex), then for every `thinkingConfig:` key inside
 * that call, brace/paren-matches its VALUE expression out to the next
 * top-level comma or the call's closing brace. A value counts as
 * policy-routed only if it textually starts with `thinkingFor(`. This catches
 * not just a direct literal (`{ thinkingLevel: "low" }`) but also indirection
 * that a naive "does `{` immediately follow the colon" check misses — e.g.
 * `context.thinkingConfig ?? { thinkingLevel: "low" }` (lib/agents/validation-agent.ts)
 * or a variable built from a literal via a ternary (lib/agents/mockup-agent.ts)
 * — both real, already-existing hardcoded fallbacks that a first draft of this
 * ratchet (naive `\bthinkingConfig\s*:\s*\{` matching) missed entirely, caught
 * by independent review before this landed.
 *
 * This is a debt register, not a blessed exception, in the same shape as
 * high-thinking-exceptions.test.ts and the off-system-palette ratchet: it pins
 * the CURRENT non-policy-routed sites in place (per file, exact count) so the
 * number can only go DOWN as sites migrate to thinkingFor(), and any NEW
 * non-policy-routed site — anywhere, including a file with zero today — fails
 * CI immediately instead of silently growing the debt.
 *
 * TO MIGRATE A SITE: replace the literal/indirect value with
 * `thinkingFor("task-name")`, where `defaultThinking("task-name")` resolves to
 * the same thinking level (verify behavior is unchanged), then lower or delete
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
 * Known non-policy-routed `thinkingConfig` sites, by file, with their current
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
  "lib/agents/correction-planner.ts": 1,
  "lib/agents/design-coordinator.ts": 1,
  "lib/agents/fit-scorer.ts": 3,
  "lib/agents/furniture-cropper.ts": 1,
  "lib/agents/greedy-decorator.ts": 3,
  "lib/agents/infer-replacements.ts": 1,
  "lib/agents/keep-replace-reconciler.ts": 1,
  "lib/agents/mockup-agent.ts": 2,
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
  "lib/agents/validation-agent.ts": 6,
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

/** Find each `.chat({ ... })` call and return the brace-matched argument text. */
function findChatCalls(src: string): string[] {
  const calls: string[] = [];
  const marker = ".chat({";
  let idx = src.indexOf(marker);
  while (idx !== -1) {
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

/**
 * Within a brace-matched `.chat({...})` call, find every `thinkingConfig:`
 * key and extract its value expression — bracket/paren-matched out to the
 * next top-level comma or the enclosing object's closing brace. This is what
 * lets `context.thinkingConfig ?? { thinkingLevel: "low" }` and a plain
 * variable reference (e.g. `thinkingCfg`, itself built elsewhere from a
 * literal) both get inspected as real values, not just an immediate `{`.
 */
function extractThinkingConfigValues(callText: string): string[] {
  const values: string[] = [];
  const marker = /\bthinkingConfig\s*:\s*/g;
  let _m: RegExpExecArray | null;
  while ((_m = marker.exec(callText))) {
    let i = marker.lastIndex;
    let depth = 0;
    const start = i;
    for (; i < callText.length; i++) {
      const c = callText[i];
      if (c === "{" || c === "(" || c === "[") depth++;
      else if (c === "}" || c === ")" || c === "]") {
        if (depth === 0) break; // hit the enclosing call's own close
        depth--;
      } else if (c === "," && depth === 0) {
        break;
      }
    }
    values.push(callText.slice(start, i).trim());
    marker.lastIndex = i;
  }
  return values;
}

/** A value routed through the central policy function. */
const POLICY_ROUTED = /^thinkingFor\s*\(/;

function countNonPolicySites(src: string): number {
  let n = 0;
  for (const call of findChatCalls(src)) {
    if (!call.includes("thinkingConfig")) continue;
    for (const value of extractThinkingConfigValues(call)) {
      if (!POLICY_ROUTED.test(value)) n++;
    }
  }
  return n;
}

const files = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)));

describe("thinkingConfig sites not routed through thinkingFor() are pinned debt (APT-24)", () => {
  it("scans a non-trivial number of source files", () => {
    // Without this, a rename of lib/ or app/ turns every assertion below into
    // a vacuous pass — a guard that scans nothing and reports success.
    expect(files.length).toBeGreaterThan(50);
  });

  it("finds non-policy-routed thinkingConfig sites only where the register says, at the register's count", () => {
    const found: Record<string, number> = {};
    for (const file of files) {
      const rel = relative(ROOT, file).split("\\").join("/");
      if (EXEMPT_FILES.has(rel)) continue;
      const n = countNonPolicySites(stripComments(readFileSync(file, "utf8")));
      if (n > 0) found[rel] = n;
    }
    expect(
      found,
      "A non-policy-routed thinkingConfig site appeared, disappeared, or changed count " +
        "outside the register. New sites: use thinkingFor(task) from lib/ai/thinking.ts " +
        "instead of a literal or indirect value. Migrated/removed sites: lower or delete the " +
        "entry in KNOWN_LITERAL_SITES so the ratchet locks in the improvement instead of " +
        "banking slack.",
    ).toEqual(KNOWN_LITERAL_SITES);
  });

  it("catches indirection, not just an immediate literal (the scan is not naive)", () => {
    // A first draft of this ratchet matched only `thinkingConfig: {` directly
    // and missed both of these real, pre-existing shapes (lib/agents/validation-agent.ts
    // and lib/agents/mockup-agent.ts) — caught by independent review. Pin both
    // shapes here so a future simplification can't reintroduce the blind spot.
    const fallback = `
      const response = await geminiProvider.chat({
        model,
        thinkingConfig: context.thinkingConfig ?? { thinkingLevel: "low" },
      });
    `;
    expect(countNonPolicySites(fallback)).toBe(1);

    const variableIndirection = `
      const thinkingCfg = isProModel ? undefined : { thinkingLevel: requestedLevel };
      const response = await geminiProvider.chat({
        model,
        ...(thinkingCfg ? { thinkingConfig: thinkingCfg } : {}),
      });
    `;
    expect(countNonPolicySites(variableIndirection)).toBe(1);

    // ...and does not fire on the policy-routed form that replaces them.
    const policyRouted = `
      const response = await geminiProvider.chat({
        model,
        thinkingConfig: thinkingFor("validation"),
      });
    `;
    expect(countNonPolicySites(policyRouted)).toBe(0);
  });
});
