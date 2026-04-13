/**
 * Prompt builders for the furniture product identification pipeline.
 *
 * Kept in a dedicated module (rather than inline in the agent) so we can:
 *  - version / A/B the prompt without touching the orchestration code
 *  - share the "retrieval prior" formatter with the search/correct endpoints
 *  - unit-test the prompt shape without importing the Gemini client
 */

import {
  formatBrandsForPrompt,
  MIN_CONFIDENCE_IN_LIST,
  MIN_CONFIDENCE_OUT_OF_LIST,
  USER_PROMPT_FLOOR,
} from "@/lib/constants/identifiable-brands";
import type { BoundingBox, RetrievalPrior } from "@/lib/types/schemas";

/** Render a bounding box as "x=12% y=34% w=50% h=30%" for prompt clarity. */
export function formatBoundingBox(box: BoundingBox): string {
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  return `x=${pct(box.x)} y=${pct(box.y)} w=${pct(box.w)} h=${pct(box.h)}`;
}

/**
 * Render retrieval priors as a numbered list for the identifier prompt. We
 * intentionally include the similarity score so the model can calibrate how
 * much to trust the prior — a 0.92 match is "probably right", 0.6 is "maybe
 * in the right family".
 */
export function formatRetrievalPriors(priors: RetrievalPrior[]): string {
  if (priors.length === 0) {
    return "(no retrieval matches in the catalog index — rely on visual reasoning alone)";
  }
  return priors
    .map(
      (p, i) =>
        `${i + 1}. ${p.brand} — ${p.model} (visual similarity: ${p.similarity.toFixed(2)})`,
    )
    .join("\n");
}

export interface IdentifierPromptArgs {
  label: string;
  box: BoundingBox;
  priors: RetrievalPrior[];
  /** Cap on the allow-list length injected into the prompt. */
  brandLimit?: number;
  /** Room type — helps rule out brand/category mismatches (a "kitchen appliance" brand for a bedroom crop is unlikely). */
  roomType?: string;
  /** Short description of the room's aesthetic direction (palette + materials + style notes) — used to down-weight brand guesses that clash. */
  aestheticHint?: string;
  /** Budget tier (balanced/premium/budget) — down-weights wildly-out-of-bracket brand guesses. */
  budgetMode?: string;
}

/**
 * Build the identifier user prompt. The caller is responsible for attaching
 * the room image alongside this text block in the multimodal message.
 */
export function buildIdentifierPrompt(args: IdentifierPromptArgs): string {
  const brandList = formatBrandsForPrompt(args.brandLimit ?? 200);
  const priors = formatRetrievalPriors(args.priors);
  const boxStr = formatBoundingBox(args.box);

  const contextLines: string[] = [];
  if (args.roomType) contextLines.push(`Room type: ${args.roomType}`);
  if (args.aestheticHint) contextLines.push(`Aesthetic direction: ${args.aestheticHint}`);
  if (args.budgetMode) contextLines.push(`Budget tier: ${args.budgetMode}`);
  const contextSection = contextLines.length
    ? `\n## ROOM AESTHETIC CONTEXT (use to calibrate confidence — a brand guess that clashes with this direction or price bracket should score LOWER, even if the silhouette is a close match)\n${contextLines.map((l) => `- ${l}`).join("\n")}\n`
    : "";

  return `You are identifying a specific piece of FURNITURE in a room photo by
exact brand AND model. The user has given explicit permission for this —
your job is to be harsh, specific, and silent when uncertain.
${contextSection}
## THE PIECE
- Rough category: ${args.label}
- Bounding box in the photo (normalized, top-left origin): ${boxStr}

## RETRIEVAL HINTS (visual nearest-neighbors from our product catalog)
${priors}

These hints may be WRONG. The catalog only covers some brands. Treat them
as "here's what LOOKS similar" — not as ground truth. If none of them match,
say so by returning candidates from outside the hint list (or an empty array).

## ALLOW-LIST OF BRANDS (strong preference)
Prefer proposing brands from this list — it reflects the retailers our
downstream pipeline knows how to query. If you clearly recognize a brand
outside this list, you may still return it, but your confidence must be
at or above ${MIN_CONFIDENCE_OUT_OF_LIST.toFixed(2)} (vs ${MIN_CONFIDENCE_IN_LIST.toFixed(2)} for in-list brands).

${brandList}

## YOUR TASK
Return 0 to 3 \`candidates\`, ordered by confidence descending. For each:
  - \`brand\`: manufacturer (exact canonical name, e.g. "West Elm", "IKEA", "Herman Miller")
  - \`model\`: product name (e.g. "Haven Sectional", "KIVIK 3-seat + chaise",
    "Eames Lounge Chair")
  - \`variant\`: size/color variant if obvious, else null (e.g. "dove gray Kelinge polyester")
  - \`category\`: one of
      sofa | chair | table | bed | storage | lighting | rug | art | other
  - \`confidence\`: 0..1 — be strict, see rules below
  - \`evidence\`: 1 sentence naming the specific visual cues (arm shape, leg
    profile, cushion construction, shade geometry, stitching, visible tag) that
    drove the guess
  - \`distinguishing_features\`: 2-4 short phrases the verifier can grounded-check
  - \`bounding_box\`: echo ${boxStr} as { x, y, w, h } in [0,1]

## CONFIDENCE RULES — BE STRICT
- 0.85-1.0: you are nearly certain — distinctive silhouette, visible branding,
  or a perfect retrieval match.
- 0.65-0.85: strong visual match but brand is not visually distinctive.
- 0.40-0.65: plausible but could be a lookalike from another brand.
- Below ${USER_PROMPT_FLOOR.toFixed(2)}: DO NOT emit — drop the candidate.

If nothing reaches ${USER_PROMPT_FLOOR.toFixed(2)}, return \`"candidates": []\`. Empty is the CORRECT
answer for generic, custom, vintage, or low-visibility pieces — most rooms
fall here. We prefer silence over hallucinating a SKU.

Return ONLY JSON.`;
}

