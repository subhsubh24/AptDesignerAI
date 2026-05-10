/**
 * Generic self-correction framework for agentic pipelines.
 *
 * Pattern: generate → validate → correct → validate again.
 * Each agent's output goes through an LLM-based self-review that catches
 * logical inconsistencies, missing items, and contradictions that a single
 * pass would miss. The correction loop is bounded (max 2 rounds) and
 * fails open (returns uncorrected output if the correction itself errors).
 */

import { getProvider } from "@/lib/ai/provider-factory";
import { selectModel } from "@/lib/ai/models";
import { extractJsonObject } from "@/lib/ai/extract-json";
import { DETERMINISTIC_SEED } from "@/lib/ai/determinism";
import { createLogger } from "@/lib/logging/logger";

const log = createLogger("self-correction");

const MAX_CORRECTION_ROUNDS = 2;

const SPATIAL_PREP_PATTERN = /\s+(?:behind|beside|next to|near|by|on top of|under|underneath|above|over|in front of|across from|facing|against|to the (?:left|right) of|between)\s+(?:the\s+)?/gi;
const STOP_AFTER_PATTERN = /\s+(?:and|or|with|to|for|in|on|at|by|that|which|while|but|so|because)\b/i;

/**
 * Extract furniture-like nouns mentioned AFTER spatial prepositions in keep items.
 * E.g. "black arc floor lamp behind the sofa" → {"sofa"}.
 * Used to detect when the self-correction LLM has misinterpreted spatial
 * context as a keep instruction for the referenced furniture.
 */
export function extractSpatialContextNouns(keepItems: string[]): Set<string> {
  const nouns = new Set<string>();
  for (const item of keepItems) {
    const lower = item.toLowerCase();
    let match: RegExpExecArray | null;
    SPATIAL_PREP_PATTERN.lastIndex = 0;
    while ((match = SPATIAL_PREP_PATTERN.exec(lower)) !== null) {
      const after = lower.slice(match.index + match[0].length);
      const stopMatch = after.match(STOP_AFTER_PATTERN);
      const phrase = (stopMatch ? after.slice(0, stopMatch.index) : after).trim();
      const tokens = phrase.replace(/[^a-z\s]/g, " ").split(/\s+/).filter((t) => t.length >= 3);
      for (const token of tokens) {
        nouns.add(token);
      }
    }
  }
  return nouns;
}

export interface SelfReviewResult<T> {
  output: T;
  wasCorrepted: boolean;
  correctionRounds: number;
  issues: string[];
}

/**
 * LLM-based self-review for area-analysis output. Checks:
 * - Logical consistency between what_works, what_should_go, and what_it_needs
 * - Furniture pairing coherence (chairs without table, nightstands without bed)
 * - Spatial feasibility (too many items for room size)
 * - Style consistency (recommendations match the stated design_direction)
 */
