/**
 * Ratchet for HIGH-thinking call sites that bypass the central policy.
 *
 * The cost contract says thinking level comes from `thinkingFor(task)`
 * (lib/ai/thinking.ts -> DEFAULT_THINKING in lib/ai/models.ts), and that HIGH is
 * allowed ONLY where there is no cheap deterministic verifier. Both guards that
 * enforce this — `harness-ratchet.test.ts` and `check-determinism.ts` — only see
 * calls shaped like `.chat({...})`. A call that reaches the SDK directly is
 * invisible to them by construction, so a hardcoded `ThinkingLevel.HIGH` in one
 * can sit at the most expensive tier indefinitely with nothing failing.
 *
 * There is exactly one such site today, and it is a KNOWN, RECORDED violation
 * rather than a blessed exception (see the entry below). This file exists so
 * that fact is enforced instead of remembered: adding a second bypassing HIGH
 * site, or moving the known one, fails CI. It deliberately does NOT bless the
 * exception — it pins it, so it cannot quietly multiply or drift while the
 * proper fix (a cheap default plus an escalation ladder) is outstanding.
 *
 * Do NOT "fix" a failure here by adding the new file to the registry unless the
 * cost contract genuinely permits HIGH for that task. The default answer is to
 * route the call through `thinkingFor(task)`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

const ROOT = join(__dirname, "..", "..");
const SCAN_DIRS = ["lib", "app"];

/**
 * Call sites that set HIGH thinking WITHOUT going through `thinkingFor()`.
 *
 * Each entry must record why it is still here. This is a debt register, not an
 * allowlist of good practice.
 */
const KNOWN_BYPASSES: Record<string, string> = {
  "lib/agents/computer-use/agent-loop.ts":
    "OPEN cost-contract violation, not a blessed exception. `computer_use` is not on the " +
    "contract's allowed-HIGH list, and this task DOES have the cheap deterministic verifier " +
    "the contract asks for (product-verifier.ts parseFinal()/hasData), so the contract's " +
    "answer is a cheap default plus an escalation ladder on that signal — not a hardcoded " +
    "HIGH. Left at its current value because routing it through thinkingFor() today resolves " +
    "to the 'low' fallback (computer_use has no DEFAULT_THINKING entry) and would silently " +
    "degrade a live route, /api/computer-use/product-verify. Pinned here so it cannot spread " +
    "or drift while the ladder is unbuilt.",
};

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry === "node_modules" || entry === ".next") continue;
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry) && !entry.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

/** Strip comments so prose ABOUT high thinking doesn't count as a call site. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/**
 * A HIGH thinking level set as a literal — `ThinkingLevel.HIGH` or
 * `thinkingLevel: "high"`. A `thinkingFor(task)` call is NOT matched, which is
 * the point: routing through the policy is how a site leaves this register.
 */
const HIGH_LITERAL = /\bThinkingLevel\.HIGH\b|\bthinkingLevel\s*:\s*["']high["']/;

const files = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)));

describe("HIGH thinking outside the central policy is pinned, not free", () => {
  it("scans a non-trivial number of source files", () => {
    // Without this, a rename of lib/ or app/ turns every assertion below into a
    // vacuous pass — a guard that scans nothing and reports success.
    expect(files.length).toBeGreaterThan(50);
  });

  it("finds no HIGH literal outside the recorded register", () => {
    const found = files
      .filter((f) => HIGH_LITERAL.test(stripComments(readFileSync(f, "utf8"))))
      .map((f) => relative(ROOT, f).split("\\").join("/"))
      .sort();

    expect(found).toEqual(Object.keys(KNOWN_BYPASSES).sort());
  });

  it("requires every register entry to still be a real call site", () => {
    // The other direction: once a bypass is genuinely fixed, its entry must be
    // deleted. A register that outlives its entries stops meaning anything.
    for (const rel of Object.keys(KNOWN_BYPASSES)) {
      const src = stripComments(readFileSync(join(ROOT, rel), "utf8"));
      expect(HIGH_LITERAL.test(src), `${rel} no longer sets HIGH — delete its register entry`).toBe(
        true
      );
    }
  });

  it("requires every register entry to carry a substantive reason", () => {
    for (const [rel, reason] of Object.entries(KNOWN_BYPASSES)) {
      expect(reason.length, `${rel} needs a real justification, not a placeholder`).toBeGreaterThan(
        80
      );
    }
  });
});
