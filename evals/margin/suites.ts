/**
 * Suite registry — the set of AI workflows the Margin eval runner can drive.
 * The runner selects one via `--workflow <name>` or runs them all.
 */

import type { Suite } from "./suite";
import { searchSuite } from "./search-suite";
import { fitScoringSuite } from "./fit-scoring";
import { diagnosisSuite } from "./diagnosis";

export const SUITES: Suite[] = [searchSuite, fitScoringSuite, diagnosisSuite];

export function allSuites(): Suite[] {
  return SUITES;
}

export function suiteNames(): string[] {
  return SUITES.map((s) => s.workflow);
}

/** Resolve a `--workflow` value: a suite slug, or "all"/undefined for every suite. */
export function selectSuites(name?: string): Suite[] {
  if (!name || name === "all") return SUITES;
  const found = SUITES.find((s) => s.workflow === name);
  if (!found) {
    throw new Error(`unknown --workflow "${name}". Known: ${suiteNames().join(", ")}, all`);
  }
  return [found];
}
