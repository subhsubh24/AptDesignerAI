/**
 * Keep/Replace Reconciler — runs AFTER Pass B's what_it_needs is known.
 *
 * ARCHITECTURAL ROLE:
 * Pass A sees photos and produces what_works (keep) and what_should_go (replace).
 * Pass B does NOT see photos; it produces what_it_needs (shopping list) from
 * Pass A's design brief. The two passes can disagree:
 *
 *   - Cross-reference hallucination: Pass A invents a bad item in
 *     what_should_go to justify a purchase Pass B then makes (e.g. "Undersized
 *     synthetic area rug" alongside what_it_needs.area_rug).
 *
 *   - Vocabulary drift: Pass A says "sectional"; the user said "sofa". A pure
 *     text validator that doesn't know synonyms drops the keep entry.
 *
 *   - Conflict: an item appears in BOTH what_works and what_should_go, or a
 *     user keep_item ends up in what_should_go.
 *
 * The reconciler is a single focused LLM call that has BOTH Pass A's lists AND
 * Pass B's shopping list, plus the user's keep instructions. It can resolve
 * contradictions that no upstream pass could see, because no upstream pass had
 * all three pieces of context at once.
 *
 * It is conservative by default: it returns Pass A's lists unchanged unless it
 * finds a specific, named contradiction. Failures fall open (return original).
 */

import { geminiProvider } from "@/lib/ai/gemini";
import { selectModel } from "@/lib/ai/models";
import { extractJsonObject } from "@/lib/ai/extract-json";
import { DETERMINISTIC_SEED } from "@/lib/ai/determinism";
import { createLogger } from "@/lib/logging/logger";

const log = createLogger("keep-replace-reconciler");

export interface ReconcileResult {
  what_works: string[];
  what_should_go: string[];
  decisions: string[];
  fellBack: boolean;
}

interface ReconcilerInput {
  summary: string;
  what_works: string[];
  what_should_go: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- shape from Pass B
  what_it_needs: Array<Record<string, any>>;
  keep_items: string[];
  room_type: string;
}

interface ReconcilerOutput {
  what_works: string[];
  what_should_go: string[];
  decisions: string[];
}

