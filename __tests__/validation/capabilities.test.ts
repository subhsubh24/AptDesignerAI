import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Locks the self-validation gate: every external-service capability the app reads must be
// declared in validation/CAPABILITIES.yml. If the loop adds a new `process.env.*` credential
// without declaring HOW CI validates it, this test (and the validate-capabilities CI job)
// fail closed — so the factory can never ship a flow it cannot validate.
const ROOT = path.resolve(__dirname, "..", "..");
const SCANNER = path.join(ROOT, "scripts", "validate-capabilities.mjs");

function run(args: string[], env: Record<string, string> = {}) {
  try {
    const stdout = execFileSync("node", [SCANNER, ...args], {
      cwd: ROOT,
      env: { ...process.env, ...env },
      encoding: "utf8",
    });
    return { code: 0, out: stdout };
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

describe("self-validation capability manifest", () => {
  it("the current codebase is in sync — no undeclared env / no unmet capability", () => {
    const { code, out } = run([]);
    expect(out).toContain("validate-capabilities: OK");
    expect(code).toBe(0);
  });

  it("readiness mode passes (every capability is CI-validatable today)", () => {
    const { code } = run(["--readiness"]);
    expect(code).toBe(0);
  });
});
