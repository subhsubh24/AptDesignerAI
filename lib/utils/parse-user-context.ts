/**
 * Parses free-text user context into structured constraints.
 *
 * Extracts:
 * - Explicit exclusions ("don't need curtains", "no curtains", "ignore the yoga mat")
 * - Explicit requests ("I want a dining table", "I want plants")
 * - Items to keep ("keep the black arc floor lamp")
 * - Lifestyle signals ("I like to host", "30 year old bachelor")
 *
 * These are injected into prompts as hard constraints so the model
 * cannot ignore them.
 */

export interface ParsedUserContext {
  /** Things the user explicitly does NOT want recommended */
  exclusions: string[];
  /** Things the user explicitly wants (with detected plurality) */
  explicitRequests: Array<{ item: string; wantsMultiple: boolean }>;
  /** Items the user wants to keep that may not be in the keepItems array */
  additionalKeepItems: string[];
  /** Lifestyle/personality context */
  lifestyleNotes: string[];
  /** Raw context passed through for anything not captured above */
  rawContext: string;
}

// Patterns that signal explicit exclusion
const EXCLUSION_PATTERNS = [
  // "don't need X", "don't want X", "no need for X"
  /(?:don'?t|do not)\s+(?:need|want|like|require)\s+(.+?)(?:\.|,|$)/gi,
  // "no curtains", "no rug"
  /\bno\s+(?:need\s+(?:for\s+)?)?(\w[\w\s]*?)(?:\.|,|$)/gi,
  // "skip the X", "skip X"
  /\bskip\s+(?:the\s+)?(.+?)(?:\.|,|$)/gi,
  // "ignore the X"
  /\bignore\s+(?:the\s+)?(.+?)(?:\.|,|$)/gi,
  // "won't be there", "it won't be there" — needs surrounding context
  /(?:the\s+)?(\w[\w\s]*?)\s+won'?t\s+be\s+there/gi,
  // "already have X" (implies don't recommend another) — requires "already" to avoid false positives
  /\balready\s+have\s+(\w[\w\s]*?)(?:\s+so\s+|\.|,|$)/gi,
  // "my windows have blinds so don't need curtains" — compound (only captures the excluded item, not the owned item)
  /have\s+\w+\s+so\s+(?:don'?t|do not)\s+need\s+(\w[\w\s]*?)(?:\.|,|$)/gi,
];

// Patterns that signal explicit requests
const REQUEST_PATTERNS = [
  // "I want X", "I'd like X", "I need X"
  /\bi\s+(?:want|need|would\s+like|'d\s+like)\s+(.+?)(?:\.|,|$)/gi,
  // "should have X"
  /\bshould\s+have\s+(.+?)(?:\.|,|$)/gi,
  // "it should be X" (style/feel)
  /\bit\s+should\s+be\s+(.+?)(?:\.|,|$)/gi,
];

// Patterns that signal keeping items
const KEEP_PATTERNS = [
  // "keep the X", "keep my X"
  /\bkeep\s+(?:the|my)\s+(.+?)(?:\.|,|$)/gi,
  // "keep both X", "keep all X", "keep these X", "keep those X"
  /\bkeep\s+(?:both|all|these|those|both\s+of\s+the|the\s+two|the\s+\d+)\s+(.+?)(?:\.|,|$)/gi,
  // "I want to keep the X", "I want to keep my X"
  /\bwant\s+to\s+keep\s+(?:the|my)\s+(.+?)(?:\.|,|$)/gi,
  // "I want to keep both X"
  /\bwant\s+to\s+keep\s+(?:both|all|these|those)\s+(.+?)(?:\.|,|$)/gi,
];

// Patterns that signal lifestyle context
const LIFESTYLE_PATTERNS = [
  // "I am a X", "I'm a X" — stop at period, comma, "and I" conjunction, or end of string
  /\bi\s+(?:am|'m)\s+(?:a\s+)?(.+?)(?:\.\s|\.\s*$|,\s|\s+and\s+i\s+|$)/gi,
  // "I like to X"
  /\bi\s+like\s+to\s+(.+?)(?:\.|,|$)/gi,
  // "I like X"
  /\bi\s+like\s+(?!to\s+)(.+?)(?:\.|,|$)/gi,
];

// Words that suggest plural/multiple items desired
const PLURAL_INDICATORS = /s\b|also|multiple|several|a few|some|various/i;

function extractMatches(text: string, patterns: RegExp[]): string[] {
  const matches: string[] = [];
  for (const pattern of patterns) {
    // Reset lastIndex for global patterns
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      // Take the last capture group (handles compound patterns)
      const captured = match[match.length - 1]?.trim();
      if (captured && captured.length > 1 && captured.length < 100) {
        matches.push(captured);
      }
    }
  }
  return dedupNearDuplicates(matches);
}

/**
 * Remove exact duplicates AND near-duplicates where one capture is a
 * substring of another. Overlapping regex patterns (e.g. "keep the X" vs
 * "keep the two X") produce captures like "two lights and light stands..."
 * and "lights and light stands..." from the same source text. Set-dedup
 * only catches exact matches, so we need substring-containment dedup.
 * Keep the longer (more specific) version when one contains the other.
 */
function dedupNearDuplicates(raw: string[]): string[] {
  // First pass: exact dedup (cheap)
  const unique = [...new Set(raw)];
  if (unique.length <= 1) return unique;

  // Second pass: substring-containment dedup. Sort by length desc so the
  // longer (more specific) capture is seen first and short duplicates get
  // suppressed.
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const sorted = [...unique].sort((a, b) => b.length - a.length);
  const kept: string[] = [];
  for (const candidate of sorted) {
    const cn = norm(candidate);
    // Skip if any already-kept entry contains this candidate OR this
    // candidate contains an already-kept entry (the longer one wins).
    const isSubstringOfKept = kept.some(
      (k) => {
        const kn = norm(k);
        return kn.includes(cn) || cn.includes(kn);
      }
    );
    if (!isSubstringOfKept) kept.push(candidate);
  }
  return kept;
}

/**
 * Async LLM-based parser. Calls Gemini for semantic understanding (catches
 * negations, paraphrases, lifestyle context that the regex misses), then
 * unions with the regex parse so we never lose anything the regex caught.
 *
 * Falls back to the pure regex parse if the LLM call fails or is disabled.
 */
export async function parseUserContextAsync(rawContext: string): Promise<ParsedUserContext> {
  if (!rawContext || rawContext.trim().length === 0) {
    return {
      exclusions: [],
      explicitRequests: [],
      additionalKeepItems: [],
      lifestyleNotes: [],
      rawContext: "",
    };
  }
  // Local import to avoid pulling the AI provider into sync paths that
  // never call this async variant (route handlers / agents pre-parse).
  const { parseUserContextLLM } = await import("@/lib/ai/semantic-extract");
  const [llm, regex] = await Promise.all([
    parseUserContextLLM(rawContext).catch(() => null),
    Promise.resolve(parseUserContext(rawContext)),
  ]);
  if (!llm) return regex;

  const dedupStrings = (xs: string[]): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const x of xs) {
      const k = x.toLowerCase().replace(/\s+/g, " ").trim();
      if (k && !seen.has(k)) { seen.add(k); out.push(x); }
    }
    return out;
  };
  const dedupRequests = (xs: ParsedUserContext["explicitRequests"]): ParsedUserContext["explicitRequests"] => {
    const seen = new Set<string>();
    const out: ParsedUserContext["explicitRequests"] = [];
    for (const r of xs) {
      const k = r.item.toLowerCase().replace(/\s+/g, " ").trim();
      if (k && !seen.has(k)) { seen.add(k); out.push(r); }
    }
    return out;
  };

  return {
    exclusions: dedupStrings([...llm.exclusions, ...regex.exclusions]),
    explicitRequests: dedupRequests([
      ...llm.explicit_requests.map((r) => ({ item: r.item, wantsMultiple: r.wants_multiple })),
      ...regex.explicitRequests,
    ]),
    additionalKeepItems: dedupStrings([...llm.additional_keep_items, ...regex.additionalKeepItems]),
    lifestyleNotes: dedupStrings([...llm.lifestyle_notes, ...regex.lifestyleNotes]),
    rawContext: rawContext.trim(),
  };
}

export function parseUserContext(rawContext: string): ParsedUserContext {
  if (!rawContext || rawContext.trim().length === 0) {
    return {
      exclusions: [],
      explicitRequests: [],
      additionalKeepItems: [],
      lifestyleNotes: [],
      rawContext: "",
    };
  }

  const text = rawContext.trim();

  // Extract exclusions
  const exclusions = extractMatches(text, EXCLUSION_PATTERNS)
    .filter((e) => e.length > 2);

  // Extract requests — filter out "I want to keep X" which is a keep signal, not a request
  const rawRequests = extractMatches(text, REQUEST_PATTERNS);
  const explicitRequests = rawRequests
    .filter((item) => !item.match(/^to\s+keep\b/i))
    .map((item) => ({
      item: item.replace(/\balso\b/gi, "").trim(),
      wantsMultiple: PLURAL_INDICATORS.test(item),
    })).filter((r) => r.item.length > 1);

  // Extract keep items
  const additionalKeepItems = extractMatches(text, KEEP_PATTERNS);

  // Extract lifestyle notes
  const lifestyleNotes = extractMatches(text, LIFESTYLE_PATTERNS);

  return {
    exclusions,
    explicitRequests,
    additionalKeepItems,
    lifestyleNotes,
    rawContext: text,
  };
}

/**
 * Format parsed context into prompt sections with appropriate weight.
 */
export function formatParsedContextForPrompt(parsed: ParsedUserContext): string {
  const sections: string[] = [];

  if (parsed.exclusions.length > 0) {
    sections.push(`## ⛔ EXPLICIT EXCLUSIONS — DO NOT RECOMMEND THESE
The client has explicitly said they DO NOT WANT the following. Recommending any of these is a critical error.
${parsed.exclusions.map((e) => `- ❌ ${e}`).join("\n")}
IMPORTANT: Do NOT recommend, suggest, or include any item in these excluded categories. Do NOT include them in the action list, missing categories, or design direction. This is NON-NEGOTIABLE.`);
  }

  if (parsed.additionalKeepItems.length > 0) {
    sections.push(`## ⚠️ ADDITIONAL ITEMS TO KEEP (from user notes)
The client mentioned wanting to keep these items. Design AROUND them — do not suggest replacing them.
${parsed.additionalKeepItems.map((k) => `- ✅ ${k}`).join("\n")}`);
  }

  if (parsed.explicitRequests.length > 0) {
    sections.push(`## ✅ EXPLICIT REQUESTS — CLIENT SPECIFICALLY WANTS THESE
The client has explicitly asked for these items. Ensure they appear in your recommendations.
${parsed.explicitRequests.map((r) => {
  const qty = r.wantsMultiple
    ? " (client used plural — recommend AT LEAST 2-3 varieties/options, not just one)"
    : "";
  return `- 🎯 ${r.item}${qty}`;
}).join("\n")}
IMPORTANT: Every item listed above MUST appear in your action_list and missing_categories. If the client asks for "plants" (plural), recommend multiple plants in different sizes/locations, not just one.`);
  }

  if (parsed.lifestyleNotes.length > 0) {
    sections.push(`## 👤 CLIENT LIFESTYLE CONTEXT
${parsed.lifestyleNotes.map((n) => `- ${n}`).join("\n")}
IMPORTANT: These details define WHO this client is. Your design direction and style_notes MUST explicitly reference their identity, age, personality, and lifestyle. For example, if the client is "a 30 year old bachelor working in tech who likes to be stylish but not performative," the style_notes should speak directly to that person — not generic design language. Every recommendation should feel like it was made FOR this specific person, not for an abstract "homeowner."`);
  }

  return sections.join("\n\n");
}
