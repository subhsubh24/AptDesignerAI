/**
 * Context truncation for AI prompts.
 *
 * When the combined prompt (system + user + images) approaches the model's
 * context window, we need to trim lower-priority sections to fit.
 * This module provides priority-based truncation that preserves the most
 * important context while staying within token budgets.
 */

/** Rough token estimate: ~4 chars per token for English, ~258 per image. */
export function estimateTokens(text: string, imageCount = 0): number {
  return Math.ceil(text.length / 4) + imageCount * 258;
}

/**
 * A section of context with a priority level.
 * Lower priority number = higher importance (kept first).
 */
export interface ContextSection {
  /** Unique key for this section */
  key: string;
  /** The text content */
  content: string;
  /** Priority: 1 = critical (never truncated), 2 = important, 3 = helpful, 4 = nice-to-have */
  priority: 1 | 2 | 3 | 4;
}

export interface TruncationResult {
  /** The assembled text within the token budget */
  text: string;
  /** Estimated token count of the result */
  estimatedTokens: number;
  /** Keys of sections that were truncated */
  truncatedSections: string[];
  /** Whether any truncation occurred */
  wasTruncated: boolean;
}

/**
 * Assemble context sections within a token budget.
 *
 * Sections are included in order of priority (1 first, 4 last).
 * Within the same priority, original order is preserved.
 * If a priority level would push over budget, individual sections
 * at that level are truncated (by trimming content from the end).
 *
 * @param sections - Context sections to assemble
 * @param tokenBudget - Maximum tokens allowed
 * @param imageCount - Number of images (each costs ~258 tokens)
 * @param separator - Text between sections. Default: "\n\n"
 */
export function truncateContext(
  sections: ContextSection[],
  tokenBudget: number,
  imageCount = 0,
  separator = "\n\n"
): TruncationResult {
  const imageTokens = imageCount * 258;
  const availableTokens = tokenBudget - imageTokens;

  if (availableTokens <= 0) {
    return {
      text: "",
      estimatedTokens: imageTokens,
      truncatedSections: sections.map((s) => s.key),
      wasTruncated: true,
    };
  }

  // Sort by priority (stable sort preserves original order within same priority)
  const sorted = [...sections].sort((a, b) => a.priority - b.priority);

  const included: string[] = [];
  const truncatedSections: string[] = [];
  let usedTokens = 0;

  for (const section of sorted) {
    const separatorTokens = included.length > 0 ? estimateTokens(separator) : 0;
    const sectionTokens = estimateTokens(section.content);
    const totalNeeded = separatorTokens + sectionTokens;

    if (usedTokens + totalNeeded <= availableTokens) {
      // Fits entirely
      included.push(section.content);
      usedTokens += totalNeeded;
    } else if (section.priority === 1) {
      // Critical sections are always included (even if over budget)
      included.push(section.content);
      usedTokens += totalNeeded;
    } else {
      // Try to fit a truncated version
      const remainingTokens = availableTokens - usedTokens - separatorTokens;
      if (remainingTokens > 100) {
        // Enough room for a meaningful truncation
        const maxChars = remainingTokens * 4; // Reverse the 4 chars/token estimate
        const truncated = section.content.slice(0, maxChars) + "\n[...truncated]";
        included.push(truncated);
        usedTokens += separatorTokens + estimateTokens(truncated);
        truncatedSections.push(section.key);
      } else {
        // Not enough room — skip entirely
        truncatedSections.push(section.key);
      }
    }
  }

  const text = included.join(separator);
  return {
    text,
    estimatedTokens: estimateTokens(text) + imageTokens,
    truncatedSections,
    wasTruncated: truncatedSections.length > 0,
  };
}

/**
 * Model context window limits (input tokens).
 * These are conservative estimates leaving room for output tokens.
 */
export const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  "gemini-3.1-flash-lite-preview": 800_000,
  "gemini-3-flash-preview": 800_000,
  "gemini-3.1-flash-image-preview": 800_000,
};

/**
 * Get a safe input token budget for a model, leaving room for output.
 * Uses 75% of context window for input by default.
 */
export function getInputBudget(model: string, maxOutputTokens: number): number {
  const contextLimit = MODEL_CONTEXT_LIMITS[model] || 100_000;
  return contextLimit - maxOutputTokens;
}
