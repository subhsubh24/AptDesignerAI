import { describe, it, expect } from "vitest";
import {
  evaluateAutoFinalize,
  type DesignCoordinatorState,
} from "@/lib/agents/design-coordinator";

/**
 * Unit coverage for `evaluateAutoFinalize` — the pure convergence check that
 * decides whether the design coordinator stops the agent loop early instead of
 * spending another ~50–100K-token harmony/finalize LLM turn. Each threshold is a
 * real cost lever, so we pin both sides of every boundary:
 *   - allAboveTarget: every score ≥ 8.5 OR stabilized (8.5 boundary, empty/undefined)
 *   - velocityExhausted: convergenceVelocity < 0.2 (strict boundary)
 *   - allStabilized: stabilizedCount ≥ totalItems
 *   - the ≥1-harmony-round gate on harmonyConverged
 *   - finalAssessmentSettled short-circuit (fires regardless of rounds)
 *   - the reason-string precedence (final-assessment > allAboveTarget > velocity > stabilized)
 */

function baseState(overrides: Partial<DesignCoordinatorState> = {}): DesignCoordinatorState {
  return {
    passAComplete: true,
    passBComplete: true,
    enrichmentComplete: true,
    harmonyRoundsCompleted: 0,
    finalAssessmentComplete: false,
    itemCount: 3,
    categories: ["sofa", "rug", "lamp"],
    ...overrides,
  };
}

