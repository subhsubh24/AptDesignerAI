/**
 * Unit coverage for the Margin eval suite — the INPUT MATRIX and the GRADER.
 *
 * These are pure (no network, no keys) so they run in the normal `npm test` / CI
 * gate. Their job is to prove two things the eval's honesty rests on:
 *   1. The matrix is real, varied, and asserts a defined outcome where one exists.
 *   2. The grader is NOT always-pass: it maps the genuine pipeline signal
 *      (validation.isValid + confidence) to pass/quality, and flags a case whose
 *      real outcome contradicts its expectation.
 */

import { describe, it, expect } from "vitest";
import { buildCaseMatrix } from "@/evals/margin/cases";
import { gradeCase, summarize, type GradableResult } from "@/evals/margin/grade";
import { buildFitCases, gradeFit } from "@/evals/margin/fit-scoring";
import { buildDiagnosisCases, gradeDiagnosis } from "@/evals/margin/diagnosis";
import { SUITES, selectSuites, suiteNames } from "@/evals/margin/suites";

describe("margin eval — input matrix", () => {
  const cases = buildCaseMatrix();

  it("has 40–80 genuinely-varied, uniquely-identified cases", () => {
    expect(cases.length).toBeGreaterThanOrEqual(40);
    expect(cases.length).toBeLessThanOrEqual(80);
    const ids = new Set(cases.map((c) => c.id));
    expect(ids.size).toBe(cases.length); // all distinct
  });

  it("spans every owner dimension: room type × budget × #images × image quality × style", () => {
    const rooms = new Set(cases.map((c) => c.roomType));
    const budgets = new Set(cases.map((c) => c.budgetMode));
    const styles = new Set(cases.map((c) => c.style));
    const counts = new Set(cases.map((c) => c.imageCount));
    const qualities = new Set(cases.map((c) => c.imageQuality));
    expect(rooms.size).toBeGreaterThanOrEqual(5);
    expect(budgets.size).toBe(3);
    expect(styles.size).toBeGreaterThanOrEqual(5);
    expect(counts.size).toBeGreaterThanOrEqual(3);
    expect(qualities).toEqual(new Set(["high", "low"]));
  });

  it("spans easy→hard difficulty", () => {
    const diffs = new Set(cases.map((c) => c.difficulty));
    expect(diffs).toEqual(new Set(["easy", "medium", "hard"]));
  });

  it("asserts the impossible-budget cases MUST fail (a defined outcome)", () => {
    const impossible = cases.filter((c) => c.expect?.shouldPass === false);
    expect(impossible.length).toBeGreaterThanOrEqual(3);
    for (const c of impossible) {
      expect(c.budgetDollars).toBeGreaterThan(0);
      expect(c.budgetDollars!).toBeLessThan(200); // genuinely impossible for a 3-piece set
    }
  });

  it("uses only real, fetchable https image URLs (deep-scorer downloads them)", () => {
    for (const c of cases) {
      expect(c.imageUrls.length).toBe(c.imageCount);
      for (const u of c.imageUrls) expect(u).toMatch(/^https:\/\/images\.unsplash\.com\//);
    }
  });

  it("includes a seeded fuzz/boundary tail (deterministic across builds)", () => {
    const fuzz = cases.filter((c) => c.id.startsWith("fuzz-"));
    expect(fuzz.length).toBeGreaterThanOrEqual(8);
    // Fuzz explores boundary #images (up to 5) and degenerate empty briefs.
    expect(Math.max(...fuzz.map((c) => c.imageCount))).toBeGreaterThanOrEqual(4);
    expect(fuzz.some((c) => c.userContext === "")).toBe(true);
    // Deterministic: a rebuild yields identical ids.
    expect(buildCaseMatrix().map((c) => c.id)).toEqual(cases.map((c) => c.id));
  });
});

describe("margin eval — grader (genuine, never always-pass)", () => {
  const cases = buildCaseMatrix();
  const coreCase = cases.find((c) => c.id.startsWith("core-"))!;
  const impossibleCase = cases.find((c) => c.expect?.shouldPass === false)!;

  const validResult = (confidence: number, isValid: boolean): GradableResult => ({
    success: true,
    data: {
      validation: { isValid, confidence, issues: isValid ? [] : ["over budget"] },
      stats: { tokensUsed: 12345 },
      candidatesByCategory: { area_rug: [{}, {}], coffee_table: [{}] },
    },
  });

  it("maps a strong, valid bundle to passed + high quality", () => {
    const g = gradeCase(coreCase, validResult(8.6, true));
    expect(g.ran).toBe(true);
    expect(g.passed).toBe(true);
    expect(g.qualityScore).toBeCloseTo(0.86, 5);
    expect(g.confidence).toBe(8.6);
  });

  it("maps a weak/invalid bundle to failed + low quality (NOT a pass)", () => {
    const g = gradeCase(coreCase, validResult(3.1, false));
    expect(g.passed).toBe(false);
    expect(g.qualityScore).toBeCloseTo(0.31, 5);
  });

  it("grades a pipeline that did not complete as a real failure, quality 0", () => {
    const g = gradeCase(coreCase, { success: false, error: "TAVILY_API_KEY is not set" });
    expect(g.ran).toBe(false);
    expect(g.passed).toBe(false);
    expect(g.qualityScore).toBe(0);
  });

  it("CONFIRMS the expectation when an impossible-budget case fails", () => {
    const g = gradeCase(impossibleCase, validResult(2.0, false));
    expect(g.passed).toBe(false);
    expect(g.expectationMet).toBe(true);
    expect(g.notes.some((n) => n.includes("EXPECTATION MISS"))).toBe(false);
  });

  it("FLAGS an expectation MISS when an impossible-budget case wrongly passes", () => {
    const g = gradeCase(impossibleCase, validResult(9.0, true));
    expect(g.passed).toBe(true);
    expect(g.expectationMet).toBe(false); // this is the whole point — it catches wrong outcomes
    expect(g.notes.some((n) => n.includes("EXPECTATION MISS"))).toBe(true);
  });

  it("summarize aggregates pass rate, quality, and expectation misses", () => {
    const grades = [
      gradeCase(coreCase, validResult(8.0, true)),
      gradeCase(impossibleCase, validResult(9.0, true)), // a miss
      gradeCase(coreCase, { success: false, error: "boom" }),
    ];
    const s = summarize(grades);
    expect(s.total).toBe(3);
    expect(s.ran).toBe(2);
    expect(s.passed).toBe(2);
    expect(s.expectationMisses).toBe(1);
    expect(s.totalTokens).toBeGreaterThan(0);
  });
});

describe("margin eval — fit-scoring suite", () => {
  const cases = buildFitCases();

  it("has curated good-fit AND bad-fit asserted cases, plus a fuzz tail", () => {
    const good = cases.filter((c) => c.expect?.shouldPass === true);
    const bad = cases.filter((c) => c.expect?.shouldPass === false);
    const fuzz = cases.filter((c) => c.id.startsWith("fit-fuzz-"));
    expect(good.length).toBeGreaterThanOrEqual(2);
    expect(bad.length).toBeGreaterThanOrEqual(2);
    expect(fuzz.length).toBeGreaterThanOrEqual(4);
    const ids = new Set(cases.map((c) => c.id));
    expect(ids.size).toBe(cases.length);
  });

  it("grader maps a high fit score to passed and a low score to failed (never always-pass)", () => {
    const good = cases.find((c) => c.expect?.shouldPass === true)!;
    const bad = cases.find((c) => c.expect?.shouldPass === false)!;
    const hi = gradeFit(good, { success: true, data: { final_item_score: 8.4, scores: { confidence_score: 8 } }, tokensUsed: 900 });
    expect(hi.passed).toBe(true);
    expect(hi.qualityScore).toBeCloseTo(0.84, 5);
    expect(hi.expectationMet).toBe(true);

    const lo = gradeFit(bad, { success: true, data: { final_item_score: 2.5, scores: { confidence_score: 7 } }, tokensUsed: 900 });
    expect(lo.passed).toBe(false);
    expect(lo.expectationMet).toBe(true); // a bad-fit product SHOULD score low
  });

  it("FLAGS a miss when a clearly-bad product scores high", () => {
    const bad = cases.find((c) => c.expect?.shouldPass === false)!;
    const g = gradeFit(bad, { success: true, data: { final_item_score: 9, scores: { confidence_score: 9 } } });
    expect(g.passed).toBe(true);
    expect(g.expectationMet).toBe(false);
    expect(g.notes.some((n) => n.includes("EXPECTATION MISS"))).toBe(true);
  });

  it("grades a scorer error as failed, quality 0", () => {
    const g = gradeFit(cases[0], { success: false, error: "boom" });
    expect(g.ran).toBe(false);
    expect(g.qualityScore).toBe(0);
  });
});

describe("margin eval — diagnosis suite", () => {
  const cases = buildDiagnosisCases();

  it("has asserted room-type-mismatch cases (must fail) plus a fuzz tail", () => {
    const mustFail = cases.filter((c) => c.expect?.shouldPass === false);
    const fuzz = cases.filter((c) => c.id.startsWith("diag-fuzz-"));
    expect(mustFail.length).toBeGreaterThanOrEqual(2);
    expect(fuzz.length).toBeGreaterThanOrEqual(3);
    for (const c of mustFail) expect(c.roomType).not.toBe(c.photoRoom); // declared ≠ photographed
  });

  it("grades a complete diagnosis as passed and an empty one as failed", () => {
    const good = cases.find((c) => c.expect?.shouldPass === true)!;
    const full = gradeDiagnosis(good, {
      success: true,
      data: { diagnosis: {}, design_direction: {}, missing_categories: ["rug"], action_list: [{}, {}, {}] },
      tokensUsed: 1500,
    });
    expect(full.passed).toBe(true);
    expect(full.qualityScore).toBeCloseTo(1, 5);
    expect(full.expectationMet).toBe(true);

    const empty = gradeDiagnosis(good, { success: true, data: { diagnosis: {}, design_direction: {}, missing_categories: [], action_list: [] } });
    expect(empty.passed).toBe(false);
  });

  it("CONFIRMS the expectation when a room-type mismatch hard-gates to failure", () => {
    const mismatch = cases.find((c) => c.expect?.shouldPass === false)!;
    const g = gradeDiagnosis(mismatch, { success: false, error: "Room type mismatch: photos look like bedroom" });
    expect(g.passed).toBe(false);
    expect(g.expectationMet).toBe(true);
  });
});

describe("margin eval — suite registry", () => {
  it("registers search, fit-scoring, and diagnosis with distinct workflow_ids", () => {
    expect(suiteNames()).toEqual(["search", "fit-scoring", "diagnosis"]);
    const ids = SUITES.map((s) => s.workflowId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("aptdesigner-search");
    expect(ids).toContain("aptdesigner-fit-scoring");
    expect(ids).toContain("aptdesigner-diagnosis");
  });

  it("selectSuites picks one by slug, all by default, and rejects unknowns", () => {
    expect(selectSuites("fit-scoring").map((s) => s.workflow)).toEqual(["fit-scoring"]);
    expect(selectSuites("all").length).toBe(SUITES.length);
    expect(selectSuites(undefined).length).toBe(SUITES.length);
    expect(() => selectSuites("nope")).toThrow(/unknown --workflow/);
  });
});
