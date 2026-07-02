import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Regression guard for a real bug the live eval caught (2026-07-02): a runtime
 * `require("@/lib/ai/deepseek")` used the TS/bundler "@/" path alias, which Node's
 * require() does NOT resolve outside webpack — so it threw "Cannot find module" in
 * the vitest/Node eval runtime and silently broke the refine summarizer (it fell
 * back to a canned string, tokens=0). A runtime `require()` must use a RELATIVE
 * path; only static top-of-file `import` statements may use the "@/" alias (those
 * are resolved by the bundler/vitest, not Node's runtime resolver).
 */
const ROOT = path.resolve(__dirname, "../..");
const DIRS = ["lib", "app", "scripts"];
// Matches a runtime CJS require() whose first arg starts with the "@/" alias.
const ALIAS_REQUIRE = /\brequire\(\s*["'`]@\//;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".next" || e.name === "dist") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx|mjs|cjs|js)$/.test(e.name)) out.push(p);
  }
  return out;
}

describe("no runtime require() using the @/ path alias", () => {
  it("every source file resolves runtime require() with a relative path, not @/", () => {
    const offenders: string[] = [];
    for (const d of DIRS) {
      const abs = path.join(ROOT, d);
      if (!fs.existsSync(abs)) continue;
      for (const file of walk(abs)) {
        fs.readFileSync(file, "utf8")
          .split("\n")
          .forEach((line, i) => {
            if (ALIAS_REQUIRE.test(line)) {
              offenders.push(`${path.relative(ROOT, file)}:${i + 1}  ${line.trim()}`);
            }
          });
      }
    }
    expect(
      offenders,
      `runtime require("@/…") does not resolve outside the bundler — use a relative path:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
