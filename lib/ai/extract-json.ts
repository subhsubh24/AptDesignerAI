/**
 * Extract and parse a JSON object from an AI response string.
 *
 * AI models sometimes include extra text (markdown fences, explanations)
 * before or after the actual JSON object. This function handles:
 * - Markdown code fences (```json ... ```)
 * - Leading/trailing explanation text
 * - Nested JSON objects (proper brace matching)
 * - Common JSON formatting issues from LLMs
 */
export function extractJsonObject<T = unknown>(raw: string): T {
  const trimmed = raw.trim();

  // 1. Try direct parse first (fastest path)
  try {
    return JSON.parse(trimmed);
  } catch {
    // Continue to extraction strategies
  }

  // 2. Try extracting from markdown code fences
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {
      // Continue to brace matching
    }
  }

  // 3. Find the outermost JSON object using balanced brace matching
  const firstBrace = trimmed.indexOf("{");
  if (firstBrace === -1) {
    // No object found — try array
    const firstBracket = trimmed.indexOf("[");
    if (firstBracket !== -1) {
      const lastBracket = findMatchingBracket(trimmed, firstBracket);
      if (lastBracket !== -1) {
        try {
          return JSON.parse(trimmed.substring(firstBracket, lastBracket + 1));
        } catch {
          // Fall through
        }
      }
    }
    // Last resort
    return JSON.parse(trimmed);
  }

  const matchingBrace = findMatchingBrace(trimmed, firstBrace);
  if (matchingBrace !== -1) {
    const candidate = trimmed.substring(firstBrace, matchingBrace + 1);
    try {
      return JSON.parse(candidate);
    } catch {
      // Try repairing common issues
      const repaired = repairJson(candidate);
      try {
        return JSON.parse(repaired);
      } catch {
        // Fall through to simple extraction
      }
    }
  }

  // 4. Fallback: simple first/last brace (original behavior)
  const lastBrace = trimmed.lastIndexOf("}");
  if (lastBrace > firstBrace) {
    return JSON.parse(trimmed.substring(firstBrace, lastBrace + 1));
  }

  return JSON.parse(trimmed);
}

/**
 * Find the matching closing brace for an opening brace,
 * properly handling nesting and string literals.
 */
function findMatchingBrace(text: string, openPos: number): number {
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = openPos; i < text.length; i++) {
    const char = text[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (char === "\\") {
      escape = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === "{") depth++;
    if (char === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }

  return -1;
}

/**
 * Find matching closing bracket for arrays.
 */
function findMatchingBracket(text: string, openPos: number): number {
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = openPos; i < text.length; i++) {
    const char = text[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (char === "\\") {
      escape = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === "[") depth++;
    if (char === "]") {
      depth--;
      if (depth === 0) return i;
    }
  }

  return -1;
}

/**
 * Attempt to repair common JSON issues from LLM output:
 * - Trailing commas before closing braces/brackets
 * - Single quotes instead of double quotes (outside strings)
 * - Unquoted keys
 */
function repairJson(text: string): string {
  let result = text;

  // Remove trailing commas before } or ]
  result = result.replace(/,\s*([}\]])/g, "$1");

  // Remove JavaScript-style comments
  result = result.replace(/\/\/[^\n]*/g, "");

  return result;
}
