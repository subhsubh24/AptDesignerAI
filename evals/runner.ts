/**
 * Eval runner — shared helpers for gold-set regression tests.
 *
 * Loads JSON gold cases, scores model outputs against the declared
 * expectations, and returns a per-case verdict the test file can assert
 * on. Kept intentionally framework-light so the same runner can be
 * invoked from Vitest today and from a CI script tomorrow without
 * entangling them.
 */

import fs from "fs";
import path from "path";

export interface GoldCase {
  id: string;
  description: string;
  input: {
    roomType: string;
    imageUrls: string[];
    userContext?: string;
    keepItems?: string[];
    replaceItems?: string[];
    priorities?: string[];
    budgetMode?: "budget" | "balanced" | "high_end";
  };
  expectations: {
    /** Titles/keywords that must appear in `what_works`. */
    mustKeep?: string[];
    /** Titles/keywords that must NOT appear in `what_should_go`. */
    mustNotDrop?: string[];
    /** Palette entries (case-insensitive contains-match). */
    paletteIncludes?: string[];
    /** Minimum validation confidence (0–1). */
    minValidationConfidence?: number;
    /** Required categories in `what_it_needs`. */
    requiredCategories?: string[];
  };
}

export interface EvalVerdict {
  caseId: string;
  passed: boolean;
  failures: string[];
}

const GOLD_DIR = path.join(__dirname, "gold");

/** Load every .json case under evals/gold/. */
export function loadGoldCases(): GoldCase[] {
  if (!fs.existsSync(GOLD_DIR)) return [];
  const cases: GoldCase[] = [];
  for (const file of fs.readdirSync(GOLD_DIR)) {
    if (!file.endsWith(".json")) continue;
    const raw = fs.readFileSync(path.join(GOLD_DIR, file), "utf8");
    cases.push(JSON.parse(raw));
  }
  return cases;
}

/** Case-insensitive substring match used by several expectation checks. */
function matchesAny(needles: string[], haystack: string[]): string[] {
  const lowered = haystack.map((h) => h.toLowerCase());
  const missing: string[] = [];
  for (const needle of needles) {
    const n = needle.toLowerCase();
    if (!lowered.some((h) => h.includes(n))) missing.push(needle);
  }
  return missing;
}

/**
 * Score a pipeline output against a gold case's expectations.
 *
 * `output` is the `analysis` object returned by area-analysis (or a
 * compatible shape — the checker tolerates missing fields so the runner
 * can evolve alongside the schema).
 */
export function scoreAgainstExpectations(
  gold: GoldCase,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- analysis shape varies
  output: Record<string, any>,
  validationConfidence?: number
): EvalVerdict {
  const failures: string[] = [];
  const exp = gold.expectations;

  // mustKeep: expect each needle in `what_works`.
  if (exp.mustKeep && exp.mustKeep.length > 0) {
    const whatWorks: string[] = Array.isArray(output.what_works)
      ? (output.what_works as string[])
      : [];
    const missing = matchesAny(exp.mustKeep, whatWorks);
    if (missing.length > 0) {
      failures.push(`missing from what_works: ${missing.join(", ")}`);
    }
  }

  // mustNotDrop: expect no needle in `what_should_go`.
  if (exp.mustNotDrop && exp.mustNotDrop.length > 0) {
    const whatShouldGo: string[] = Array.isArray(output.what_should_go)
      ? (output.what_should_go as string[])
      : [];
    const present = exp.mustNotDrop.filter((needle) =>
      whatShouldGo.some((s) => s.toLowerCase().includes(needle.toLowerCase()))
    );
    if (present.length > 0) {
      failures.push(`should not be in what_should_go: ${present.join(", ")}`);
    }
  }

  // paletteIncludes: at least one needle must match.
  if (exp.paletteIncludes && exp.paletteIncludes.length > 0) {
    const palette: string[] = Array.isArray(output.recommended_palette)
      ? (output.recommended_palette as string[])
      : [];
    const anyMatch = exp.paletteIncludes.some((needle) =>
      palette.some((p) => p.toLowerCase().includes(needle.toLowerCase()))
    );
    if (!anyMatch) {
      failures.push(
        `palette missed all expected tones: wanted one of [${exp.paletteIncludes.join(", ")}], got [${palette.join(", ")}]`
      );
    }
  }

  // requiredCategories: each category must appear in `what_it_needs`.
  if (exp.requiredCategories && exp.requiredCategories.length > 0) {
    const cats: string[] = Array.isArray(output.what_it_needs)
      ? (output.what_it_needs as { category?: string }[]).map(
          (n) => n.category ?? ""
        )
      : [];
    const missing = matchesAny(exp.requiredCategories, cats);
    if (missing.length > 0) {
      failures.push(`missing categories: ${missing.join(", ")}`);
    }
  }

  // minValidationConfidence: threshold check.
  if (
    typeof exp.minValidationConfidence === "number" &&
    typeof validationConfidence === "number" &&
    validationConfidence < exp.minValidationConfidence
  ) {
    failures.push(
      `validation confidence ${validationConfidence} < min ${exp.minValidationConfidence}`
    );
  }

  return {
    caseId: gold.id,
    passed: failures.length === 0,
    failures,
  };
}

/** Convenience: true when the RUN_EVALS env flag opts into live API calls. */
export function evalsEnabled(): boolean {
  return process.env.RUN_EVALS === "1";
}