export async function selfReviewAreaAnalysis(
  analysis: Record<string, unknown>,
  keepItems: string[],
  roomType: string,
  userRequests?: string[],
): Promise<SelfReviewResult<Record<string, unknown>>> {
  let current = analysis;
  const allIssues: string[] = [];
  const originalSummary = (analysis.summary as string | undefined) || "";

  for (let round = 0; round < MAX_CORRECTION_ROUNDS; round++) {
    try {
      const reviewResult = await reviewAreaAnalysisRound(current, keepItems, roomType, userRequests);
      if (!reviewResult) break;

      if (reviewResult.is_consistent && reviewResult.issues.length === 0) {
        log.info("Area analysis self-review passed", { round });
        break;
      }

      allIssues.push(...reviewResult.issues);

      if (reviewResult.corrected_analysis) {
        log.warn("Area analysis self-correction applied", {
          round,
          issueCount: reviewResult.issues.length,
          issues: reviewResult.issues,
        });
        const corrected = reviewResult.corrected_analysis;
        // Hard guard: the summary describes what's in the photos and is
        // immutable. If the LLM "fixed" a grounding issue by enriching the
        // summary (rather than dropping unanchored items), revert. Keep
        // every other deletion the LLM made.
        const correctedSummary = (corrected.summary as string | undefined) || "";
        if (correctedSummary !== originalSummary) {
          log.warn("Self-correction tried to modify summary — reverting", {
            originalLen: originalSummary.length,
            correctedLen: correctedSummary.length,
          });
          corrected.summary = originalSummary;
        }
        // Hard guard: restore what_works entries for user keep items.
        // The user explicitly said to keep these — the self-corrector must not
        // remove them even if it thinks they're "redundant" or "unanchored".
        if (keepItems.length > 0 && Array.isArray(corrected.what_works)) {
          const prevWorks = Array.isArray(current.what_works)
            ? (current.what_works as string[])
            : [];
          const correctedWorks = corrected.what_works as string[];
          const correctedWorksLower = correctedWorks.map((w) => w.toLowerCase());
          const KEEP_SYN: Record<string, string[]> = {
            sofa: ["sectional", "couch"], sectional: ["sofa", "couch"], couch: ["sofa", "sectional"],
            bookshelf: ["bookcase", "shelving"], bookcase: ["bookshelf"], shelving: ["bookshelf", "bookcase"],
            rug: ["carpet"], carpet: ["rug"], lamp: ["light"], light: ["lamp"],
            tv: ["television"], television: ["tv"], ottoman: ["footstool", "pouf"],
          };
          // Generic descriptors that must not anchor a match on their own.
          // E.g. "floor" in keep "black arc floor lamp" should not match a
          // what_works entry like "Floor-to-ceiling roller shades" — only the
          // OBJECT noun ("lamp") should anchor.
          const KEEP_GENERIC = new Set([
            "floor", "wall", "ceiling", "corner", "back", "front", "left", "right",
            "side", "top", "bottom", "near", "next", "behind", "above", "below",
            "black", "white", "grey", "gray", "brown", "blue", "red", "green",
            "beige", "tan", "cream", "ivory", "natural", "neutral",
            "small", "large", "long", "short", "tall", "wide", "narrow", "big", "mini",
            "two", "three", "four", "five", "set", "pair", "the", "and", "with",
            "also", "possible", "for", "next", "from",
          ]);
          const matchesKeep = (entry: string): string | null => {
            const lower = entry.toLowerCase();
            for (const ki of keepItems) {
              const kiNorm = ki.toLowerCase().replace(/[^a-z0-9\s]/g, " ").trim();
              if (!kiNorm) continue;
              if (lower.includes(kiNorm)) return ki;
              for (const word of kiNorm.split(/\s+/)) {
                if (word.length < 3 || KEEP_GENERIC.has(word)) continue;
                if (lower.includes(word)) return ki;
                const syns = KEEP_SYN[word];
                if (syns?.some((s) => lower.includes(s))) return ki;
              }
            }
            return null;
          };
          for (const entry of prevWorks) {
            const keepMatch = matchesKeep(entry);
            if (keepMatch && !correctedWorksLower.some((cw) => cw === entry.toLowerCase())) {
              log.warn("Self-correction removed user keep item from what_works — restoring", {
                entry,
                matchedKeep: keepMatch,
              });
              correctedWorks.push(entry);
              correctedWorksLower.push(entry.toLowerCase());
            }
          }
        }
        // Hard guard: restore what_should_go entries the LLM removed because it
        // misinterpreted spatial context in a keep item ("behind the sofa")
        // as a keep instruction for the spatially-referenced object. If a keep
        // item like "lamp behind the sofa" mentions a sofa, the user is keeping
        // the lamp, not the sofa — but the LLM sometimes infers otherwise and
        // strips sofa entries from what_should_go.
        if (Array.isArray(corrected.what_should_go) && keepItems.length > 0) {
          const spatialContextNouns = extractSpatialContextNouns(keepItems);
          if (spatialContextNouns.size > 0) {
            const prevShouldGo = Array.isArray(current.what_should_go)
              ? (current.what_should_go as string[])
              : [];
            const correctedShouldGo = corrected.what_should_go as string[];
            const correctedShouldGoLower = correctedShouldGo.map((e) => e.toLowerCase());
            for (const entry of prevShouldGo) {
              if (typeof entry !== "string") continue;
              const lower = entry.toLowerCase();
              if (correctedShouldGoLower.includes(lower)) continue;
              const referencesSpatialNoun = Array.from(spatialContextNouns).some((noun) => lower.includes(noun));
              if (referencesSpatialNoun) {
                log.warn("Self-correction stripped what_should_go entry referenced by spatial keep context — restoring", {
                  entry,
                  spatialNouns: Array.from(spatialContextNouns),
                });
                correctedShouldGo.push(entry);
                correctedShouldGoLower.push(lower);
              }
            }
          }
        }
        // Hard guard: restore what_it_needs items the LLM removed that match
        // user-requested categories. The user explicitly asked for these.
        if (userRequests && userRequests.length > 0 && Array.isArray(corrected.what_it_needs)) {
          const prevNeeds = Array.isArray(current.what_it_needs)
            ? (current.what_it_needs as Array<Record<string, unknown>>)
            : [];
          const correctedNeeds = corrected.what_it_needs as Array<Record<string, unknown>>;
          const correctedCats = new Set(correctedNeeds.map((n) => String(n.category || "").toLowerCase()));
          const requestNorm = userRequests.map((r) => r.toLowerCase().replace(/[\s-]+/g, "_"));
          for (const item of prevNeeds) {
            const cat = String(item.category || "").toLowerCase();
            if (!correctedCats.has(cat) && requestNorm.some((r) => cat.includes(r) || r.includes(cat))) {
              log.warn("Self-correction removed user-requested item — restoring", {
                category: cat,
                matchedRequest: requestNorm.find((r) => cat.includes(r) || r.includes(cat)),
              });
              correctedNeeds.push(item);
              correctedCats.add(cat);
            }
          }
        }
        current = corrected;
      } else {
        break;
      }
    } catch (err) {
      log.debug("Self-review round failed — accepting current output", {
        round,
        error: err instanceof Error ? err.message : String(err),
      });
      break;
    }
  }

  // NOTE: filterUnanchoredItems is intentionally NOT invoked here. Cleanup of
  // what_works / what_should_go runs upstream in keep-replace-reconciler.ts,
  // which has access to Pass B's what_it_needs and can resolve cross-references
  // with full context. The deterministic filter remains exported for use as a
  // fallback or in tests.

  return {
    output: current,
    wasCorrepted: allIssues.length > 0,
    correctionRounds: allIssues.length > 0 ? Math.min(allIssues.length, MAX_CORRECTION_ROUNDS) : 0,
    issues: allIssues,
  };
}

