import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Regression guard for a real bug the live eval caught (2026-07-02): the DeepSeek
 * provider was loaded with a runtime `require("./deepseek")`. Node's require() cannot
 * resolve a TypeScript (`.ts`) module in the vitest/Node runtime (it only resolves
 * `.js/.json/.node`), so it threw "Cannot find module" and silently sent the refine
 * summarizer to its fallback (tokens=0). The `@/` alias was a red herring — ANY runtime
 * require() of a local `.ts` source module breaks. Load local source with a static (or
 * dynamic) `import`, which the bundler/vitest resolve; runtime require() is only safe for
 * node built-ins, installed packages, or files with a resolvable extension (.json/.js).
 */
const ROOT = path.resolve(__dirname, "../..");
const TS_SOURCE_DIRS = ["lib", "app"]; // pure TS/TSX — a bare relative/@ require here targets a .ts
const LOCAL_REQUIRE = /\brequire\(\s*["'`]((?:\.\.?\/|@\/)[^"'`]+)["'`]/g;
const RESOLVABLE_EXT = /\.(json|js|cjs|mjs|node)$/;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".next" || e.name === "dist") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

describe("no runtime require() of a local .ts source module", () => {
  it("lib/ and app/ load local source with import, not a runtime require()", () => {
    const offenders: string[] = [];
    for (const d of TS_SOURCE_DIRS) {
      const abs = path.join(ROOT, d);
      if (!fs.existsSync(abs)) continue;
      for (const file of walk(abs)) {
        const src = fs.readFileSync(file, "utf8");
        for (const m of src.matchAll(LOCAL_REQUIRE)) {
          const target = m[1];
          if (!RESOLVABLE_EXT.test(target)) {
            offenders.push(`${path.relative(ROOT, file)}: require("${target}")`);
          }
        }
      }
    }
    expect(
      offenders,
      `runtime require() of a local .ts module does not resolve outside the bundler — use a static/dynamic import:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});

describe("provider-factory loads its providers without a module-resolution error", () => {
  it("statically loads a valid DeepSeek provider (the path the live eval broke on)", async () => {
    const factory = await import("@/lib/ai/provider-factory");
    expect(typeof factory.getProvider).toBe("function");
    process.env.AI_PROVIDER = "deepseek";
    const provider = factory.getProvider("area_analysis");
    expect(provider).toBeTruthy();
    expect(typeof provider.chat).toBe("function");
  });
});
