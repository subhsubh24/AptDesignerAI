/**
 * Generic self-correction framework for agentic pipelines.
 *
 * Pattern: generate → validate → correct → validate again.
 * Each agent's output goes through an LLM-based self-review that catches
 * logical inconsistencies, missing items, and contradictions that a single
 * pass would miss. The correction loop is bounded (max 2 rounds) and
 * fails open (returns uncorrected output if the correction itself errors).
 */

import { geminiProvider } from "@/lib/ai/gemini";
import { selectModel } from "@/lib/ai/models";
import { extractJsonObject } from "@/lib/ai/extract-json";
import { DETERMINISTIC_SEED } from "@/lib/ai/determinism";
import { createLogger } from "@/lib/logging/logger";

const log = createLogger("self-correction");

const MAX_CORRECTION_ROUNDS = 2;

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
): Promise<SelfReviewResult<Record<string, unknown>>> {
  let current = analysis;
  const allIssues: string[] = [];
  const originalSummary = (analysis.summary as string | undefined) || "";

  for (let round = 0; round < MAX_CORRECTION_ROUNDS; round++) {
    try {
      const reviewResult = await reviewAreaAnalysisRound(current, keepItems, roomType);
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

  // Final deterministic filter: drop what_should_go / what_works entries
  // that have no anchor in the (frozen) summary or keep_items. Catches any
  // hallucinations that survived the LLM rounds.
  current = filterUnanchoredItems(current, keepItems);

  return {
    output: current,
    wasCorrepted: allIssues.length > 0,
    correctionRounds: allIssues.length > 0 ? Math.min(allIssues.length, MAX_CORRECTION_ROUNDS) : 0,
    issues: allIssues,
  };
}

/**
 * Drop entries in what_should_go and what_works that don't reference any
 * noun anchored in the summary or keep_items. The LLM self-corrector is
 * the primary defense; this is a deterministic backstop.
 *
 * Strategy: extract the head noun from each entry (text before " — " or
 * " - "), tokenize into significant words (3+ chars, not stopwords), and
 * require at least one token to appear in the summary or keep_items.
 */
function filterUnanchoredItems(
  analysis: Record<string, unknown>,
  keepItems: string[],
): Record<string, unknown> {
  const summary = ((analysis.summary as string | undefined) || "").toLowerCase();
  const keepText = keepItems.join(" ").toLowerCase();
  const haystack = `${summary} ${keepText}`;

  const STOPWORDS = new Set([
    "the", "and", "with", "for", "from", "this", "that", "into", "your", "their",
    "modern", "stylish", "cheap", "expensive", "small", "large", "old", "new",
    "wrong", "right", "good", "bad", "generic", "mass", "produced", "mismatched",
    "inconsistent", "outdated", "low", "high", "quality",
  ]);

  const isAnchored = (entry: string): boolean => {
    const head = entry.split(/[—\-:]/)[0].toLowerCase();
    const tokens = head
      .replace(/[^a-z\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
    if (tokens.length === 0) return true;
    return tokens.some((t) => haystack.includes(t));
  };

  const result = { ...analysis };

  if (Array.isArray(analysis.what_should_go)) {
    const before = analysis.what_should_go as string[];
    const after = before.filter((e) => typeof e === "string" && isAnchored(e));
    if (after.length !== before.length) {
      log.warn("Dropped unanchored what_should_go entries", {
        dropped: before.filter((e) => !isAnchored(e)),
      });
    }
    result.what_should_go = after;
  }

  if (Array.isArray(analysis.what_works)) {
    const before = analysis.what_works as string[];
    const after = before.filter((e) => typeof e === "string" && isAnchored(e));
    if (after.length !== before.length) {
      log.warn("Dropped unanchored what_works entries", {
        dropped: before.filter((e) => !isAnchored(e)),
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
): Promise<AreaAnalysisReviewOutput | null> {
  const model = selectModel("scoring");

  const prompt = `Review this area analysis for a ${roomType} for logical consistency.

KEEP ITEMS (user wants to keep these): ${JSON.stringify(keepItems)}

ANALYSIS OUTPUT:
${JSON.stringify(analysis, null, 2)}

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
7. WHAT_SHOULD_GO GROUNDING — STRICT: For each entry in what_should_go, find the EXACT noun phrase (e.g. "TV stand", "dining chairs", "wall art", "rug") in the existing summary. If you cannot find a clear match, that entry is HALLUCINATED — DELETE it from what_should_go. Common hallucinations to watch for: "mass-produced canvas wall art" (no wall art in summary), "mismatched plastic dining chairs" (no dining chairs in summary), "cheap TV stand" (no TV stand in summary), "side tables" (no side tables in summary). The summary is fixed; the items list must shrink to match it.
8. WHAT_WORKS GROUNDING — STRICT: Same rule. Each what_works entry must reference an object the summary or keep_items list explicitly names. If the summary doesn't mention a "vintage rug" or "ceramic vase", DELETE that entry from what_works — do not invent objects to praise. NEVER include architectural finishes (flooring, countertops, paint) — those belong in summary.

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

  const response = await geminiProvider.chat({
    model,
    system: "You are a quality assurance agent for interior design recommendations. Check outputs for logical consistency. Be strict about furniture pairing and spatial feasibility. Return structured JSON.",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 64000,
    seed: DETERMINISTIC_SEED,
    responseMimeType: "application/json",
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

  const response = await geminiProvider.chat({
    model,
    system: "You are a senior interior designer reviewing a room diagnosis for internal consistency. Be strict about palette/material/style coherence. Return structured JSON.",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 64000,
    seed: DETERMINISTIC_SEED,
    responseMimeType: "application/json",
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

    const response = await geminiProvider.chat({
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
      max_tokens: 64000,
      seed: DETERMINISTIC_SEED,
      responseMimeType: "application/json",
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
