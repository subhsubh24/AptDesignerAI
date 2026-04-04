/**
 * Extract and parse a JSON object from an AI response string.
 * AI models sometimes include extra text (markdown fences, explanations)
 * before or after the actual JSON object. This function finds the
 * outermost `{…}` and parses only that portion.
 */
export function extractJsonObject<T = unknown>(raw: string): T {
  const trimmed = raw.trim();
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    // Fall through to JSON.parse which will give a clear error
    return JSON.parse(trimmed);
  }
  return JSON.parse(trimmed.substring(firstBrace, lastBrace + 1));
}
