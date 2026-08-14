/**
 * Ratchet for `thinkingConfig` values that aren't routed through the central
 * `thinkingFor(task)` policy (lib/ai/thinking.ts).
 *
 * harness-ratchet.test.ts only checks that a `.chat({...})` call has SOME
 * `thinkingConfig` — it does not check that the value came from
 * `thinkingFor()`. A literal object currently happens to match
 * `DEFAULT_THINKING` for its task, so there is no live cost-contract
 * violation today, but if `DEFAULT_THINKING` (lib/ai/models.ts) ever changes
 * for that task, a non-policy-routed site silently does NOT follow — and
 * nothing fails (APT-24).
 *
 * SCOPE — the WHOLE FILE, not just `.chat({...})` calls. An earlier draft of
 * this ratchet scanned only inside brace-matched `.chat({...})` call text
 * (mirroring harness-ratchet.test.ts), which silently dropped
 * `lib/agents/computer-use/agent-loop.ts`'s `thinkingConfig: { thinkingLevel:
 * ThinkingLevel.HIGH }` — a real, pre-existing site that bypasses
 * `geminiProvider.chat()` entirely (calls `ai.models.generateContent()`
 * directly) and is therefore invisible to any `.chat()`-scoped guard. Caught
 * by independent review before this landed. Scanning the whole file instead
 * needs no call-boundary detection at all: every non-optional
 * `thinkingConfig:` key in this codebase (verified — grepped for
 * `^\s*thinkingConfig\s*:` outside `?:` type-annotation fields) is a real
 * call-site value, never an unrelated object shape, so there is nothing else
 * for a whole-file scan to false-positive on. NOTE: `agent-loop.ts`'s site is
 * ALSO tracked by `high-thinking-exceptions.test.ts`'s `KNOWN_BYPASSES`
 * register, for a narrower, HIGH-specific reason (cost-tier drift). The two
 * registers overlap on this one entry by design — that test would stop
 * catching it if it were ever changed to a non-HIGH literal without going
 * through `thinkingFor()`; THIS ratchet keeps catching it either way, which
 * is why both exist.
 *
 * DETECTION: find every `thinkingConfig:` key, then bracket/paren-match its
 * VALUE expression out to the next top-level comma or enclosing close. A
 * value counts as policy-routed only if it is EXACTLY a `thinkingFor(...)`
 * call — not merely prefixed by one. This catches indirection a naive
 * "does `{` immediately follow the colon" check misses — e.g.
 * `context.thinkingConfig ?? { thinkingLevel: "low" }`
 * (lib/agents/validation-agent.ts) or a variable built from a literal via a
 * ternary (lib/agents/mockup-agent.ts) — and also catches the inverse trap of
 * a PREFIX-only check: `thinkingFor("task") ?? { thinkingLevel: "low" }`
 * would pass a naive `/^thinkingFor\(/.test(value)`, masking a real hardcoded
 * fallback behind a legitimate-looking prefix. Both gaps were found by
 * independent review, not written in from the start.
 *
 * This is a debt register, not a blessed exception, in the same shape as
 * high-thinking-exceptions.test.ts and the off-system-palette ratchet: it
 * pins the CURRENT non-policy-routed sites in place (per file, exact count)
 * so the number can only go DOWN as sites migrate to thinkingFor(), and any
 * NEW non-policy-routed site — anywhere, including a file with zero today —
 * fails CI immediately instead of silently growing the debt.
 *
 * TO MIGRATE A SITE: replace the literal/indirect value with
 * `thinkingFor("task-name")`, where `defaultThinking("task-name")` resolves
 * to the same thinking level (verify behavior is unchanged), then lower or
 * delete that file's entry below. The second test FAILS if you forget, so an
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
  "lib/agents/computer-use/agent-loop.ts": 1,
  "lib/agents/product-extractor.ts": 3,
  "lib/agents/self-correction.ts": 3,
  "lib/agents/shopping-researcher.ts": 2,
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
 * Find every `thinkingConfig:` key in the source and extract its VALUE
 * expression — bracket/paren-matched out to the next top-level comma or
 * enclosing close. `thinkingConfig?:` (an optional type-annotation field, not
 * a value assignment) does NOT match, since `?` breaks `\s*` between the
 * identifier and the colon.
 */
function extractThinkingConfigValues(src: string): string[] {
  const values: string[] = [];
  const marker = /\bthinkingConfig\s*:\s*/g;
  let _cursor: RegExpExecArray | null;
  while ((_cursor = marker.exec(src))) {
    let i = marker.lastIndex;
    let depth = 0;
    const start = i;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === "{" || c === "(" || c === "[") depth++;
      else if (c === "}" || c === ")" || c === "]") {
        if (depth === 0) break; // hit the enclosing object's own close
        depth--;
      } else if (c === "," && depth === 0) {
        break;
      }
    }
    values.push(src.slice(start, i).trim());
    marker.lastIndex = i;
  }
  return values;
}

/**
 * True only if `value` is EXACTLY a `thinkingFor(...)` call — not merely
 * prefixed by one. A prefix-only check would classify
 * `thinkingFor("task") ?? { thinkingLevel: "low" }` as policy-routed, which
 * masks a real hardcoded fallback behind a legitimate-looking start.
 */
function isPolicyRouted(value: string): boolean {
  const prefix = /^thinkingFor\s*\(/.exec(value);
  if (!prefix) return false;
  let depth = 0;
  let i = prefix[0].length - 1; // index of the opening '('
  for (; i < value.length; i++) {
    const c = value[i];
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
  }
  return value.slice(i).trim() === "";
}

function countNonPolicySites(src: string): number {
  let n = 0;
  for (const value of extractThinkingConfigValues(src)) {
    if (!isPolicyRouted(value)) n++;
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

  it("catches indirection and a non-.chat() bypass, not just an immediate literal", () => {
    // A first draft matched only `thinkingConfig: {` directly and missed
    // context.thinkingConfig ?? {...} (validation-agent.ts) and a
    // ternary-built variable (mockup-agent.ts). A second draft scoped
    // detection to brace-matched `.chat({...})` calls and silently dropped
    // agent-loop.ts's generateContent()-based bypass. Both were caught by
    // independent review. Pin all three shapes here.
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

    const nonChatBypass = `
      const response = await ai.models.generateContent({
        model,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
        },
      });
    `;
    expect(countNonPolicySites(nonChatBypass)).toBe(1);

    // A thinkingFor(...) PREFIX with a hardcoded fallback tacked on must NOT
    // be classified as policy-routed just because it starts correctly.
    const maskedFallback = `
      const response = await geminiProvider.chat({
        thinkingConfig: thinkingFor("validation") ?? { thinkingLevel: "low" },
      });
    `;
    expect(countNonPolicySites(maskedFallback)).toBe(1);

    // ...and a genuine policy-routed call is not flagged.
    const policyRouted = `
      const response = await geminiProvider.chat({
        model,
        thinkingConfig: thinkingFor("validation"),
      });
    `;
    expect(countNonPolicySites(policyRouted)).toBe(0);
  });
});
