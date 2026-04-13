/**
 * Lightweight candidate reranker — sits between Screen and Extract in the
 * search pipeline. Given the screened-candidate set for a (category, tier),
 * it scores each URL 0–1 against the brief's key_requirements using only the
 * title + snippet (no HTML fetch, no image) and returns the top-K.
 *
 * Why this stage exists
 * ─────────────────────
 * Extraction is the most expensive phase: each URL gets a URL-context call
 * that fetches HTML, parses product details, and emits structured JSON. On
 * a typical run we extract 30–60 URLs per category even after quick-screen,
 * many of which turn out to be irrelevant (wrong style, wrong size class)
 * once we actually see the product. Reranking on cheap signals first keeps
 * only the top-K worth extracting.
 *
 * Opt-in via `ENABLE_RERANK=1`. Orchestrator wires it directly after the
 * quick-screen phase and the rest of the pipeline is unchanged.
 */

import { geminiProvider } from "@/lib/ai/gemini";
import { selectModel } from "@/lib/ai/models";
import { zodToGeminiSchema } from "@/lib/ai/schema";
import { extractJsonObject } from "@/lib/ai/extract-json";
import { withRetry, isRetryableError } from "@/lib/ai/retry";
import { DETERMINISTIC_SEED } from "@/lib/ai/determinism";
import { createLogger } from "@/lib/logging/logger";
import { z } from "zod";
import type { SearchCandidate } from "./shopping-researcher";
import type { AIContentBlock } from "@/lib/ai/provider";

const log = createLogger("reranker");

const RerankResponseSchema = z.object({
  scores: z
    .array(
      z.object({
        url: z.string(),
        score: z.number().min(0).max(1),
        reason: z.string().optional(),
      })
    )
    .max(200),
});

const RERANK_GEMINI_SCHEMA = zodToGeminiSchema(RerankResponseSchema);

export interface RerankResult {
  kept: SearchCandidate[];
  dropped: SearchCandidate[];
  tokensUsed: number;
}

export interface RerankParams {
  category: string;
  tier: string;
  requirements: string[];
  /** Candidates that survived quick-screen. */
  candidates: SearchCandidate[];
  /** Max candidates to keep. Defaults to 10. */
  topK?: number;
  /** Minimum score to keep even if under topK. Defaults to 0.25. */
  minScore?: number;
  /**
   * Room photos to attach as visual grounding so the reranker never
   * forgets the physical room it is scoring against. Up to 3 are used.
   */
  roomImageUrls?: string[];
}

/**
 * Rerank candidates using title + snippet only (no page fetch).
 *
 * Fails open: on any error, returns all candidates unmodified so the
 * pipeline degrades to pre-reranker behavior instead of crashing.
 */
export async function rerankCandidates({
  category,
  tier,
  requirements,
  candidates,
  topK = 10,
  minScore = 0.25,
  roomImageUrls,
}: RerankParams): Promise<RerankResult> {
  if (candidates.length === 0) {
    return { kept: [], dropped: [], tokensUsed: 0 };
  }

  // Below the threshold the extract pass already handles the volume — don't
  // burn a call to rerank 3 items.
  if (candidates.length <= topK) {
    return { kept: candidates, dropped: [], tokensUsed: 0 };
  }

  const model = selectModel("quick_screen");
  const reqList = requirements.length > 0
    ? requirements.map((r, i) => `  ${i + 1}. ${r}`).join("\n")
    : "  (none specified — judge on category fit)";

  const candidateBlock = candidates
    .map(
      (c, i) =>
        `${i + 1}. URL: ${c.url}\n   Title: ${c.title}\n   Snippet: ${c.snippet?.slice(0, 300) || "(none)"}`
    )
    .join("\n\n");

  const prompt = `You are scoring search results for a ${tier}-tier ${category} purchase. Score each candidate 0.0–1.0 on how well the URL+title+snippet match the requirements below, WITHOUT fetching the page. Judge on: category fit, apparent style match, retailer credibility, and evident size class.

Requirements:
${reqList}

Candidates:
${candidateBlock}

Return JSON: { "scores": [{ "url": "...", "score": 0.0–1.0, "reason": "short" }, ...] }
Be harsh — use the full 0–1 range. 0.9+ only for clear wins. Most items should be 0.3–0.7.`;

  // Attach up to 3 room photos so the reranker scores candidates with the
  // physical room in view (never forget what we're furnishing).
  let content: string | AIContentBlock[] = prompt;
  if (roomImageUrls && roomImageUrls.length > 0) {
    const blocks: AIContentBlock[] = [
      {
        type: "text",
        text: "REFERENCE PHOTOS OF THE ACTUAL ROOM being furnished (match each candidate's apparent style, scale, and palette to these):",
      },
    ];
    for (const url of roomImageUrls.slice(0, 3)) {
      blocks.push({ type: "image", source: { type: "url", url } });
    }
    blocks.push({ type: "text", text: prompt });
    content = blocks;
  }

  try {
    const response = await withRetry(
      () =>
        geminiProvider.chat({
          model,
          system: "You are a concise product-listing relevance scorer. Output strict JSON only.",
          messages: [{ role: "user", content }],
          max_tokens: 4000,
          seed: DETERMINISTIC_SEED,
          responseSchema: RERANK_GEMINI_SCHEMA,
          responseMimeType: "application/json",
        }),
      { isRetryable: isRetryableError, maxAttempts: 2 }
    );

    const parsed = extractJsonObject(response.content);
    const validated = RerankResponseSchema.safeParse(parsed);
    if (!validated.success) {
      log.warn("Rerank response failed schema validation — keeping all candidates", {
        category,
        tier,
        issues: validated.error.issues.slice(0, 3),
      });
      return { kept: candidates, dropped: [], tokensUsed: response.usage?.input_tokens ?? 0 };
    }

    const scoreByUrl = new Map<string, number>();
    for (const s of validated.data.scores) {
      scoreByUrl.set(s.url, s.score);
    }

    const scored = candidates
      .map((c) => ({ candidate: c, score: scoreByUrl.get(c.url) ?? 0 }))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.candidate.url.localeCompare(b.candidate.url); // deterministic tiebreak
      });

    const keptScored = scored.filter((s, i) => i < topK && s.score >= minScore);
    const kept = keptScored.map((s) => s.candidate);
    const keptUrls = new Set(kept.map((c) => c.url));
    const dropped = candidates.filter((c) => !keptUrls.has(c.url));

    const tokensUsed =
      (response.usage?.input_tokens ?? 0) +
      (response.usage?.output_tokens ?? 0) +
      (response.usage?.thinking_tokens ?? 0);

    log.info("Reranked candidates", {
      category,
      tier,
      input: candidates.length,
      kept: kept.length,
      dropped: dropped.length,
      tokensUsed,
    });

    return { kept, dropped, tokensUsed };
  } catch (err) {
    // Fail open: return all candidates untouched so extract still runs.
    log.warn("Rerank failed — falling back to pre-rerank candidate set", {
      category,
      tier,
      error: err instanceof Error ? err.message : String(err),
    });
    return { kept: candidates, dropped: [], tokensUsed: 0 };
  }
}

/** Exported for test visibility. */
export { RerankResponseSchema };