/**
 * Build the verifier user prompt. Accepts a minimal candidate shape so we
 * don't couple the prompt to the full Zod-inferred type used by the agent.
 */
export interface VerifierPromptArgs {
  candidate: {
    brand: string;
    model: string;
    variant?: string | null;
    category: string;
    confidence: number;
    evidence?: string;
    distinguishing_features?: string[];
  };
  /** 0..1 match-score threshold above which the verifier flips `verified=true`. */
  matchThreshold: number;
  /** Room type — cross-check: does this brand/category normally appear in this room type? */
  roomType?: string;
  /** Short description of the room's aesthetic direction — used as a realism check against the brand's aesthetic. */
  aestheticHint?: string;
  /** Budget tier — flags wildly-out-of-bracket identifications (high-end brand in budget-minimalist room). */
  budgetMode?: string;
}

export function buildVerifierPrompt(args: VerifierPromptArgs): string {
  const { candidate, matchThreshold } = args;
  const distinguishers = candidate.distinguishing_features?.length
    ? candidate.distinguishing_features.map((f) => `  - ${f}`).join("\n")
    : "  - (none provided — infer from the room photo)";

  const contextLines: string[] = [];
  if (args.roomType) contextLines.push(`Room type: ${args.roomType}`);
  if (args.aestheticHint) contextLines.push(`Aesthetic direction: ${args.aestheticHint}`);
  if (args.budgetMode) contextLines.push(`Budget tier: ${args.budgetMode}`);
  const contextSection = contextLines.length
    ? `\n## ROOM AESTHETIC CONTEXT (sanity check against the tentative identification — flag realism mismatches in mismatch_notes and LOWER match_score when the brand's aesthetic or price bracket clashes with this context)\n${contextLines.map((l) => `- ${l}`).join("\n")}\n`
    : "";

  return `You are verifying a tentative product identification against its
canonical source. Use Google Search to find the product's official page.
${contextSection}
## TENTATIVE IDENTIFICATION
- Brand: ${candidate.brand}
- Model: ${candidate.model}
- Variant: ${candidate.variant ?? "(none)"}
- Category: ${candidate.category}
- Identifier confidence: ${candidate.confidence.toFixed(2)}
- Evidence cited: ${candidate.evidence || "(none)"}
- Distinguishing features the identifier used:
${distinguishers}

## YOUR JOB
1. Search for "${candidate.brand} ${candidate.model}" (add variant if any).
   Prefer the brand's own site; fall back to major retailers that carry it.
2. Compare the canonical product photo to the room photo. Look at the
   distinguishing features above plus silhouette, proportions, leg/arm
   profile, and upholstery structure. Score:
     - silhouette (40%)
     - color/fabric (30%)
     - proportions (20%)
     - hardware/details (10%)
3. Decide:
   - \`match_score\`: 0..1 weighted blend of the above
   - \`verified\`: true iff match_score >= ${matchThreshold.toFixed(2)}
   - \`mismatch_notes\`: specific deltas you can see (e.g., "legs are black in
     room photo but brand only ships in walnut")
4. Enrich with canonical data from the product page:
   - \`canonical_url\`: the product page URL (brand's site preferred)
   - \`source_urls\`: up to 3 pages you used
   - \`dimensions\`: { width_in, depth_in, height_in } in inches, OR null
   - \`materials\`: array of primary materials (e.g., ["walnut", "linen"])
   - \`colors\`: array of visible/available colorways
   - \`price_range\`: { min, max, currency } — current MSRP range, OR null
   - \`image_url\`: a direct image URL from the canonical page, OR null

If you cannot find the product at all, return \`verified: false\`,
\`match_score: 0\`, empty/nulled enrichment fields, and a mismatch_note
explaining what you searched for.

Return ONLY JSON.`;
}

