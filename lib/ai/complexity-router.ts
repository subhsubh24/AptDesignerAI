/**
 * Layer-1 complexity router — classifies room/task complexity once per pipeline
 * entry and sets the starting model tier + thinking floor for the run.
 *
 * Cheap call (base model, minimal thinking) amortized over hundreds of
 * downstream calls. Caches per room+session so refine re-runs reuse the verdict.
 */

import { getProvider } from "@/lib/ai/provider-factory";
import { selectModel, type TextTier, type ThinkingTier } from "@/lib/ai/models";
import { DETERMINISTIC_SEED } from "@/lib/ai/determinism";
import { createLogger } from "@/lib/logging/logger";

const log = createLogger("complexity-router");

export type ComplexityVerdict = "simple" | "standard" | "complex";

export interface ComplexitySignals {
  roomType: string;
  itemCount: number;
  hasFloorPlan: boolean;
  roomCount: number;
  userTextLength: number;
  budgetMode: string;
}

export interface ComplexityResult {
  verdict: ComplexityVerdict;
  modelTier: TextTier;
  thinkingFloor: ThinkingTier;
  reasoning: string;
}

const VERDICT_TO_TIER: Record<ComplexityVerdict, { modelTier: TextTier; thinkingFloor: ThinkingTier }> = {
  simple: { modelTier: "base", thinkingFloor: "low" },
  standard: { modelTier: "base", thinkingFloor: "low" },
  complex: { modelTier: "mid", thinkingFloor: "high" },
};

const cache = new Map<string, ComplexityResult>();

function cacheKey(roomId: string, sessionId: string): string {
  return `${roomId}|${sessionId}`;
}

const CLASSIFIER_SYSTEM = `You classify room design task complexity. Output JSON only.

Scoring rubric:
- simple: ≤4 items, basic room type (closet, bathroom), no floor plan, short/no user instructions
- standard: typical room (bedroom, living room, kitchen), moderate items, may have floor plan
- complex: large room, 8+ items, detailed floor plan, long user constraints, multi-budget tiers, unusual room type

Output: { "reasoning": "<1 sentence>", "verdict": "simple" | "standard" | "complex" }`;

export async function classifyComplexity(
  signals: ComplexitySignals,
  roomId: string,
  sessionId: string,
): Promise<ComplexityResult> {
  const key = cacheKey(roomId, sessionId);
  const cached = cache.get(key);
  if (cached) return cached;

  const prompt = [
    `Room type: ${signals.roomType}`,
    `Item count: ${signals.itemCount}`,
    `Has floor plan: ${signals.hasFloorPlan}`,
    `Number of rooms in apartment: ${signals.roomCount}`,
    `User instruction length: ${signals.userTextLength} chars`,
    `Budget mode: ${signals.budgetMode}`,
  ].join("\n");

  try {
    const response = await getProvider("quick_screen").chat({
      model: selectModel("quick_screen"),
      system: CLASSIFIER_SYSTEM,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 256,
      seed: DETERMINISTIC_SEED,
      responseMimeType: "application/json",
      thinkingConfig: { thinkingLevel: "minimal" },
    });

    const parsed = JSON.parse(response.content);
    const verdict: ComplexityVerdict =
      parsed.verdict === "simple" || parsed.verdict === "complex"
        ? parsed.verdict
        : "standard";

    const result: ComplexityResult = {
      verdict,
      ...VERDICT_TO_TIER[verdict],
      reasoning: parsed.reasoning ?? "",
    };

    log.info("Classified room complexity", { roomId, verdict, reasoning: result.reasoning });
    cache.set(key, result);
    return result;
  } catch (err) {
    log.warn("Complexity classifier failed — defaulting to standard", {
      error: err instanceof Error ? err.message : String(err),
    });
    const fallback: ComplexityResult = {
      verdict: "standard",
      ...VERDICT_TO_TIER.standard,
      reasoning: "classifier failed",
    };
    cache.set(key, fallback);
    return fallback;
  }
}
