import { describe, it, expect } from "vitest";
import {
  withCostLedger,
  recordStageCost,
  recordUsage,
  getCostSummary,
} from "@/lib/observability/cost-meter";

describe("cost-meter", () => {
  it("accumulates stage costs into a summary", async () => {
    await withCostLedger(async (summary) => {
      recordStageCost({ stage: "pass-a", model: "m1", inputTokens: 100, outputTokens: 50, thinkingTokens: 200 });
      recordStageCost({ stage: "pass-b", model: "m1", inputTokens: 80, outputTokens: 40, thinkingTokens: 0 });
      const s = summary();
      expect(s.stageCount).toBe(2);
      expect(s.totalInputTokens).toBe(180);
      expect(s.totalOutputTokens).toBe(90);
      expect(s.totalThinkingTokens).toBe(200);
      expect(s.totalTokens).toBe(470);
    });
  });

  it("counts escalations", async () => {
    await withCostLedger(async (summary) => {
      recordStageCost({ stage: "harmony-1", model: "m", inputTokens: 1, outputTokens: 1, thinkingTokens: 1 });
      recordStageCost({ stage: "harmony-2", model: "m", inputTokens: 1, outputTokens: 1, thinkingTokens: 1, escalated: true });
      expect(summary().escalationCount).toBe(1);
    });
  });

  it("recordUsage returns summed tokens and records the stage", async () => {
    await withCostLedger(async (summary) => {
      const total = recordUsage("deep-score", "m", {
        input_tokens: 10,
        output_tokens: 5,
        thinking_tokens: 3,
      });
      expect(total).toBe(18);
      expect(summary().stageCount).toBe(1);
    });
  });

  it("is a no-op outside a ledger (degrades gracefully)", () => {
    expect(() => recordStageCost({ stage: "x", model: "m", inputTokens: 1, outputTokens: 1, thinkingTokens: 1 })).not.toThrow();
    expect(getCostSummary()).toBeUndefined();
  });

  it("nested withCostLedger reuses the outer ledger", async () => {
    await withCostLedger(async (outer) => {
      recordStageCost({ stage: "a", model: "m", inputTokens: 1, outputTokens: 0, thinkingTokens: 0 });
      await withCostLedger(async () => {
        recordStageCost({ stage: "b", model: "m", inputTokens: 1, outputTokens: 0, thinkingTokens: 0 });
      });
      expect(outer().stageCount).toBe(2);
    });
  });
});
