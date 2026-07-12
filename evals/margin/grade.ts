/**
 * Margin eval — the grader.
 *
 * Scores one `runAgenticSearch` result against the REAL pipeline success signal:
 *   - passed        = validation.isValid           (the genuine pass/fail)
 *   - qualityScore  = validation.confidence / 10    (0–1, the graded quality)
 * It is NOT an always-pass stub: a low-confidence or invalid bundle grades as
 * failed with a low score, and where a case declares an expected outcome
 * (`expect.shouldPass`) the grader verifies the direction and flags a MISS.
 *
 * The grader reads only the fields it needs, so a synthetic result can be graded
 * in a unit test (no network) — that test is what proves the grader distinguishes
 * good bundles from bad.
 */

import type { MarginEvalCase } from "./cases";

/** Minimal structural view of `AgentResult<OrchestrationResult>` the grader needs. */
export interface GradableResult {
  success: boolean;
  error?: string;
  data?: {
    validation?: { isValid: boolean; confidence: number; issues?: string[] };
    stats?: { tokensUsed?: number };
    candidatesByCategory?: Record<string, unknown[]>;
  };
}

export interface Grade {
  caseId: string;
  /** True when the pipeline produced a result at all (no thrown/failed run). */
  ran: boolean;
  /** The genuine outcome — validation.isValid. */
  passed: boolean;
  /** validation.confidence, 0–10. */
  confidence: number;
  /** Productivity quality, 0–1 (confidence / 10). */
  qualityScore: number;
  /** Candidates the search actually found (0 usually means Tavily/network gap). */
  candidateCount: number;
  /** Pipeline token total (data.stats.tokensUsed) for a local cost estimate. */
  tokensUsed: number;
  /** null when the case makes no assertion; else passed === expect.shouldPass. */
  expectationMet: boolean | null;
  notes: string[];
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** How the outcome was graded — recorded on the Margin outcome (qualityMethod). */
export const QUALITY_METHOD = "llm_judge";

export function gradeCase(c: MarginEvalCase, result: GradableResult): Grade {
  const notes: string[] = [];
  const tokensUsed = result.data?.stats?.tokensUsed ?? 0;
  const candidateCount = Object.values(result.data?.candidatesByCategory ?? {}).reduce(
    (n, arr) => n + (Array.isArray(arr) ? arr.length : 0),
    0,
  );

  const assertOutcome = (passed: boolean): boolean | null => {
    if (!c.expect) return null;
    const met = passed === c.expect.shouldPass;
    if (!met) {
      notes.push(
        `EXPECTATION MISS: expected passed=${c.expect.shouldPass} (${c.expect.why}) — got passed=${passed}`,
      );
    }
    return met;
  };

  // A thrown/failed run is a real failed outcome (0 quality) — never silently passed.
  if (!result.success) {
    notes.push(`pipeline did not complete: ${result.error ?? "unknown error"}`);
    return {
      caseId: c.id,
      ran: false,
      passed: false,
      confidence: 0,
      qualityScore: 0,
      candidateCount,
      tokensUsed,
      expectationMet: assertOutcome(false),
      notes,
    };
  }

  const v = result.data?.validation;
  const passed = v?.isValid ?? false;
  const confidence = v?.confidence ?? 0;

  if (candidateCount === 0) {
    notes.push("no candidates found — check TAVILY_API_KEY / network egress (outcome will read as failed)");
  }
  if (!v) {
    notes.push("result had no validation block — grading as failed");
  }

  return {
    caseId: c.id,
    ran: true,
    passed,
    confidence,
    qualityScore: clamp01(confidence / 10),
    candidateCount,
    tokensUsed,
    expectationMet: assertOutcome(passed),
    notes,
  };
}

export interface EvalSummary {
  total: number;
  ran: number;
  passed: number;
  passRate: number;
  avgQuality: number;
  avgConfidence: number;
  expectationsChecked: number;
  expectationMisses: number;
  totalTokens: number;
}

export function summarize(grades: Grade[]): EvalSummary {
  const ran = grades.filter((g) => g.ran);
  const passed = grades.filter((g) => g.passed);
  const checked = grades.filter((g) => g.expectationMet !== null);
  const misses = grades.filter((g) => g.expectationMet === false);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  return {
    total: grades.length,
    ran: ran.length,
    passed: passed.length,
    passRate: grades.length ? passed.length / grades.length : 0,
    avgQuality: avg(ran.map((g) => g.qualityScore)),
    avgConfidence: avg(ran.map((g) => g.confidence)),
    expectationsChecked: checked.length,
    expectationMisses: misses.length,
    totalTokens: grades.reduce((n, g) => n + g.tokensUsed, 0),
  };
}