/**
 * Drop entries in what_should_go and what_works that are clearly hallucinated.
 *
 * ARCHITECTURE NOTE: Pass A sees the room photos directly when it generates
 * what_works and what_should_go. The self-corrector and this deterministic
 * filter do NOT see the photos — they only see the analysis text. So we
 * cannot verify grounding against the photos themselves; we can only catch
 * specific anti-patterns that are detectable from text alone:
 *
 * 1. The "cross-reference" hallucination: Pass A invents an existing item to
 *    justify a recommended purchase (e.g. recommends buying area_rug AND
 *    claims a bad area_rug already exists in the room). When the head noun of
 *    a what_should_go entry exactly matches a what_it_needs category AND no
 *    other anchor confirms it (summary, keep_items), it's the rug pattern.
 *
 * 2. Abstract concepts: entries with no concrete physical object name
 *    (e.g. "loose clutter", "impersonal arrangement").
 *
 * 3. For what_works: entries that match no token in summary, keep_items, or
 *    what_should_go (even with synonyms). These are typically pure
 *    fabrications.
 *
 * Otherwise we TRUST Pass A's direct observation of the photos.
 */
export function filterUnanchoredItems(
  analysis: Record<string, unknown>,
  keepItems: string[],
  photoVerifiedEntries?: string[],
): Record<string, unknown> {
  const summary = ((analysis.summary as string | undefined) || "").toLowerCase();
  const keepText = keepItems.join(" ").toLowerCase();
  const shouldGoText = Array.isArray(analysis.what_should_go)
    ? (analysis.what_should_go as string[]).join(" ").toLowerCase()
    : "";

  // Collect what_it_needs categories EXACTLY (no tokenization). The cross-ref
  // detection only fires when an entry's full head phrase matches a complete
  // category — not when a single common word like "table" partially matches
  // "coffee_table". Otherwise generic terms would falsely trigger drops.
  const needsCategoriesFull = new Set<string>();
  if (Array.isArray(analysis.what_it_needs)) {
    for (const n of analysis.what_it_needs as Array<Record<string, unknown>>) {
      const cat = String(n.category || "").toLowerCase().trim();
      if (cat) needsCategoriesFull.add(cat);
    }
  }

  const STOPWORDS = new Set([
    "the", "and", "with", "for", "from", "this", "that", "into", "your", "their",
    "modern", "stylish", "cheap", "expensive", "small", "large", "old", "new",
    "wrong", "right", "good", "bad", "generic", "mass", "produced", "mismatched",
    "inconsistent", "outdated", "low", "high", "quality",
  ]);

  const FURNITURE_SYNONYMS: Record<string, readonly string[]> = {
    sofa: ["sectional", "couch", "loveseat", "settee"],
    sectional: ["sofa", "couch"],
    couch: ["sofa", "sectional"],
    loveseat: ["sofa"],
    settee: ["sofa"],
    bookshelf: ["bookcase", "shelving", "shelves"],
    bookcase: ["bookshelf", "shelving", "shelves"],
    shelves: ["bookshelf", "bookcase", "shelving"],
    shelving: ["bookshelf", "bookcase", "shelves"],
    rug: ["carpet"],
    carpet: ["rug"],
    lamp: ["light", "sconce", "pendant"],
    light: ["lamp"],
    sconce: ["lamp"],
    tv: ["television"],
    television: ["tv"],
    desk: ["workspace"],
    ottoman: ["footstool", "pouf"],
    footstool: ["ottoman", "pouf"],
    pouf: ["ottoman", "footstool"],
    armchair: ["chair"],
    dresser: ["bureau"],
    bureau: ["dresser"],
    nightstand: ["bedside"],
    artwork: ["art"],
    art: ["artwork"],
  };

  const extractHeadTokens = (entry: string): string[] => {
    const separatorMatch = entry.match(/\s[—–-]\s|:\s/);
    const head = separatorMatch
      ? entry.slice(0, separatorMatch.index).toLowerCase()
      : entry.toLowerCase();
    return head
      .replace(/[^a-z\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
  };

  const tokenInHaystack = (token: string, haystack: string): boolean => {
    if (haystack.includes(token)) return true;
    const synonyms = FURNITURE_SYNONYMS[token];
    return synonyms ? synonyms.some((s) => haystack.includes(s)) : false;
  };

  // For what_should_go: detect the rug-style cross-reference hallucination.
  // Pattern: the entry's HEAD NOUN PHRASE (last 1-2 specific tokens) matches
  // a complete what_it_needs category exactly, AND no token is anchored in
  // summary or keep_items. E.g. "Undersized synthetic area rug" → head phrase
  // "area rug" → normalizes to "area_rug" → matches the "area_rug" needs
  // category exactly → and no rug anchor in summary → drop.
  // Narrow on purpose: catches cross-references but trusts Pass A's vision
  // for concrete items like "Bean bag chair" or "Folding TV tray table"
  // whose phrase doesn't equal any needs category.
  const CATEGORY_SYNONYMS: Record<string, string[]> = {
    side_table: ["end_table", "accent_table"],
    end_table: ["side_table", "accent_table"],
    accent_table: ["side_table", "end_table"],
    tv_stand: ["media_console", "tv_console", "entertainment_center"],
    media_console: ["tv_stand", "tv_console", "entertainment_center"],
    tv_console: ["tv_stand", "media_console"],
    entertainment_center: ["tv_stand", "media_console"],
    couch: ["sofa", "sectional"],
    sofa: ["couch", "sectional"],
    sectional: ["sofa", "couch"],
    bookshelf: ["bookcase"],
    bookcase: ["bookshelf"],
    area_rug: ["rug"],
  };
  const matchesNeedsCategory = (phrase: string): boolean => {
    const normalized = phrase.replace(/\s+/g, "_");
    if (needsCategoriesFull.has(normalized) || needsCategoriesFull.has(phrase)) return true;
    const syns = CATEGORY_SYNONYMS[normalized];
    return syns ? syns.some((s) => needsCategoriesFull.has(s)) : false;
  };

  // Words too generic to anchor a what_should_go entry on their own.
  // "table" in summary's "coffee table" shouldn't anchor "plastic side table".
  const WEAK_ANCHORS = new Set([
    "table", "chair", "lamp", "light", "stand", "shelf", "bin", "box",
    "basket", "frame", "set", "piece", "unit",
  ]);
  const photoVerifiedSet = new Set(
    (photoVerifiedEntries || []).map((e) => e.toLowerCase()),
  );
  const isCrossReferenceHallucination = (entry: string): boolean => {
    if (photoVerifiedSet.has(entry.toLowerCase())) return false;
    const tokens = extractHeadTokens(entry);
    if (tokens.length === 0) return false;
    const strongAnchor = tokens.some(
      (t) => !WEAK_ANCHORS.has(t) && tokenInHaystack(t, `${summary} ${keepText}`),
    );
    if (strongAnchor) return false;
    const last2 = tokens.slice(-2).join(" ");
    const last1 = tokens[tokens.length - 1];
    return matchesNeedsCategory(last2) || matchesNeedsCategory(last1);
  };

  // For what_works: keep wider grounding with synonyms. Note we exclude
  // worksText from the haystack to avoid circular self-anchoring (an entry
  // shouldn't anchor itself just because it's in the list).
  const worksHaystack = `${summary} ${keepText} ${shouldGoText}`;
  const isAnchoredForWorks = (entry: string): boolean => {
    const tokens = extractHeadTokens(entry);
    if (tokens.length === 0) return true;
    return tokens.some((t) => tokenInHaystack(t, worksHaystack));
  };

  const result = { ...analysis };

  if (Array.isArray(analysis.what_should_go)) {
    const before = analysis.what_should_go as string[];
    const after = before.filter((e) => typeof e === "string" && !isCrossReferenceHallucination(e));
    if (after.length !== before.length) {
      log.warn("Dropped cross-reference hallucinations from what_should_go", {
        dropped: before.filter((e) => typeof e === "string" && isCrossReferenceHallucination(e)),
      });
    }
    result.what_should_go = after;
  }

  if (Array.isArray(analysis.what_works)) {
    const before = analysis.what_works as string[];
    const after = before.filter((e) => typeof e === "string" && isAnchoredForWorks(e));
    if (after.length !== before.length) {
      log.warn("Dropped unanchored what_works entries", {
        dropped: before.filter((e) => !isAnchoredForWorks(e)),
      });
    }
    result.what_works = after;
  }

  return result;
}

interface AreaAnalysisReviewOutput {
  is_consistent: boolean;
  issues: string[];
  corrected_analysis: Record<string, unknown> | null;
}

async function reviewAreaAnalysisRound(
  analysis: Record<string, unknown>,
  keepItems: string[],
  roomType: string,
  userRequests?: string[],
): Promise<AreaAnalysisReviewOutput | null> {
  const model = selectModel("scoring");

  const requestsBlock = userRequests && userRequests.length > 0
    ? `\nUSER EXPLICITLY REQUESTED THESE ITEMS: ${JSON.stringify(userRequests)}\n⚠️ NEVER remove items from what_it_needs whose category matches a user request. If the user asked for a "dining table", do NOT remove dining_table from what_it_needs — even if it seems spatially challenging or the summary doesn't mention a dining area.\n`
    : "";

  const prompt = `Review this area analysis for a ${roomType} for logical consistency.

KEEP ITEMS (user wants to keep these): ${JSON.stringify(keepItems)}
${requestsBlock}
ANALYSIS OUTPUT:
${JSON.stringify(analysis, null, 2)}

🛑 CRITICAL RULE — KEEP ITEMS ARE LITERAL, NOT IMPLIED:
Keep items name ONLY the objects the user explicitly wants to keep. When a keep item references other furniture as SPATIAL CONTEXT (e.g., "black arc floor lamp behind the sofa", "lamp next to the dresser", "rug under the coffee table"), that mention does NOT mean the user wants to keep the referenced furniture. The keep target is the object BEFORE the spatial preposition (behind / beside / next to / by / under / above / in front of / near / against / facing). In "black arc floor lamp behind the sofa" the user is keeping the LAMP, not the sofa — the sofa is just describing where the lamp is. NEVER infer additional keep intent from spatial mentions, and NEVER remove items from what_should_go because they were spatially referenced in a keep note.

🛑 CRITICAL RULE — THE SUMMARY IS FROZEN GROUND TRUTH FROM PHOTOS:
The "summary" field describes what is ACTUALLY VISIBLE in the user's room photos. It is the ONLY source of truth about what's in the room. You MUST NOT modify the summary — not to add items, not to mention things, not to enrich it. Copy it byte-for-byte into corrected_analysis.summary.

If a what_should_go or what_works entry is not anchored in the summary, the fix is ALWAYS to REMOVE that entry from its list. The fix is NEVER to add the item to the summary so it appears anchored. Adding hallucinated items to the summary to justify them is the EXACT BUG you are here to prevent.

Check for these specific problems:
1. FURNITURE PAIRING: If dining chairs are recommended, is there a dining table (in what_it_needs OR keep items)? If a desk chair is recommended, is there a desk? If nightstands are recommended, is there a bed?
2. CONTRADICTIONS: Are any items in both what_works AND what_should_go? Are any keep items being recommended for removal?
3. SPATIAL FEASIBILITY: Are there too many large items for the room type? (e.g., 3 sofas in a bedroom)
4. STYLE CONSISTENCY: Do all recommended items align with the stated design_direction?
5. COMPLETENESS: For each recommended item, does it have a non-empty category, search_title, and placement?
6. DUPLICATES: Are there duplicate categories in what_it_needs that shouldn't be duplicated?
7. WHAT_SHOULD_GO GROUNDING: ⚠️ CRITICAL — you do NOT see the room photos. Pass A DID see the photos when it produced what_should_go. The summary is only a 3-4 sentence overview, NOT a complete inventory. So an item being absent from the summary is NOT proof of hallucination — Pass A may have seen it and just didn't repeat it in the summary. TRUST Pass A's direct observation. ONLY delete what_should_go entries that match these specific patterns: (a) ABSTRACT CONCEPTS — "loose clutter", "impersonal arrangement", "lack of personality" without a named physical object, (b) CROSS-REFERENCE HALLUCINATION — the entry's category matches a category in what_it_needs AND has no other anchor (e.g. what_it_needs has area_rug and what_should_go has "Undersized synthetic area rug" — Pass A invented a bad rug to justify the purchase). DO NOT delete entries that name specific physical objects with concrete details (e.g. "Bean bag chair", "Folding TV tray", "Plastic storage crates") just because they aren't repeated in the summary.
8. WHAT_WORKS GROUNDING: Each what_works entry must reference a movable object the user owns. Pass A saw the photos. Trust its observations unless an entry is clearly inconsistent with the design direction or names something architectural. NEVER include architectural finishes (flooring, countertops, paint) — those belong in summary.

Return JSON:
{
  "is_consistent": true/false,
  "issues": ["description of each issue found"],
  "corrected_analysis": null if consistent, or the full corrected analysis object if fixes were needed
}

CORRECTION RULES:
- corrected_analysis.summary MUST equal analysis.summary exactly (byte-for-byte). Never edit it.
- The only allowed edits are: REMOVING items from what_should_go / what_works / what_it_needs, fixing pairing issues by adding required pairs, fixing missing fields on what_it_needs entries.
- ONLY fix the specific issues — don't change things that are already correct.`;

  const response = await getProvider("scoring").chat({
    model,
    system: "You are a quality assurance agent for interior design recommendations. Check outputs for logical consistency. Be strict about furniture pairing and spatial feasibility. Return structured JSON.",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 16384,
    seed: DETERMINISTIC_SEED,
    responseMimeType: "application/json",
    thinkingConfig: { thinkingLevel: "low" },
  });

  return extractJsonObject<AreaAnalysisReviewOutput>(response.content);
}

/**
 * LLM-based self-review for room diagnosis output. Checks:
 * - Photo accuracy (observations match what's described)
 * - Palette/material/style coherence within the design direction
 * - Category completeness (enough categories for the room type)
 * - Actionability (vague vs specific recommendations)
 */
export async function selfReviewDiagnosis(
  diagnosis: Record<string, unknown>,
  designDirection: Record<string, unknown>,
  roomType: string,
): Promise<SelfReviewResult<{ diagnosis: Record<string, unknown>; designDirection: Record<string, unknown> }>> {
  let currentDiagnosis = diagnosis;
  let currentDirection = designDirection;
  const allIssues: string[] = [];

  for (let round = 0; round < MAX_CORRECTION_ROUNDS; round++) {
    try {
      const reviewResult = await reviewDiagnosisRound(currentDiagnosis, currentDirection, roomType);
      if (!reviewResult) break;

      if (reviewResult.is_consistent && reviewResult.issues.length === 0) {
        log.info("Diagnosis self-review passed", { round });
        break;
      }

      allIssues.push(...reviewResult.issues);

      if (reviewResult.corrected_diagnosis) {
        log.warn("Diagnosis self-correction applied", {
          round,
          issueCount: reviewResult.issues.length,
          issues: reviewResult.issues,
        });
        currentDiagnosis = reviewResult.corrected_diagnosis;
        if (reviewResult.corrected_design_direction) {
          currentDirection = reviewResult.corrected_design_direction;
        }
      } else {
        break;
      }
    } catch (err) {
      log.debug("Diagnosis self-review round failed — accepting current output", {
        round,
        error: err instanceof Error ? err.message : String(err),
      });
      break;
    }
  }

  return {
    output: { diagnosis: currentDiagnosis, designDirection: currentDirection },
    wasCorrepted: allIssues.length > 0,
    correctionRounds: allIssues.length > 0 ? Math.min(allIssues.length, MAX_CORRECTION_ROUNDS) : 0,
    issues: allIssues,
  };
}

interface DiagnosisReviewOutput {
  is_consistent: boolean;
  issues: string[];
  corrected_diagnosis: Record<string, unknown> | null;
  corrected_design_direction: Record<string, unknown> | null;
}

async function reviewDiagnosisRound(
  diagnosis: Record<string, unknown>,
  designDirection: Record<string, unknown>,
  roomType: string,
): Promise<DiagnosisReviewOutput | null> {
  const model = selectModel("scoring");

  const prompt = `Review this room diagnosis and design direction for a ${roomType} for internal consistency.

DIAGNOSIS:
${JSON.stringify(diagnosis, null, 2)}

DESIGN DIRECTION:
${JSON.stringify(designDirection, null, 2)}

Check for:
1. PALETTE COHERENCE: Do the recommended_palette colors work together? Are there clashing colors?
2. MATERIAL COHERENCE: Do the recommended_materials make sense together? (e.g., ultra-modern lacquer + rustic barnwood is usually wrong)
3. STYLE CONSISTENCY: Does style_notes describe a coherent style? Do palette + materials + textures all align with it?
4. MISSING CATEGORIES: For a ${roomType}, are there enough missing_furniture_categories? (Bedroom needs at minimum: bed, nightstand, dresser, rug. Living room needs: sofa, coffee table, rug, lamp.)
5. WHAT_IS_NOT_WORKING should be specific problems, not platitudes.
6. DESIGN_DIRECTION should be concrete (specific colors, materials, styles) not vague.

Return JSON:
{
  "is_consistent": true/false,
  "issues": ["description of each issue"],
  "corrected_diagnosis": null if consistent, or the corrected diagnosis object,
  "corrected_design_direction": null if consistent, or the corrected design_direction object
}

Only fix actual inconsistencies. Don't change subjective style choices.`;

  const response = await getProvider("scoring").chat({
    model,
    system: "You are a senior interior designer reviewing a room diagnosis for internal consistency. Be strict about palette/material/style coherence. Return structured JSON.",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 16384,
    seed: DETERMINISTIC_SEED,
    responseMimeType: "application/json",
    thinkingConfig: { thinkingLevel: "low" },
  });

  return extractJsonObject<DiagnosisReviewOutput>(response.content);
}

/**
 * LLM-based self-review for product extraction output. Checks if the
 * extracted data makes sense: price in range, dimensions are furniture-scale,
 * materials are real materials, colors are actual colors.
 */
export async function selfReviewExtraction(
  extracted: Record<string, unknown>,
  url: string,
  expectedCategory: string,
): Promise<SelfReviewResult<Record<string, unknown>>> {
  try {
    const model = selectModel("quick_score");

    const response = await getProvider("quick_score").chat({
      model,
      system: "You validate product extraction data. Check for obvious errors. Return JSON.",
      messages: [{
        role: "user",
        content: `Validate this extracted product data from ${url} (expected category: ${expectedCategory}):

${JSON.stringify(extracted, null, 2)}

Check:
1. Is the title a real product name (not an error page or category page)?
2. Is the price reasonable for furniture ($10-$50,000)?
3. Are dimensions furniture-scale (not 1 inch or 100 feet)?
4. Are listed materials real materials (wood, fabric, metal, etc.)?
5. Are listed colors actual colors?
6. Does the category match what was expected?

Return: {"valid": true/false, "issues": ["..."], "corrected": null or corrected object}`,
      }],
      max_tokens: 8192,
      seed: DETERMINISTIC_SEED,
      responseMimeType: "application/json",
      thinkingConfig: { thinkingLevel: "minimal" },
    });

    const result = extractJsonObject<{ valid: boolean; issues: string[]; corrected: Record<string, unknown> | null }>(response.content);
    if (!result) return { output: extracted, wasCorrepted: false, correctionRounds: 0, issues: [] };

    if (result.valid || !result.corrected) {
      return { output: extracted, wasCorrepted: false, correctionRounds: 0, issues: result.issues || [] };
    }

    return {
      output: result.corrected,
      wasCorrepted: true,
      correctionRounds: 1,
      issues: result.issues,
    };
  } catch {
    return { output: extracted, wasCorrepted: false, correctionRounds: 0, issues: [] };
  }
}
