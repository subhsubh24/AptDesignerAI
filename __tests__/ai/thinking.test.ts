import { describe, expect, it } from "vitest";
import { thinkingFor } from "@/lib/ai/thinking";
import { DEFAULT_THINKING, type TaskType } from "@/lib/ai/models";

// lib/ai/thinking.ts is the LLM cost contract's enforcement point (AGENTS.md
// "## Model policy" / .claude/rules/llm-cost-contract.md): every `.chat()`
// call routes its thinkingConfig through thinkingFor(task). A silent change
// here (e.g. a fallback flip from "low" to "high") would not fail any
// existing test, since nothing else in the suite pins thinkingFor's per-task
// table — it would just quietly multiply spend on every downstream call.

// Tasks NOT present in DEFAULT_THINKING must fall back to "low" (thinkingFor
// / defaultThinking's documented default), not "minimal" or "high".
const TASKS_WITHOUT_DEFAULT: TaskType[] = [
  "mockup_image",
  "mockup_image_fast",
  "image_generation",
  "computer_use",
];

describe("thinkingFor", () => {
  it.each(Object.entries(DEFAULT_THINKING) as [TaskType, string][])(
    "routes %s to its configured DEFAULT_THINKING tier (%s)",
    (task, expected) => {
      expect(thinkingFor(task)).toEqual({ thinkingLevel: expected });
    },
  );

  it.each(TASKS_WITHOUT_DEFAULT)(
    "falls back to \"low\" for %s, which has no DEFAULT_THINKING entry",
    (task) => {
      expect(DEFAULT_THINKING[task]).toBeUndefined();
      expect(thinkingFor(task)).toEqual({ thinkingLevel: "low" });
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
