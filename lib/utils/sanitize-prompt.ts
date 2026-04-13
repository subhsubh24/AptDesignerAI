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
 * PII patterns with their redaction placeholders.
 *
 * Kept intentionally conservative — we'd rather miss a rare format than
 * redact a legitimate numeric dimension ("84x36") as if it were a phone
 * number. Each pattern is paired with a placeholder so downstream prompts
 * still read naturally ("contact me at [EMAIL]" vs. the raw address).
 */
const PII_PATTERNS: { pattern: RegExp; placeholder: string; label: string }[] = [
  // Emails — the most common incidental leak
  {
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    placeholder: "[EMAIL]",
    label: "email",
  },
  // US Social Security Numbers (xxx-xx-xxxx). Strict format only to avoid
  // collapsing any 9-digit number the user might type (e.g., a zip + ext).
  {
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    placeholder: "[SSN]",
    label: "ssn",
  },
  // Credit card numbers (13-19 digits with optional separators). Loose but
  // gated on digit count to avoid eating dimension strings.
  {
    pattern: /\b(?:\d[ -]?){13,19}\b/g,
    placeholder: "[CARD]",
    label: "credit_card",
  },
  // Phone numbers — US-style (xxx) xxx-xxxx, xxx-xxx-xxxx, +1 xxx xxx xxxx.
  // Intentionally requires separators so "72x120" ≠ phone.
  {
    pattern: /(?:\+?\d{1,2}[\s.-]?)?(?:\(\d{3}\)[\s.-]?|\d{3}[\s.-])\d{3}[\s.-]\d{4}\b/g,
    placeholder: "[PHONE]",
    label: "phone",
  },
];

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
 * Redact PII from free-form user input before it flows into an LLM prompt.
 *
 * Returns the redacted text and a list of categories that matched. We run
 * every pattern and replace matches in place with a neutral placeholder
 * so downstream prompts still read naturally.
 */
export function redactPII(text: string): {
  redacted: string;
  categories: string[];
} {
  if (!text) return { redacted: "", categories: [] };

  let out = text;
  const found = new Set<string>();

  for (const { pattern, placeholder, label } of PII_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(out)) {
      found.add(label);
      pattern.lastIndex = 0;
      out = out.replace(pattern, placeholder);
    }
  }

  return { redacted: out, categories: [...found] };
}

/**
 * Sanitize user context for safe prompt embedding.
 *
 * Does NOT block the content — instead wraps it clearly so the model
 * understands it's quoted user text. This preserves legitimate user
 * instructions like "ignore the yoga mat" while preventing injection.
 *
 * Also redacts obvious PII (emails, phone numbers, SSNs, credit card
 * numbers) so it never reaches the provider. Design-time apartment
 * context should never contain these, so redaction is pure upside.
 */
export function sanitizeUserContext(raw: string): {
  sanitized: string;
  wasModified: boolean;
  injectionDetected: boolean;
  detectedPatterns: string[];
  piiCategories: string[];
} {
  if (!raw || raw.trim().length === 0) {
    return {
      sanitized: "",
      wasModified: false,
      injectionDetected: false,
      detectedPatterns: [],
      piiCategories: [],
    };
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

  // Redact PII before the text reaches any downstream prompt.
  const { redacted, categories: piiCategories } = redactPII(text);
  if (piiCategories.length > 0) {
    text = redacted;
    wasModified = true;
  }

  // Strip markdown heading markers that could interfere with prompt structure
  const beforeHeadingStrip = text;
  text = text.replace(/^#{1,6}\s/gm, "");
  if (text !== beforeHeadingStrip) {
    wasModified = true;
  }

  return {
    sanitized: text,
    wasModified,
    injectionDetected,
    detectedPatterns,
    piiCategories,
  };
}
