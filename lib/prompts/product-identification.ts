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
  /**
   * Room dimensions from the uploaded floor plan (e.g. "12 × 15 ft" or "~180 sqft").
   * Helps calibrate scale: a brand that only makes 90"+ sofas is implausible in a
   * 9×10 bedroom.
   */
  roomDimensions?: string;
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
  if (args.roomDimensions) contextLines.push(`Room dimensions (from floor plan): ${args.roomDimensions}`);
  if (args.aestheticHint) contextLines.push(`Aesthetic direction: ${args.aestheticHint}`);
  if (args.budgetMode) contextLines.push(`Budget tier: ${args.budgetMode}`);
  const contextSection = contextLines.length
    ? `\n## ROOM AESTHETIC CONTEXT (use to calibrate confidence — a brand guess that clashes with this direction, scale, or price bracket should score LOWER, even if the silhouette is a close match)\n${contextLines.map((l) => `- ${l}`).join("\n")}\n`
    : "";

  return `<role>
You are identifying a specific piece of furniture in a room photo by exact brand AND model. The user has given explicit permission for this. Your job is to be harsh, specific, and silent when uncertain. Precision matters more than coverage — a confident wrong answer causes more harm than an empty array.
</role>
${contextSection}
<constraints>
- Return \`"candidates": []\` when nothing reaches ${USER_PROMPT_FLOOR.toFixed(2)} confidence. Empty is the CORRECT answer for generic, custom, vintage, or low-visibility pieces — most rooms fall here. We prefer silence over a hallucinated SKU.
- Out-of-list brands (not in the allow-list below) require confidence ≥ ${MIN_CONFIDENCE_OUT_OF_LIST.toFixed(2)} to emit. In-list brands require ≥ ${MIN_CONFIDENCE_IN_LIST.toFixed(2)}.
- Do NOT let a retrieval hint override your visual judgment — hints may be wrong. If the visual evidence contradicts the hint, trust your eyes.
- A brand guess that clashes with the room context (wrong scale, wrong price bracket, wrong aesthetic) should receive LOWER confidence even if the silhouette matches.
</constraints>

## THE PIECE
- Rough category: ${args.label}
- Bounding box in the photo (normalized, top-left origin): ${boxStr}

## RETRIEVAL HINTS (visual nearest-neighbors from our product catalog)
${priors}

Treat these as "here's what LOOKS similar" — not as ground truth. If none match the actual piece in the photo, return candidates from outside the hint list (or an empty array).

## ALLOW-LIST OF BRANDS (strong preference)
Prefer proposing brands from this list — it reflects the retailers our downstream pipeline knows how to query. You may return a brand outside this list if you are confident (≥ ${MIN_CONFIDENCE_OUT_OF_LIST.toFixed(2)}).

${brandList}

## YOUR TASK
Return 0 to 3 \`candidates\`, ordered by confidence descending. For each:
  - \`brand\`: manufacturer (exact canonical name, e.g. "West Elm", "IKEA", "Herman Miller")
  - \`model\`: product name (e.g. "Haven Sectional", "KIVIK 3-seat + chaise", "Eames Lounge Chair")
  - \`variant\`: size/color variant if obvious, else null (e.g. "dove gray Kelinge polyester")
  - \`category\`: one of sofa | chair | table | bed | storage | lighting | rug | art | other
  - \`confidence\`: 0..1 — be strict (see confidence levels below)
  - \`evidence\`: 1 sentence naming the specific visual cues (arm shape, leg profile, cushion construction, shade geometry, stitching, visible tag) that drove the guess
  - \`distinguishing_features\`: 2-4 short phrases the verifier can ground-check
  - \`bounding_box\`: echo ${boxStr} as { x, y, w, h } in [0,1]

## CONFIDENCE LEVELS
- 0.85-1.0: nearly certain — distinctive silhouette, visible branding, or a perfect retrieval match
- 0.65-0.85: strong visual match but brand is not visually distinctive
- 0.40-0.65: plausible but could be a lookalike from another brand
- Below ${USER_PROMPT_FLOOR.toFixed(2)}: DO NOT emit — drop the candidate

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
  /** Room dimensions from the uploaded floor plan — catches scale mismatches (90" sofa identified for a 9×10 room). */
  roomDimensions?: string;
}

export function buildVerifierPrompt(args: VerifierPromptArgs): string {
  const { candidate, matchThreshold } = args;
  const distinguishers = candidate.distinguishing_features?.length
    ? candidate.distinguishing_features.map((f) => `  - ${f}`).join("\n")
    : "  - (none provided — infer from the room photo)";

  const contextLines: string[] = [];
  if (args.roomType) contextLines.push(`Room type: ${args.roomType}`);
  if (args.roomDimensions) contextLines.push(`Room dimensions (from floor plan): ${args.roomDimensions}`);
  if (args.aestheticHint) contextLines.push(`Aesthetic direction: ${args.aestheticHint}`);
  if (args.budgetMode) contextLines.push(`Budget tier: ${args.budgetMode}`);
  const contextSection = contextLines.length
    ? `\n## ROOM AESTHETIC CONTEXT (sanity check against the tentative identification — flag realism mismatches in mismatch_notes and LOWER match_score when the brand's aesthetic, scale, or price bracket clashes with this context)\n${contextLines.map((l) => `- ${l}`).join("\n")}\n`
    : "";

  return `<role>
You are verifying a tentative product identification against its canonical source. Use Google Search to find the product's official page, then compare it visually to the room photo.
</role>
${contextSection}
<constraints>
- Set \`verified: true\` ONLY when match_score ≥ ${matchThreshold.toFixed(2)}
- Flag realism mismatches in mismatch_notes and LOWER match_score when the brand's aesthetic, scale, or price bracket clashes with the room context above
- If you cannot find the product, return \`verified: false\`, \`match_score: 0\`, empty enrichment fields, and a mismatch_note explaining what you searched for
</constraints>

## TENTATIVE IDENTIFICATION
- Brand: ${candidate.brand}
- Model: ${candidate.model}
- Variant: ${candidate.variant ?? "(none)"}
- Category: ${candidate.category}
- Identifier confidence: ${candidate.confidence.toFixed(2)}
- Evidence cited: ${candidate.evidence || "(none)"}
- Distinguishing features the identifier used:
${distinguishers}

## YOUR TASK
1. Search for "${candidate.brand} ${candidate.model}" (add variant if any). Prefer the brand's own site; fall back to major retailers.
2. Compare the canonical product photo to the room photo using the distinguishing features above plus silhouette, proportions, leg/arm profile, and upholstery structure. Score each:
   - silhouette match (40%)
   - color/fabric match (30%)
   - proportions match (20%)
   - hardware/details match (10%)
3. Produce:
   - \`match_score\`: 0..1 weighted blend
   - \`verified\`: true iff match_score ≥ ${matchThreshold.toFixed(2)}
   - \`mismatch_notes\`: specific deltas (e.g., "legs are black in room photo but brand only ships in walnut")
4. Enrich from the canonical page:
   - \`canonical_url\`: product page URL (brand's site preferred)
   - \`source_urls\`: up to 3 pages you used
   - \`dimensions\`: { width_in, depth_in, height_in } in inches, OR null
   - \`materials\`: array of primary materials (e.g., ["walnut", "linen"])
   - \`colors\`: array of visible/available colorways
   - \`price_range\`: { min, max, currency } — current MSRP range, OR null
   - \`image_url\`: a direct image URL from the canonical page, OR null

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
