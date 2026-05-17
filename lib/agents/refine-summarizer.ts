/**
 * Refine summarizer: after the chat designer re-runs the full area analysis,
 * this produces a short client-facing summary of what changed between the
 * previous assessment and the new one.
 */

import { geminiProvider } from "@/lib/ai/gemini";
import { selectModel } from "@/lib/ai/models";
import { withRetry, isRetryableError } from "@/lib/ai/retry";
import { createLogger } from "@/lib/logging/logger";

const log = createLogger("refine-summarizer");

export interface SummarizeInput {
  /** The client's chat message that triggered the re-analysis. */
  feedback: string;
  /** Analysis before the re-run. */
  priorAnalysis: Record<string, unknown>;
  /** Analysis produced by the re-run. */
  newAnalysis: Record<string, unknown>;
  /** System prompt for design profile context. */
  system: string;
}

/** Keep only the fields that matter for a change summary — saves tokens. */
function slim(a: Record<string, unknown>): Record<string, unknown> {
  return {
    design_direction: a.design_direction,
    style_name: a.style_name,
    recommended_palette: a.recommended_palette,
    recommended_materials: a.recommended_materials,
    what_should_go: a.what_should_go,
    what_it_needs: Array.isArray(a.what_it_needs)
      ? (a.what_it_needs as Array<Record<string, unknown>>).map((it) => ({
          category: it.category,
          description: it.description,
          specs: it.specs,
        }))
      : a.what_it_needs,
  };
}

export async function summarizeRefineChanges(
  input: SummarizeInput,
): Promise<{ summary: string; tokens: number }> {
  const { feedback, priorAnalysis, newAnalysis, system } = input;
  const model = selectModel("area_analysis");

  const prompt = `You are an interior designer. The client asked for a change, and you re-did the full room assessment to reflect it. Write a SHORT summary (1-2 sentences, max 3) of what actually changed, addressed to the client. Be concrete — name the key swaps (e.g. sofa material, palette shift, items added or removed). No preamble, no bullet points.

CLIENT REQUEST: "${feedback}"

PREVIOUS ASSESSMENT:
${JSON.stringify(slim(priorAnalysis), null, 2)}

UPDATED ASSESSMENT:
${JSON.stringify(slim(newAnalysis), null, 2)}

Return ONLY the summary sentence(s) — no JSON, no quotes, no markdown.`;

  try {
    const result = await withRetry(
      async () => {
        const response = await geminiProvider.chat({
          model,
          system,
          messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
          max_tokens: 1200,
          thinkingConfig: { thinkingLevel: "low" },
        });
        const text = (response.content || "").trim();
        const tokens =
          (response.usage.input_tokens || 0) +
          (response.usage.output_tokens || 0) +
          (response.usage.thinking_tokens || 0);
        return {
          summary: text || "Updated the assessment based on your request.",
          tokens,
        };
      },
      {
        maxAttempts: 3,
        baseDelayMs: 1500,
        maxDelayMs: 10000,
        isRetryable: isRetryableError,
      },
    );
    log.info("Generated refine summary", { tokens: { total: result.tokens } });
    return result;
  } catch (err) {
    log.warn("Refine summary failed — using fallback", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { summary: "Updated the assessment based on your request.", tokens: 0 };
  }
}
