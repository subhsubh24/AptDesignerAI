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
