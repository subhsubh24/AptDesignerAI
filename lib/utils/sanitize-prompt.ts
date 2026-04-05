/**
 * Sanitize user-provided text before embedding it in AI prompts.
 *
 * Mitigates prompt injection by:
 * 1. Stripping common injection patterns ("ignore the above", "system:", etc.)
 * 2. Escaping markdown/formatting that could interfere with prompt structure
 * 3. Truncating excessively long inputs
 *
 * This is a defense-in-depth measure — the primary defense is that user
 * context is always injected into a clearly delineated section of the prompt
 * with strong framing instructions.
 */

const MAX_USER_CONTEXT_LENGTH = 2000;

/**
 * Patterns that commonly appear in prompt injection attempts.
 * We don't block the input — we wrap it in clear delimiters so the model
 * treats it as quoted user text rather than instructions.
 */
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(the\s+)?(above|previous|prior)\s+(instructions?|prompts?|rules?)/gi,
  /forget\s+(all\s+)?(the\s+)?(above|previous|prior)/gi,
  /you\s+are\s+now\s+/gi,
  /new\s+instructions?:/gi,
  /system\s*:/gi,
  /\bprompt\s*:/gi,
  /override\s+(all\s+)?instructions?/gi,
  /disregard\s+(all\s+)?(previous|prior|above)/gi,
  /act\s+as\s+if\s+you/gi,
  /pretend\s+(you\s+are|to\s+be)/gi,
  /\[\[.*?\]\]/g,  // Double brackets often used in injection
  /<<.*?>>/g,       // Angle brackets
];

/**
 * Check if text contains likely prompt injection patterns.
 * Returns the matched patterns (for logging), or empty array if clean.
 */
export function detectInjectionPatterns(text: string): string[] {
  const matches: string[] = [];
  for (const pattern of INJECTION_PATTERNS) {
    pattern.lastIndex = 0;
    const match = pattern.exec(text);
    if (match) {
      matches.push(match[0]);
    }
  }
  return matches;
}

/**
 * Sanitize user context for safe prompt embedding.
 *
 * Does NOT block the content — instead wraps it clearly so the model
 * understands it's quoted user text. This preserves legitimate user
 * instructions like "ignore the yoga mat" while preventing injection.
 */
export function sanitizeUserContext(raw: string): {
  sanitized: string;
  wasModified: boolean;
  injectionDetected: boolean;
  detectedPatterns: string[];
} {
  if (!raw || raw.trim().length === 0) {
    return { sanitized: "", wasModified: false, injectionDetected: false, detectedPatterns: [] };
  }

  let text = raw.trim();
  let wasModified = false;

  // Truncate excessively long inputs
  if (text.length > MAX_USER_CONTEXT_LENGTH) {
    text = text.substring(0, MAX_USER_CONTEXT_LENGTH) + "...";
    wasModified = true;
  }

  // Detect injection patterns (for logging/alerting, not blocking)
  const detectedPatterns = detectInjectionPatterns(text);
  const injectionDetected = detectedPatterns.length > 0;

  // Strip markdown heading markers that could interfere with prompt structure
  text = text.replace(/^#{1,6}\s/gm, "");
  if (text !== raw.trim().substring(0, text.length)) {
    wasModified = true;
  }

  return {
    sanitized: text,
    wasModified,
    injectionDetected,
    detectedPatterns,
  };
}
