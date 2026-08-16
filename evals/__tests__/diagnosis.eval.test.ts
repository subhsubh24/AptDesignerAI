/**
 * Live eval tests for the room-diagnosis pipeline stage.
 *
 * Gates behind RUN_EVALS=1 so they never fire in the standard `npm test` run
 * (which has no Gemini key). Run with:
 *   RUN_EVALS=1 npx vitest run evals/__tests__/diagnosis.eval.test.ts
 * or via the project shorthand:
 *   npm run eval
 *
 * Each test drives `runRoomDiagnosis` with a gold-case's inputs, maps the
 * diagnosis output to the flat shape `scoreAgainstExpectations` expects, and
 * asserts the verdict passes. A failure means the pipeline regressed on a
 * known-good scenario.
 *
 * Timeout: 3 minutes per test — diagnosis runs a self-consistent sampling loop
 * (N samples + a judge call) against the live Gemini API.
 */

import { describe, it, expect } from "vitest";
import {
  loadGoldCases,
  scoreAgainstExpectations,
  evalsEnabled,
  type GoldCase,
} from "../runner";
import { runRoomDiagnosis } from "@/lib/agents/room-diagnostician";
import type { AgentContext } from "@/lib/agents/types";

const EVAL_TIMEOUT_MS = 3 * 60 * 1000;

/**
 * Map a DiagnosisResult to the flat output shape that scoreAgainstExpectations
 * understands. The diagnosis pipeline uses older field names (what_is_working vs
 * what_works) so we translate here rather than changing the gold-case schema.
 */
function flattenDiagnosisOutput(result: {
  diagnosis: { what_is_working?: string[]; what_is_not_working?: string[] };
  design_direction: { recommended_palette?: string[] };
  action_list?: Array<{ category: string }>;
}): Record<string, unknown> {
  return {
    what_works: result.diagnosis.what_is_working ?? [],
    what_should_go: result.diagnosis.what_is_not_working ?? [],
    recommended_palette: result.design_direction.recommended_palette ?? [],
    what_it_needs: (result.action_list ?? []).map((a) => ({
      category: a.category,
    })),
  };
}

async function runGoldCase(gold: GoldCase) {
  const ctx: AgentContext = {
    roomId: `eval-${gold.id}`,
    roomType: gold.input.roomType,
    imageUrls: gold.input.imageUrls,
    keepItems: gold.input.keepItems ?? [],
    replaceItems: gold.input.replaceItems ?? [],
    priorities: gold.input.priorities ?? [],
    budgetMode: gold.input.budgetMode ?? "balanced",
    sourcingMode: "manual",
    userContext: gold.input.userContext,
  };

  const result = await runRoomDiagnosis(ctx);
  if (!result.success || !result.data) {
    throw new Error(`runRoomDiagnosis failed: ${result.error ?? "unknown"}`);
  }
  return result.data;
}

const cases = loadGoldCases();

describe("room-diagnosis live evals — run with RUN_EVALS=1", () => {
  it.skipIf(!evalsEnabled())(
    "living-room-warm-sofa: palette contains at least one warm/neutral tone",
    async () => {
      const gold = cases.find((c) => c.id === "living-room-warm-sofa");
      expect(gold, "living-room-warm-sofa fixture missing").toBeTruthy();
      if (!gold) return;

      const data = await runGoldCase(gold);
      const flat = flattenDiagnosisOutput(data);
      const verdict = scoreAgainstExpectations(gold, flat);

      expect(
        verdict.passed,
        `eval failures for ${gold.id}: ${verdict.failures.join("; ")}`,
      ).toBe(true);
    },
    EVAL_TIMEOUT_MS,
  );

  it.skipIf(!evalsEnabled())(
    "studio-living-keep-brass-lamp: model does not suggest removing a keepItem",
    async () => {
      const gold = cases.find(
        (c) => c.id === "studio-living-keep-brass-lamp",
      );
      expect(
        gold,
        "studio-living-keep-brass-lamp fixture missing",
      ).toBeTruthy();
      if (!gold) return;

      const data = await runGoldCase(gold);
      const flat = flattenDiagnosisOutput(data);

      // mustNotDrop: the correct signal for keepItems compliance. The model
      // should never suggest removing an item the client explicitly said to keep,
      // regardless of whether the item appears in what_is_working.
      const verdict = scoreAgainstExpectations(gold, flat);

      expect(
        verdict.passed,
        `keepItems not respected for ${gold.id}: ${verdict.failures.join("; ")}`,
      ).toBe(true);
    },
    EVAL_TIMEOUT_MS,
  );

  it.skipIf(!evalsEnabled())(
    "bedroom-modern-minimalist: first bedroom fixture — recognizes a warm/neutral palette from an unprimed userContext",
    async () => {
      const gold = cases.find((c) => c.id === "bedroom-modern-minimalist");
      expect(gold, "bedroom-modern-minimalist fixture missing").toBeTruthy();
      if (!gold) return;

      const data = await runGoldCase(gold);
      const flat = flattenDiagnosisOutput(data);
      const verdict = scoreAgainstExpectations(gold, flat);

      expect(
        verdict.passed,
        `eval failures for ${gold.id}: ${verdict.failures.join("; ")}`,
      ).toBe(true);
    },
    EVAL_TIMEOUT_MS,
  );

  it.skipIf(!evalsEnabled())(
    "kitchen-white-modern-budget: first kitchen fixture, first budget budgetMode — recognizes the real palette from an unprimed userContext",
    async () => {
      const gold = cases.find((c) => c.id === "kitchen-white-modern-budget");
      expect(gold, "kitchen-white-modern-budget fixture missing").toBeTruthy();
      if (!gold) return;

      const data = await runGoldCase(gold);
      const flat = flattenDiagnosisOutput(data);
      const verdict = scoreAgainstExpectations(gold, flat);

      expect(
        verdict.passed,
        `eval failures for ${gold.id}: ${verdict.failures.join("; ")}`,
      ).toBe(true);
    },
    EVAL_TIMEOUT_MS,
  );
});