describe("evaluateAutoFinalize", () => {
  it("does NOT finalize when no convergence signal is present", () => {
    const d = evaluateAutoFinalize(baseState());
    expect(d.finalize).toBe(false);
    expect(d.reason).toBeNull();
    expect(d.allAboveTarget).toBe(false);
    expect(d.velocityExhausted).toBe(false);
    expect(d.allStabilized).toBe(false);
  });

  it("finalizes when the final assessment reports no more rounds (short-circuit, even at 0 rounds)", () => {
    const d = evaluateAutoFinalize(
      baseState({
        harmonyRoundsCompleted: 0,
        finalAssessmentComplete: true,
        finalAssessmentResult: { needsMoreRounds: false, roundBudget: 2 },
      }),
    );
    expect(d.finalAssessmentSettled).toBe(true);
    expect(d.finalize).toBe(true);
    expect(d.reason).toBe("Auto-finalize: final assessment complete, no more rounds warranted");
  });

  it("does NOT settle when the final assessment still needs more rounds", () => {
    const d = evaluateAutoFinalize(
      baseState({
        finalAssessmentComplete: true,
        finalAssessmentResult: { needsMoreRounds: true, roundBudget: 2 },
      }),
    );
    expect(d.finalAssessmentSettled).toBe(false);
    expect(d.finalize).toBe(false);
  });

  it("does NOT settle when finalAssessmentComplete is true but the result is missing", () => {
    const d = evaluateAutoFinalize(baseState({ finalAssessmentComplete: true }));
    expect(d.finalAssessmentSettled).toBe(false);
    expect(d.finalize).toBe(false);
  });

  it("finalizes on allAboveTarget once ≥1 harmony round is done (8.5 is inclusive)", () => {
    const d = evaluateAutoFinalize(
      baseState({
        harmonyRoundsCompleted: 2,
        latestScores: [
          { category: "sofa", score: 8.5, stabilized: false },
          { category: "rug", score: 9.1, stabilized: false },
        ],
      }),
    );
    expect(d.allAboveTarget).toBe(true);
    expect(d.finalize).toBe(true);
    expect(d.reason).toBe("Auto-finalize: all items ≥ 8.5 after 2 round(s)");
  });

  it("counts a below-8.5 item as above-target when it is stabilized", () => {
    const d = evaluateAutoFinalize(
      baseState({
        harmonyRoundsCompleted: 1,
        latestScores: [
          { category: "sofa", score: 7.0, stabilized: true },
          { category: "rug", score: 8.9, stabilized: false },
        ],
      }),
    );
    expect(d.allAboveTarget).toBe(true);
    expect(d.finalize).toBe(true);
  });

  it("is NOT allAboveTarget when one item is below 8.5 and not stabilized", () => {
    const d = evaluateAutoFinalize(
      baseState({
        harmonyRoundsCompleted: 1,
        latestScores: [
          { category: "sofa", score: 8.4, stabilized: false },
          { category: "rug", score: 9.0, stabilized: false },
        ],
      }),
    );
    expect(d.allAboveTarget).toBe(false);
    expect(d.finalize).toBe(false);
  });

  it("does NOT finalize on convergence signals until at least one harmony round completes", () => {
    const converged = {
      latestScores: [{ category: "sofa", score: 9.0, stabilized: false }],
      convergenceVelocity: 0.1,
      stabilizedCount: 3,
      totalItems: 3,
    };
    const zeroRounds = evaluateAutoFinalize(baseState({ harmonyRoundsCompleted: 0, ...converged }));
    expect(zeroRounds.allAboveTarget).toBe(true);
    expect(zeroRounds.velocityExhausted).toBe(true);
    expect(zeroRounds.allStabilized).toBe(true);
    // ...but the ≥1-round gate keeps harmonyConverged (and finalize) false
    expect(zeroRounds.harmonyConverged).toBe(false);
    expect(zeroRounds.finalize).toBe(false);

    const oneRound = evaluateAutoFinalize(baseState({ harmonyRoundsCompleted: 1, ...converged }));
    expect(oneRound.finalize).toBe(true);
  });

  it("treats velocity < 0.2 as exhausted but 0.2 exactly as NOT exhausted (strict boundary)", () => {
    const below = evaluateAutoFinalize(
      baseState({ harmonyRoundsCompleted: 1, convergenceVelocity: 0.19 }),
    );
    expect(below.velocityExhausted).toBe(true);
    expect(below.finalize).toBe(true);
    expect(below.reason).toBe("Auto-finalize: velocity < 0.2 after 1 round(s)");

    const atBoundary = evaluateAutoFinalize(
      baseState({ harmonyRoundsCompleted: 1, convergenceVelocity: 0.2 }),
    );
    expect(atBoundary.velocityExhausted).toBe(false);
    expect(atBoundary.finalize).toBe(false);
  });

  it("treats stabilizedCount ≥ totalItems as all-stabilized", () => {
    const equal = evaluateAutoFinalize(
      baseState({ harmonyRoundsCompleted: 1, stabilizedCount: 3, totalItems: 3 }),
    );
    expect(equal.allStabilized).toBe(true);
    expect(equal.finalize).toBe(true);
    expect(equal.reason).toBe("Auto-finalize: all stabilized after 1 round(s)");

    const partial = evaluateAutoFinalize(
      baseState({ harmonyRoundsCompleted: 1, stabilizedCount: 2, totalItems: 3 }),
    );
    expect(partial.allStabilized).toBe(false);
    expect(partial.finalize).toBe(false);
  });

  it("is NOT allStabilized when either count is undefined", () => {
    expect(
      evaluateAutoFinalize(baseState({ harmonyRoundsCompleted: 1, totalItems: 3 })).allStabilized,
    ).toBe(false);
    expect(
      evaluateAutoFinalize(baseState({ harmonyRoundsCompleted: 1, stabilizedCount: 3 })).allStabilized,
    ).toBe(false);
  });

  it("treats an empty latestScores array as NOT allAboveTarget", () => {
    const d = evaluateAutoFinalize(baseState({ harmonyRoundsCompleted: 1, latestScores: [] }));
    expect(d.allAboveTarget).toBe(false);
    expect(d.finalize).toBe(false);
  });

  it("reason precedence: allAboveTarget wins over velocity and stabilized", () => {
    const d = evaluateAutoFinalize(
      baseState({
        harmonyRoundsCompleted: 3,
        latestScores: [{ category: "sofa", score: 9.0, stabilized: true }],
        convergenceVelocity: 0.1,
        stabilizedCount: 1,
        totalItems: 1,
      }),
    );
    expect(d.reason).toBe("Auto-finalize: all items ≥ 8.5 after 3 round(s)");
  });

  it("reason precedence: velocity wins over stabilized when not allAboveTarget", () => {
    const d = evaluateAutoFinalize(
      baseState({
        harmonyRoundsCompleted: 2,
        latestScores: [{ category: "sofa", score: 6.0, stabilized: false }],
        convergenceVelocity: 0.1,
        stabilizedCount: 5,
        totalItems: 5,
      }),
    );
    expect(d.allAboveTarget).toBe(false);
    expect(d.reason).toBe("Auto-finalize: velocity < 0.2 after 2 round(s)");
  });

  it("the final-assessment short-circuit reason wins even when harmony signals also converged", () => {
    const d = evaluateAutoFinalize(
      baseState({
        harmonyRoundsCompleted: 2,
        finalAssessmentComplete: true,
        finalAssessmentResult: { needsMoreRounds: false, roundBudget: 1 },
        convergenceVelocity: 0.1,
      }),
    );
    expect(d.finalize).toBe(true);
    expect(d.reason).toBe("Auto-finalize: final assessment complete, no more rounds warranted");
  });
});
