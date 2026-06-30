import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Locks the GTM honesty gate: the GTM Factory cannot report a GROWTH_STATUS metric without a
// connected source (fabrication risk), and the GTM scorecard must be well-formed. Defense in
// depth alongside the validate-gtm CI job.
const ROOT = path.resolve(__dirname, "..", "..");
const SCANNER = path.join(ROOT, "scripts", "validate-gtm.mjs");

function run(args: string[] = []) {
  try {
    const out = execFileSync("node", [SCANNER, ...args], { cwd: ROOT, encoding: "utf8" });
    return { code: 0, out };
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

describe("GTM honesty gate", () => {
  it("passes on the current GROWTH_STATUS (no metric without a source)", () => {
    const { code, out } = run();
    expect(out).toContain("validate-gtm: OK");
    expect(code).toBe(0);
  });
});
