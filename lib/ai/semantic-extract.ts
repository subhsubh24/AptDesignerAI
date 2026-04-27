/**
 * Centralized LLM-based semantic extraction utilities.
 *
 * Replaces brittle regex / heuristic / hardcoded-list patterns scattered
 * across the codebase with single-purpose Gemini calls. Each function:
 *   - Uses selectModel("quick_score") — Flash Lite at minimal cost.
 *   - Returns structured JSON via responseMimeType.
 *   - Has a hard timeout via Promise.race so a stalled call never blocks
 *     the pipeline.
 *   - Returns a typed `null` / empty result on failure so callers can
 *     fall through to their existing regex fallback (defense in depth).
 *
 * Performance contract: every helper here must be cheap (< 800 input
 * tokens, < 600 output tokens) so wiring them into hot paths doesn't
 * blow the per-run token budget. Latency is masked by `pLimit`-style
 * concurrency at callsites.
 */
import { geminiProvider } from "@/lib/ai/gemini";
import { selectModel } from "@/lib/ai/models";
import { extractJsonObject } from "@/lib/ai/extract-json";
import { DETERMINISTIC_SEED } from "@/lib/ai/determinism";
import { createLogger } from "@/lib/logging/logger";

const log = createLogger("semantic-extract");

/** Hard cap so a stalled LLM call can never hold up the pipeline. */
const SEMANTIC_CALL_TIMEOUT_MS = Number(process.env.SEMANTIC_CALL_TIMEOUT_MS) || 20_000;

/** Allow disabling all semantic LLM calls for ops debugging — falls through to regex everywhere. */
function isDisabled(): boolean {
  return process.env.DISABLE_SEMANTIC_EXTRACT === "1";
}