export async function reconcileKeepReplace(input: ReconcilerInput): Promise<ReconcileResult> {
  const original = {
    what_works: [...input.what_works],
    what_should_go: [...input.what_should_go],
  };

  // Short-circuit if there's nothing to reconcile.
  if (input.what_works.length === 0 && input.what_should_go.length === 0) {
    return { ...original, decisions: [], fellBack: false };
  }

  try {
    const model = selectModel("scoring");
    const needsCategories = input.what_it_needs
      .map((n) => String(n.category || "").trim())
      .filter(Boolean);
    const needsTitles = input.what_it_needs
      .map((n) => String(n.search_title || "").trim())
      .filter(Boolean);

    const prompt = `You are reconciling two lists about a ${input.room_type} that were produced by different agents:

PASS A (saw the photos directly) produced:
  summary: ${JSON.stringify(input.summary)}
  what_works (items the user OWNS that should stay): ${JSON.stringify(input.what_works)}
  what_should_go (items the user OWNS that should be replaced/removed): ${JSON.stringify(input.what_should_go)}

PASS B (did NOT see photos; planned the shopping list from Pass A's brief) produced:
  what_it_needs categories (NEW items to buy): ${JSON.stringify(needsCategories)}
  what_it_needs titles: ${JSON.stringify(needsTitles)}

USER explicitly said to KEEP: ${JSON.stringify(input.keep_items)}

YOUR JOB
========
Pass A saw the photos; you DID NOT. Default to TRUSTING Pass A's observations of
specific physical objects (e.g. "Bean bag chair", "Folding TV tray", "Plastic
storage crates"). Do not delete entries just because the summary doesn't repeat
them — the summary is a 3-4 sentence overview, not an inventory.

Only delete entries when one of these specific contradictions is true:

(A) CROSS-REFERENCE HALLUCINATION
    A what_should_go entry's head noun phrase exactly matches a category in
    what_it_needs AND that entry contains no concrete object detail beyond
    that generic category. Example to delete: what_it_needs has "area_rug" and
    what_should_go has "Undersized synthetic area rug — fails to ground the
    seating area" (no model, brand, or distinctive feature → likely invented
    to justify the purchase). DO NOT delete if the entry has a specific
    concrete detail (a brand, a distinctive material, a unique feature).

(B) USER-KEEP CONFLICT
    A what_should_go entry refers to the SAME physical item the user listed in
    "USER explicitly said to KEEP". Use furniture synonyms (sofa↔sectional↔couch,
    bookshelf↔bookcase, rug↔carpet, lamp↔light, tv↔television, ottoman↔footstool).
    Move the entry from what_should_go into what_works.

(C) DUPLICATE ACROSS LISTS
    The same physical item appears in BOTH what_works AND what_should_go.
    Pick the more accurate one and remove from the other. (Hint: if Pass A
    described the item positively in summary, keep it in what_works.)

(D) ABSTRACT NON-ITEM
    Entries with no concrete physical object name in what_should_go (e.g.
    "loose clutter", "lack of personality", "impersonal arrangement"). Delete.
    Architectural finishes in what_works (flooring, countertops, paint colors,
    cabinetry, baseboards). Delete.

DO NOT
======
- Do not invent or add new entries to either list.
- Do not edit the wording of entries you keep — copy them VERBATIM.
- Do not modify the summary.
- Do not delete an entry just because it isn't in the summary.
- Do not delete what_should_go entries that name a specific object (bean bag,
  tray table, storage bin, polyester pillow) merely because they're vague —
  Pass A saw them.

OUTPUT JSON
===========
{
  "what_works": [<verbatim entries from input that survived>],
  "what_should_go": [<verbatim entries from input that survived; entries moved
    from what_should_go to what_works for rule (B) should appear in what_works,
    not here>],
  "decisions": ["short reason for each deletion or move; empty array if no changes"]
}`;

    const response = await geminiProvider.chat({
      model,
      system:
        "You reconcile two interior-design agent outputs. You are conservative: trust Pass A's photo observations unless a specific contradiction with Pass B's shopping list or the user's keep list is identified. Return strict JSON.",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 8192,
      seed: DETERMINISTIC_SEED,
      responseMimeType: "application/json",
      thinkingConfig: { thinkingLevel: "low" },
    });

    const parsed = extractJsonObject<ReconcilerOutput>(response.content);
    if (!parsed) {
      log.warn("Reconciler returned unparseable JSON — falling back to original");
      return { ...original, decisions: [], fellBack: true };
    }

    const works = sanitizeStringArray(parsed.what_works, original.what_works);
    const removes = sanitizeStringArray(parsed.what_should_go, original.what_should_go);
    const decisions = Array.isArray(parsed.decisions)
      ? parsed.decisions.filter((d): d is string => typeof d === "string")
      : [];

    // Safety guards: the reconciler must only delete or move, never invent.
    // Every output entry must have come from the input lists (verbatim).
    const inputSet = new Set([...original.what_works, ...original.what_should_go]);
    const filteredWorks = works.filter((w) => inputSet.has(w));
    const filteredRemoves = removes.filter((r) => inputSet.has(r));

    // Refuse to delete EVERYTHING (almost always means the LLM misread the prompt).
    if (
      original.what_should_go.length > 0 &&
      filteredRemoves.length === 0 &&
      // and we didn't move them all into works
      filteredWorks.length <= original.what_works.length
    ) {
      log.warn("Reconciler deleted ALL what_should_go entries — falling back", {
        originalCount: original.what_should_go.length,
      });
      return { ...original, decisions: [], fellBack: true };
    }
    if (
      original.what_works.length > 0 &&
      filteredWorks.length === 0 &&
      filteredRemoves.length <= original.what_should_go.length
    ) {
      log.warn("Reconciler deleted ALL what_works entries — falling back", {
        originalCount: original.what_works.length,
      });
      return { ...original, decisions: [], fellBack: true };
    }

    if (decisions.length > 0) {
      log.info("Reconciler applied changes", {
        deletedFromWorks: original.what_works.length - filteredWorks.length,
        deletedFromRemoves: original.what_should_go.length - filteredRemoves.length,
        decisions,
      });
    }

    return {
      what_works: filteredWorks,
      what_should_go: filteredRemoves,
      decisions,
      fellBack: false,
    };
  } catch (err) {
    log.warn("Reconciler threw — falling back to original", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { ...original, decisions: [], fellBack: true };
  }
}

function sanitizeStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}
