import { describe, expect, it } from "vitest";
import { thinkingFor } from "@/lib/ai/thinking";
import { DEFAULT_THINKING, type TaskType, type ThinkingTier } from "@/lib/ai/models";

// lib/ai/thinking.ts is the LLM cost contract's enforcement point (AGENTS.md
// "## Model policy" / .claude/rules/llm-cost-contract.md): every `.chat()`
// call routes its thinkingConfig through thinkingFor(task). A silent change
// here (e.g. a fallback flip from "low" to "high") would not fail any
// existing test, since nothing else in the suite pins thinkingFor's per-task
// table — it would just quietly multiply spend on every downstream call.
//
// EXPECTED_TIERS is a hardcoded literal, deliberately NOT derived from
// DEFAULT_THINKING itself — asserting thinkingFor(task) against the very
// table it reads from would pass even if that table silently changed (the
// expected value would drift right along with the actual one). Pinning a
// literal here is what actually catches a policy regression.
const EXPECTED_TIERS: Record<TaskType, ThinkingTier> = {
  apartment_analysis: "high",
  area_analysis: "high",
  diagnosis: "high",
  validation: "low",
  scoring: "low",
  bundle: "low",
  apartment_research: "low",
  extraction: "minimal",
  quick_score: "minimal",
  quick_screen: "minimal",
  search: "minimal",
  search_brief: "low",
  mockup_prompt: "low",
  // Tasks with no DEFAULT_THINKING entry fall back to "low" (thinkingFor /
  // defaultThinking's documented default), not "minimal" or "high".
  mockup_image: "low",
  mockup_image_fast: "low",
  image_generation: "low",
  computer_use: "low",
};

describe("thinkingFor", () => {
  // EXPECTED_TIERS's type (Record<TaskType, ThinkingTier>) requires a literal
  // entry for every member of the TaskType union — tsc fails to compile this
  // file if a new task is ever added to models.ts without a decision being
  // made here about its tier, so coverage can't silently go stale.
  it.each(Object.entries(EXPECTED_TIERS) as [TaskType, ThinkingTier][])(
    "routes %s to %s",
    (task, expected) => {
      expect(thinkingFor(task)).toEqual({ thinkingLevel: expected });
    },
  );

  it("an explicit override always wins over the task's default, high or low", () => {
    expect(thinkingFor("diagnosis", "minimal")).toEqual({ thinkingLevel: "minimal" });
    expect(thinkingFor("quick_score", "high")).toEqual({ thinkingLevel: "high" });
  });

  it("keeps HIGH thinking only for the cost-contract-approved reasoning tasks", () => {
    // .claude/rules/llm-cost-contract.md: HIGH is allowed ONLY where there is
    // no cheap deterministic verifier — apartment/room understanding,
    // diagnosis, area-analysis. A new task quietly added to this set with
    // "high" would silently regress the cost contract; this test forces that
    // change to be a deliberate, visible edit to this list.
    const highTasks = Object.entries(DEFAULT_THINKING)
      .filter(([, tier]) => tier === "high")
      .map(([task]) => task)
      .sort();
    expect(highTasks).toEqual(["apartment_analysis", "area_analysis", "diagnosis"]);
  });
});