/**
 * Compact one-liner describing an identified product — used when we inject
 * "existing identified pieces" into downstream agents' prompts.
 */
export function formatIdentifiedProductForPrompt(p: {
  brand: string;
  model: string;
  variant?: string | null;
  category: string;
  dimensions?: { width_in?: number; depth_in?: number; height_in?: number } | null;
  materials?: string[];
  colors?: string[];
  price_range?: { min: number; max: number; currency: string } | null;
}): string {
  const parts: string[] = [`${p.brand} ${p.model}`];
  if (p.variant) parts.push(`(${p.variant})`);
  const specs: string[] = [];
  if (p.dimensions) {
    const d = p.dimensions;
    const dim = [d.width_in && `${d.width_in}"W`, d.depth_in && `${d.depth_in}"D`, d.height_in && `${d.height_in}"H`]
      .filter(Boolean)
      .join(" × ");
    if (dim) specs.push(dim);
  }
  if (p.materials?.length) specs.push(p.materials.slice(0, 3).join("/"));
  if (p.colors?.length) specs.push(p.colors.slice(0, 2).join("/"));
  if (p.price_range) specs.push(`$${p.price_range.min}-$${p.price_range.max}`);
  if (specs.length > 0) parts.push(`— ${specs.join(", ")}`);
  return parts.join(" ");
}

/**
 * Build the "EXISTING IDENTIFIED PIECES" block for injection into the
 * area-analysis Pass A prompt and the downstream search/evaluate prompts.
 * Returns an empty string when there are no confirmed+verified products,
 * which makes the feature byte-for-byte inert for pre-feature rows.
 */
export function buildIdentifiedPiecesBlock(products: Array<{
  brand: string;
  model: string;
  variant?: string | null;
  category: string;
  confidence: number;
  verified: boolean;
  user_confirmed?: boolean | null;
  dimensions?: { width_in?: number; depth_in?: number; height_in?: number } | null;
  materials?: string[];
  colors?: string[];
  price_range?: { min: number; max: number; currency: string } | null;
}>): string {
  // Read filter: verified AND not user-rejected.
  const usable = products.filter((p) => p.verified && p.user_confirmed !== false);
  if (usable.length === 0) return "";

  const lines = usable.map((p) => `- ${formatIdentifiedProductForPrompt(p)}`).join("\n");
  return `═══ EXISTING IDENTIFIED PIECES (canonical specs — treat as exact fact) ═══
${lines}
→ Use these exact dimensions, materials, and colors for clearance, scale, and
  palette decisions. Do NOT recommend replacements for these items unless the
  client has explicitly listed them for removal.
→ When sourcing new items, TREAT THESE AS EXISTING FIXTURES — complementary
  suggestions must match scale to these pieces (e.g. a coffee table sized for a
  KIVIK's 110" length, not a generic "medium sectional").
═══════════════════════════════════════════════════════════════════════════`;
}
