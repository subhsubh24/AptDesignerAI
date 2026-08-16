/**
 * Unit tests for the eval RUNNER itself (loadGoldCases + scoreAgainstExpectations).
 * These exercise the scoring helpers against known input/output pairs and do NOT
 * hit the live Gemini API, so they run in the standard `npm test` suite.
 *
 * (Previously these lived in refine.eval.test.ts, which mislabeled runner unit
 * tests as a live eval. The real live refine-stage eval now lives in
 * refine.eval.test.ts, gated behind RUN_EVALS=1.)
 */

import { describe, it, expect } from "vitest";
import { loadGoldCases, scoreAgainstExpectations } from "../runner";

describe("eval runner — gold cases", () => {
  it("loads every gold case file under evals/gold/", () => {
    const cases = loadGoldCases();
    expect(cases.length).toBeGreaterThan(0);
    for (const c of cases) {
      expect(c.id).toBeTruthy();
      expect(c.input).toBeTruthy();
      expect(c.expectations).toBeTruthy();
    }
  });

  it("passes a matching output against its gold expectations", () => {
    const cases = loadGoldCases();
    const sectional = cases.find((c) => c.id === "great-room-keep-leather-sectional");
    expect(sectional).toBeTruthy();
    if (!sectional) return;

    const fakeOutput = {
      what_works: ["leather sectional anchors the room", "oak flooring"],
      what_should_go: ["cracked plastic side table"],
      recommended_palette: ["terracotta", "warm white", "camel", "walnut"],
      what_it_needs: [
        { category: "floor_lamp", search_title: "warm brass floor lamp" },
      ],
    };
    const verdict = scoreAgainstExpectations(sectional, fakeOutput, 0.85);
    expect(verdict.passed).toBe(true);
    expect(verdict.failures).toEqual([]);
  });

  it("fails when the leather sectional is wrongly dropped", () => {
    const cases = loadGoldCases();
    const sectional = cases.find((c) => c.id === "great-room-keep-leather-sectional");
    if (!sectional) throw new Error("fixture missing");

    const badOutput = {
      what_works: ["oak flooring"],
      what_should_go: ["leather sectional", "cracked plastic side table"],
      recommended_palette: ["terracotta", "warm white", "camel"],
      what_it_needs: [{ category: "floor_lamp" }],
    };
    const verdict = scoreAgainstExpectations(sectional, badOutput, 0.85);
    expect(verdict.passed).toBe(false);
    expect(verdict.failures.some((f) => f.includes("sectional"))).toBe(true);
  });

  it("fails when the palette misses all required warm tones", () => {
    const cases = loadGoldCases();
    const sectional = cases.find((c) => c.id === "great-room-keep-leather-sectional");
    if (!sectional) throw new Error("fixture missing");

    const badOutput = {
      what_works: ["leather sectional"],
      what_should_go: [],
      recommended_palette: ["cool gray", "navy", "charcoal"],
      what_it_needs: [{ category: "floor_lamp" }],
    };
    const verdict = scoreAgainstExpectations(sectional, badOutput, 0.85);
    expect(verdict.passed).toBe(false);
    expect(verdict.failures.some((f) => f.includes("palette"))).toBe(true);
  });

  it("fails when a required category is missing", () => {
    const cases = loadGoldCases();
    const sectional = cases.find((c) => c.id === "great-room-keep-leather-sectional");
    if (!sectional) throw new Error("fixture missing");

    const badOutput = {
      what_works: ["leather sectional"],
      what_should_go: [],
      recommended_palette: ["terracotta"],
      what_it_needs: [{ category: "accent_chair" }],
    };
    const verdict = scoreAgainstExpectations(sectional, badOutput, 0.85);
    expect(verdict.passed).toBe(false);
    expect(verdict.failures.some((f) => f.includes("missing categories"))).toBe(true);
  });

  it("fails when validation confidence is under the threshold", () => {
    // Use an inline fixture to test the runner's confidence-threshold logic in
    // isolation. Real gold cases (brass-lamp, etc.) don't set minValidationConfidence
    // because the diagnosis pipeline doesn't produce a confidence score.
    const fixtureWithThreshold = {
      id: "inline-confidence-test",
      description: "inline fixture for confidence threshold testing",
      input: {
        roomType: "living_room",
        imageUrls: [],
      },
      expectations: {
        minValidationConfidence: 0.6,
      },
    };

    const goodOutput = {
      what_works: [],
      what_should_go: [],
      recommended_palette: [],
      what_it_needs: [],
    };
    const verdict = scoreAgainstExpectations(fixtureWithThreshold, goodOutput, 0.3);
    expect(verdict.passed).toBe(false);
    expect(verdict.failures.some((f) => f.includes("confidence"))).toBe(true);
  });
});