async function semanticChat<T>(opts: {
  system: string;
  user: string;
  maxTokens?: number;
  label: string;
}): Promise<T | null> {
  if (isDisabled()) return null;
  const model = selectModel("quick_score");
  try {
    const call = geminiProvider.chat({
      model,
      system: opts.system,
      messages: [{ role: "user", content: opts.user }],
      max_tokens: opts.maxTokens ?? 64000,
      seed: DETERMINISTIC_SEED,
      responseMimeType: "application/json",
    });
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`semantic-extract timeout (${opts.label})`)), SEMANTIC_CALL_TIMEOUT_MS)
    );
    const response = await Promise.race([call, timeout]);
    return extractJsonObject<T>(response.content);
  } catch (err) {
    log.debug("semantic-extract call failed — caller will fall back", {
      label: opts.label,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// ─── #1: Free-text user context parsing ─────────────────────────

export interface SemanticParsedContext {
  exclusions: string[];
  explicit_requests: Array<{ item: string; wants_multiple: boolean }>;
  additional_keep_items: string[];
  lifestyle_notes: string[];
}

/**
 * Replace EXCLUSION_PATTERNS / REQUEST_PATTERNS / KEEP_PATTERNS / LIFESTYLE_PATTERNS
 * regex in lib/utils/parse-user-context.ts. Catches negation ("I'm not fond of beige"),
 * compound clauses, and rephrased intents that the regex misses.
 */
export async function parseUserContextLLM(rawText: string): Promise<SemanticParsedContext | null> {
  if (!rawText || rawText.trim().length < 8) return null;
  const result = await semanticChat<SemanticParsedContext>({
    label: "parseUserContext",
    maxTokens: 64000,
    system:
      "You parse free-text client design notes into structured constraints for an interior-design LLM. Be conservative: only extract what the client clearly stated. Do NOT invent items. Skip vague preferences (e.g. 'comfortable'). Distinguish 'I'm not a fan of beige' (exclusion: beige) from 'I am a fan of beige' (request: beige). Return strict JSON.",
    user: `Parse this client note into JSON with this exact shape:
{
  "exclusions": string[],            // items the client clearly does NOT want — single-noun or short phrase, lowercased
  "explicit_requests": [{"item": string, "wants_multiple": boolean}],  // items they want; wants_multiple=true if plural noun or words like 'multiple', 'a few', 'several'
  "additional_keep_items": string[], // items they want kept (not from a separate keep list)
  "lifestyle_notes": string[]        // identity / persona / habits — short phrases, no leading 'I am' / 'I like'
}

Rules:
- Skip stopwords ('it', 'them', 'stuff'). Items must be ≥3 chars.
- Negations: 'I don't like X', 'I'm not into X', 'no X', 'skip X', 'won't be there' → exclusion.
- Possession-implying-exclusion: 'I already have X' → exclusion of new X.
- 'keep my X' / 'keep the X' → additional_keep_items.
- Lifestyle: 'I'm a 30 year old bachelor', 'I like to host' → 'a 30 year old bachelor', 'host'.
- Empty arrays are valid.

CLIENT NOTE:
"""
${rawText.slice(0, 1500)}
"""

Return ONLY the JSON object.`,
  });
  if (!result) return null;
  // Defensive normalization
  return {
    exclusions: Array.isArray(result.exclusions) ? result.exclusions.filter((s) => typeof s === "string" && s.trim().length > 1).map((s) => s.trim()) : [],
    explicit_requests: Array.isArray(result.explicit_requests)
      ? result.explicit_requests
          .filter((r) => r && typeof r.item === "string" && r.item.trim().length > 1)
          .map((r) => ({ item: r.item.trim(), wants_multiple: !!r.wants_multiple }))
      : [],
    additional_keep_items: Array.isArray(result.additional_keep_items) ? result.additional_keep_items.filter((s) => typeof s === "string" && s.trim().length > 1).map((s) => s.trim()) : [],
    lifestyle_notes: Array.isArray(result.lifestyle_notes) ? result.lifestyle_notes.filter((s) => typeof s === "string" && s.trim().length > 1).map((s) => s.trim()) : [],
  };
}

// ─── #2: Semantic exclusion expansion ───────────────────────────

/**
 * Replace expandExclusionTerms() synonym map. The hardcoded map only covers
 * curtain/blind/rug/lamp/yoga; this catches everything the user might say
 * (sectional → sofa/couch/loveseat; succulent → plant/greenery; etc.).
 */
export async function expandExclusionTermsLLM(exclusions: string[]): Promise<string[] | null> {
  if (exclusions.length === 0) return [];
  const result = await semanticChat<{ expanded: string[] }>({
    label: "expandExclusionTerms",
    maxTokens: 64000,
    system:
      "You expand a furniture/decor item name into all near-synonyms a designer might use. Output a flat array of lowercase singular+plural forms. Be exhaustive within the same category but never cross categories.",
    user: `For each excluded item below, list every common synonym, plural, and category-equivalent term. Example: 'curtain' → ['curtain','curtains','drapery','drapes','window panel','window treatment','sheer','sheers']

Return JSON: {"expanded": string[]}

Excluded items: ${JSON.stringify(exclusions)}`,
  });
  if (!result || !Array.isArray(result.expanded)) return null;
  const cleaned = result.expanded
    .filter((s) => typeof s === "string" && s.trim().length >= 2 && s.trim().length < 50)
    .map((s) => s.trim().toLowerCase());
  // Always include the original exclusion terms
  return [...new Set([...exclusions.map((e) => e.toLowerCase().trim()), ...cleaned])];
}

// ─── #3: Architectural-vs-furniture classifier ──────────────────

/**
 * Replace ARCHITECTURAL_PATTERNS in area-analysis-validator. Decides whether
 * a free-text "what works" entry describes a built-in / architectural feature
 * (flooring, paint, cabinetry, ceiling fixtures) that doesn't belong on the
 * shopping side of the analysis.
 */
export async function classifyArchitecturalLLM(items: string[]): Promise<Set<string> | null> {
  if (items.length === 0) return new Set();
  const result = await semanticChat<{ architectural: string[] }>({
    label: "classifyArchitectural",
    maxTokens: 64000,
    system:
      "You decide whether each item is an ARCHITECTURAL feature (built-in, fixed, requires construction — flooring, walls, paint, cabinetry, countertops, ceiling fixtures, HVAC) versus FURNITURE/DECOR (movable, purchasable). Architectural items don't go on a shopping list.",
    user: `Return JSON listing the items that are architectural features (NOT shoppable furniture/decor):
{"architectural": string[]}

Items:
${items.map((s, i) => `${i}: ${s}`).join("\n")}

Return ONLY the architectural items VERBATIM as they appear in the input.`,
  });
  if (!result || !Array.isArray(result.architectural)) return null;
  return new Set(result.architectural.filter((s) => typeof s === "string"));
}

// ─── #4: "Invalid remove" classifier ────────────────────────────

/**
 * Replace INVALID_REMOVE_PATTERNS. Decides which entries in what_should_go
 * aren't actually removable physical items (absences, generic platitudes,
 * built-ins like ceiling lights, exposed cords/outlets).
 */
export async function classifyInvalidRemoveLLM(items: string[]): Promise<Set<string> | null> {
  if (items.length === 0) return new Set();
  const result = await semanticChat<{ invalid: string[] }>({
    label: "classifyInvalidRemove",
    maxTokens: 64000,
    system:
      "You decide whether each entry in a 'what should go' list is a REMOVABLE physical item (a couch, a vase) versus something INVALID for a removal list (an absence like 'lack of art', a built-in like 'ceiling fixture', infrastructure like 'wall outlet', or a generic platitude like 'any matching pieces').",
    user: `Return JSON listing items that are NOT validly removable:
{"invalid": string[]}

Items:
${items.map((s, i) => `${i}: ${s}`).join("\n")}

Return ONLY the invalid items VERBATIM.`,
  });
  if (!result || !Array.isArray(result.invalid)) return null;
  return new Set(result.invalid.filter((s) => typeof s === "string"));
}

// ─── #5: Style direction classification ─────────────────────────

/** Closed vocabulary that matches DIRECTION_BUCKETS in lib/db/diagnosis-examples.ts. */
const STYLE_LABELS = [
  "Japandi", "Scandinavian", "Minimalist", "Mid-Century Modern",
  "Contemporary", "Modern", "Transitional", "Coastal", "Farmhouse",
  "Bohemian", "Bohemian Coastal", "Maximalist", "Eclectic",
  "Traditional", "Classic", "Art Deco", "Industrial",
] as const;

/**
 * Replace inferStyleLabel() in room-diagnostician. The regex misses style
 * paraphrases (e.g. "warm minimalist with mid-century influence") and
 * material-driven heuristics ('rattan + linen → coastal').
 */
export async function classifyStyleLabelLLM(
  styleNotes: string,
  materials: string[]
): Promise<string | null> {
  const haystack = `${styleNotes} ${materials.join(" ")}`.trim();
  if (haystack.length < 8) return null;
  const result = await semanticChat<{ label: string | null }>({
    label: "classifyStyleLabel",
    maxTokens: 64000,
    system:
      "You classify an interior-design direction into ONE label from a closed vocabulary. Pick the SINGLE best match based on style notes + recommended materials. Return null if nothing fits confidently.",
    user: `Allowed labels: ${STYLE_LABELS.join(", ")}

Style notes + materials:
${haystack.slice(0, 800)}

Return JSON: {"label": "<one label from the list, or null>"}`,
  });
  if (!result || typeof result.label !== "string") return null;
  const label = result.label;
  // Canonicalize to known label
  const match = STYLE_LABELS.find((s) => s.toLowerCase() === label.toLowerCase());
  return match ?? null;
}

// ─── #6: Semantic product deduplication ─────────────────────────

export interface DedupGroup {
  /** IDs of products that are duplicates of each other (same product, different listing) */
  duplicate_ids: string[];
}

/**
 * Replace fuzzy title regex dedup in orchestrator.ts. Catches IKEA naming
 * variants ("KALLAX 2x4" vs "Kallax Bookshelf 2×4 White") that the size/color
 * suffix regex can't normalize.
 *
 * @param items {id, title, retailer} per-tier products to dedup
 * @returns Set of IDs to drop (keeping one per duplicate group), or null on failure
 */
export async function dedupProductTitlesLLM(
  items: Array<{ id: string; title: string; retailer: string | null }>
): Promise<Set<string> | null> {
  if (items.length < 2) return new Set();
  // Limit batch size to keep prompts bounded
  const batch = items.slice(0, 30);
  const result = await semanticChat<{ groups: DedupGroup[] }>({
    label: "dedupProductTitles",
    maxTokens: 64000,
    system:
      "You group product listings that are the same physical product despite different titles. Match on retailer + product line + model name. DIFFERENT sizes / colors of the same model count as duplicates (we dedupe at the catalog level). DIFFERENT models in the same product line do NOT (e.g. Kallax 2x2 vs Kallax 4x4 are duplicates of catalog 'Kallax', but Kallax vs Billy are not).",
    user: `Find duplicate listings. Return JSON:
{"groups": [{"duplicate_ids": ["id1","id2",...]}, ...]}

Only include groups with 2+ duplicates. Items not duplicated of anything else: omit entirely.

Items:
${batch.map((p) => `[${p.id}] (${p.retailer ?? "?"}) ${p.title}`).join("\n")}`,
  });
  if (!result || !Array.isArray(result.groups)) return null;
  const drop = new Set<string>();
  for (const g of result.groups) {
    if (!Array.isArray(g.duplicate_ids) || g.duplicate_ids.length < 2) continue;
    // Keep first, drop the rest
    for (let i = 1; i < g.duplicate_ids.length; i++) {
      if (typeof g.duplicate_ids[i] === "string") drop.add(g.duplicate_ids[i]);
    }
  }
  return drop;
}

// ─── #7: Scrape-sufficiency check ───────────────────────────────

/**
 * Replace isScrapeContextSufficient() in product-extractor. The regex looks
 * for literal "Title:" / "Price:" labels — misses pages whose JSON-LD lists
 * fields under "Product Name" or "$129.99" without the prefix.
 */
export async function isScrapeContextSufficientLLM(scrapedContext: string): Promise<boolean | null> {
  if (!scrapedContext || scrapedContext.length < 30) return false;
  const result = await semanticChat<{ sufficient: boolean }>({
    label: "scrapeSufficient",
    maxTokens: 64000,
    system:
      "You decide whether scraped product-page text contains enough info to extract a product (must have a clear product name AND at least one of: price, description, dimensions). Be lenient: if the info is there but unlabeled, count it.",
    user: `Scraped context:
"""
${scrapedContext.slice(0, 1200)}
"""

Return JSON: {"sufficient": boolean}`,
  });
  if (!result || typeof result.sufficient !== "boolean") return null;
  return result.sufficient;
}

// ─── #8: Category match (semantic) ──────────────────────────────

/**
 * Replace alias-list lookup in category-match.ts. Accepts an extracted product
 * (title + extractor's category guess) and decides whether it plausibly fits
 * the requested category. Catches synonyms the alias list misses (settee →
 * sofa) AND disqualifies clearly-wrong items (lint roller, gift card).
 */
export async function productMatchesCategoryLLM(
  expectedCategory: string,
  title: string | null | undefined,
  extractedCategory: string | null | undefined
): Promise<{ ok: boolean; reason: string } | null> {
  if (!expectedCategory) return { ok: true, reason: "no expected category" };
  if (!title && !extractedCategory) return { ok: false, reason: "no title or category" };
  const result = await semanticChat<{ ok: boolean; reason: string }>({
    label: "productMatchesCategory",
    maxTokens: 64000,
    system:
      "You decide whether a shopping result actually matches a furniture category request. Reject obvious wrong-category items (gift cards, cleaning supplies, books, apparel, warranty plans). Accept legitimate synonyms (settee = sofa, ottoman = pouf, credenza = sideboard).",
    user: `Expected category: ${expectedCategory}
Extracted category: ${extractedCategory ?? "(not extracted)"}
Product title: ${title ?? "(no title)"}

Return JSON: {"ok": boolean, "reason": "<≤12 word explanation>"}`,
  });
  if (!result || typeof result.ok !== "boolean") return null;
  return {
    ok: result.ok,
    reason: typeof result.reason === "string" ? result.reason : "",
  };
}

// ─── #9: Color/material lookup fallback ─────────────────────────

export interface ColorHSL {
  h: number;
  s: number;
  l: number;
}

/**
 * Fallback for COLOR_HSL_MAP misses in lib/validation/lookups.ts. Designer
 * collections use one-off color names ("Mediterranean blue", "muted sage")
 * that the hardcoded table doesn't have. Returns approximate HSL.
 */
export async function inferColorHslLLM(colorName: string): Promise<ColorHSL | null> {
  if (!colorName || colorName.trim().length < 2) return null;
  const result = await semanticChat<ColorHSL>({
    label: "inferColorHsl",
    maxTokens: 64000,
    system:
      "You map a color name to HSL (Hue 0-360, Saturation 0-100, Lightness 0-100). Be conservative — pick the most typical interpretation of the name in interior design context.",
    user: `Color: "${colorName}"
Return JSON: {"h": number, "s": number, "l": number}`,
  });
  if (!result || typeof result.h !== "number" || typeof result.s !== "number" || typeof result.l !== "number") return null;
  // Clamp to valid ranges
  return {
    h: Math.max(0, Math.min(360, result.h)),
    s: Math.max(0, Math.min(100, result.s)),
    l: Math.max(0, Math.min(100, result.l)),
  };
}

// ─── #10: Cross-room preference summarization ───────────────────

export interface SemanticPreferenceSummary {
  density_preference: "minimalist" | "balanced" | "maximalist" | "unknown";
  budget_pressure: "tight" | "comfortable" | "premium" | "unknown";
  /** One sentence summarizing the user's recurring taste signals across rooms */
  taste_summary: string;
}

/**
 * Replace inferDensityPreference() / inferBudgetPressure() / topFrequent()
 * heuristics in infer-preferences.ts. Synthesizes density + budget + a free-
 * form taste summary from prior-room data — the LLM can weigh recency, intent,
 * and conflicting signals (one budget room + one premium room = "comfortable
 * but flexible") in ways that frequency counting can't.
 */
export async function summarizePreferencesLLM(input: {
  keep_items: string[];
  replace_items: string[];
  materials: string[];
  palette: string[];
  style_notes: string[];
  priorities: string[];
  user_context_snippets: string[];
  budget_modes: string[];
  per_room_item_counts: number[];
}): Promise<SemanticPreferenceSummary | null> {
  if (input.per_room_item_counts.length === 0) return null;
  const result = await semanticChat<SemanticPreferenceSummary>({
    label: "summarizePreferences",
    maxTokens: 64000,
    system:
      "You summarize a household's design preferences from prior-room signals. Output ONE density label (minimalist/balanced/maximalist/unknown), ONE budget label (tight/comfortable/premium/unknown), and a one-sentence taste summary. Reason about intent — a 'budget' room because of constraints + a 'best_possible' room from a bonus = 'comfortable'.",
    user: `Prior-room signals:
- Items kept (across rooms): ${input.keep_items.slice(0, 20).join("; ")}
- Items replaced: ${input.replace_items.slice(0, 20).join("; ")}
- Recurring materials: ${input.materials.slice(0, 15).join(", ")}
- Recurring palette: ${input.palette.slice(0, 15).join(", ")}
- Style notes (recent first): ${input.style_notes.slice(0, 5).join(" | ")}
- Priorities: ${input.priorities.slice(0, 10).join(", ")}
- Past free-form notes: ${input.user_context_snippets.slice(0, 3).map((s) => `"${s}"`).join(" | ")}
- Budget modes per room: ${input.budget_modes.join(", ")}
- Items per room: ${input.per_room_item_counts.join(", ")}

Return JSON:
{
  "density_preference": "minimalist" | "balanced" | "maximalist" | "unknown",
  "budget_pressure": "tight" | "comfortable" | "premium" | "unknown",
  "taste_summary": "one sentence summary"
}`,
  });
  if (!result) return null;
  const validDensity = ["minimalist", "balanced", "maximalist", "unknown"] as const;
  const validBudget = ["tight", "comfortable", "premium", "unknown"] as const;
  return {
    density_preference: (validDensity as readonly string[]).includes(result.density_preference) ? result.density_preference : "unknown",
    budget_pressure: (validBudget as readonly string[]).includes(result.budget_pressure) ? result.budget_pressure : "unknown",
    taste_summary: typeof result.taste_summary === "string" ? result.taste_summary.slice(0, 280) : "",
  };
}

// ─── #11: Keep-item category extraction ─────────────────────────

export interface KeepItemCategory {
  /** Original keep item text */
  item: string;
  /** Category keywords that would conflict with NEW recommendations of the same kind */
  category_keywords: string[];
  /** Optional location context ("behind the sofa", "next to the TV") */
  location_phrase: string;
}

/**
 * Replace extractKeepCategories() / stripLocationContext() / extractLocationContext()
 * in diagnosis-validator + area-analysis-validator. The hardcoded categoryPatterns
 * misses anything outside the ~12 listed types (e.g. "keep my Eames chair" doesn't
 * match the rocking_chair / desk_chair patterns).
 */
export async function extractKeepCategoriesLLM(keepItems: string[]): Promise<KeepItemCategory[] | null> {
  if (keepItems.length === 0) return [];
  const result = await semanticChat<{ items: KeepItemCategory[] }>({
    label: "extractKeepCategories",
    maxTokens: 64000,
    system:
      "You extract structured keep-item info for a constraint validator. For each item the user wants to keep, return: the category keywords that should block NEW recommendations of the same kind (don't recommend a new sofa if they're keeping their sofa) AND any location phrase. Output original item text VERBATIM.",
    user: `For each keep item, return:
{
  "items": [
    {
      "item": "<original text>",
      "category_keywords": ["<broad category>", "<specific type>", ...],
      "location_phrase": "<location context like 'next to the sofa' or empty string>"
    }
  ]
}

Example: "the black arc floor lamp behind the sofa" →
{"item":"the black arc floor lamp behind the sofa","category_keywords":["floor lamp","arc lamp","standing lamp","light"],"location_phrase":"behind the sofa"}

Keep items:
${keepItems.map((k, i) => `${i}: ${k}`).join("\n")}`,
  });
  if (!result || !Array.isArray(result.items)) return null;
  return result.items
    .filter((x) => x && typeof x.item === "string")
    .map((x) => ({
      item: x.item,
      category_keywords: Array.isArray(x.category_keywords) ? x.category_keywords.filter((s) => typeof s === "string").map((s) => s.toLowerCase().trim()) : [],
      location_phrase: typeof x.location_phrase === "string" ? x.location_phrase : "",
    }));
}
