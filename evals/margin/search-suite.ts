/**
 * Search suite — the `aptdesigner-search` workflow (runAgenticSearch).
 * Wraps the existing input matrix (cases.ts) + grader (grade.ts) in the uniform
 * Suite surface.
 */

import { randomUUID } from "node:crypto";
import type { AgentContext } from "@/lib/agents/types";
import type { Suite } from "./suite";
import { buildCaseMatrix, type MarginEvalCase } from "./cases";
import { gradeCase, QUALITY_METHOD, type GradableResult } from "./grade";

const cases = buildCaseMatrix();

function buildContext(c: MarginEvalCase): AgentContext {
  return {
    roomId: randomUUID(),
    roomType: c.roomType,
    roomName: c.roomLabel,
    keepItems: c.keepItems,
    replaceItems: c.replaceItems,
    priorities: c.priorities,
    budgetMode: c.budgetMode,
    sourcingMode: "online",
    imageUrls: c.imageUrls,
    budgetDollars: c.budgetDollars,
    userContext: c.userContext,
  };
}

export const searchSuite: Suite = {
  workflow: "search",
  workflowId: "aptdesigner-search",
  qualityMethod: QUALITY_METHOD,
  description: "Agentic product search → bundle → validation (runAgenticSearch)",
  size: () => cases.length,
  caseMeta: (i) => ({ id: cases[i].id, difficulty: cases[i].difficulty }),
  async runCase(i) {
    const c = cases[i];
    const { runAgenticSearch } = await import("@/lib/agents/orchestrator");
    let result: GradableResult;
    try {
      result = (await runAgenticSearch(buildContext(c), c.missingCategories)) as GradableResult;
    } catch (err) {
      result = { success: false, error: err instanceof Error ? err.message : String(err) };
    }
    return gradeCase(c, result);
  },
};
