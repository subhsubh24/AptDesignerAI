import { geminiProvider } from "@/lib/ai/gemini";
import { selectModel } from "@/lib/ai/models";
import { getSystemPrompt } from "@/lib/prompts/system";
import { HarmonyValidationResponseSchema, ProductSetValidationResponseSchema, FinalAssessmentResponseSchema } from "@/lib/types/schemas";
import { withRetry, isRetryableError } from "@/lib/ai/retry";
import { extractJsonObject } from "@/lib/ai/extract-json";
import { createLogger } from "@/lib/logging/logger";
import { parseUserContext, formatParsedContextForPrompt } from "@/lib/utils/parse-user-context";
import type { AIContentBlock } from "@/lib/ai/provider";
import type { AgentResult } from "./types";
import type { DynamicDesignProfile } from "@/lib/design-context/user-profile";
import { computeSetMathScores, formatSetMathForPrompt } from "@/lib/validation/set-math";
import { computeFinalHarmonyScore, type MathDimensionCaps, type HarmonySubScores as CompositeSubScores, type PairwiseConflict as CompositePairwiseConflict } from "@/lib/scoring/harmony-composite";

const log = createLogger("validation-agent");

export interface ValidationResult {
  isValid: boolean;
  confidence: number;
  issues: string[];
  suggestions: string[];
  revisedAnalysis?: Record<string, unknown>;
  /** Per-product harmony scores — returned by validateProductSet */
  product_flags?: Array<{
    title: string;
    category: string;
    harmony_score: number;
    sub_scores?: HarmonySubScores;
    clashes_with: string[];
    reason: string;
  }>;
  /** Pairwise conflicts between products (pairs with compatibility < 9.0) */
  pairwise_conflicts?: PairwiseConflict[];
}

export interface HarmonySubScores {
  color_fit: number;
  spatial_fit: number;
  material_fit: number;
  style_coherence: number;
  cross_room_fit: number;
  functional_fit: number;
}

export interface PairwiseConflict {
  item_a: string;
  item_b: string;
  compatibility: number;
  conflict_type: string;
  reason: string;
}

export interface HarmonyValidationResult {
  confidence: number;
  item_scores: Array<{
    category: string;
    harmony_score: number;
    sub_scores: HarmonySubScores;
    keeps_well_with: string[];
    clashes_with: string[];
    revised_search_title?: string;
    revised_specs?: string;
    revised_placement?: string;
    drop: boolean;
    root_cause?: string;
    reason: string;
    /** Chain-of-thought rationale: step-by-step reasoning that led to this score */
    rationale?: string;
  }>;
  pairwise_conflicts: PairwiseConflict[];
  overall_cohesion: number;
  palette_coherence: string;
  material_coherence: string;
  spatial_flow: string;
  issues: string[];
  revisedAnalysis?: Record<string, unknown>;
}

/**
 * Harmony validation: checks that every recommended item fits with the room's
 * existing items (what_works), the apartment aesthetic, and each other.
 * Sees the actual room photos so it can judge visually, not just from text.
 * Uses Flash with high thinking for deep design reasoning.
 */
export async function validateRoomHarmony(
  analysis: Record<string, unknown>,
  context: {
    roomType: string;
    roomName: string;
    roomImageUrls: string[];
    buildingResearch?: Record<string, unknown>;
    apartmentAnalysis?: Record<string, unknown>;
    designProfile?: DynamicDesignProfile;
    floorPlan?: Record<string, unknown>;
    userContext?: string;
    otherRooms?: Array<{ name: string; roomType: string; palette?: string[]; materials?: string[]; designDirection?: string; keyItems?: string[] }>;
    mathScoresText?: string;
  }
): Promise<AgentResult<HarmonyValidationResult>> {
  const model = selectModel("validation");
  const system = getSystemPrompt(context.designProfile);

  const whatWorks = (analysis.what_works as string[]) || [];
  const whatShouldGo = (analysis.what_should_go as string[]) || [];
  const whatItNeeds = (analysis.what_it_needs as Array<Record<string, unknown>>) || [];
  const designDirection = (analysis.design_direction as string) || "";
  const spatialLayout = (analysis.spatial_layout as string) || "";

  // Build the content with room images for visual validation
  const content: AIContentBlock[] = [];

  // Send room photos so the model can SEE what's already there
  for (const url of context.roomImageUrls.slice(0, 4)) {
    content.push({ type: "image", source: { type: "url", url } });
  }

  const buildingCtx = context.buildingResearch
    ? `\nBuilding: ${JSON.stringify({
        style: (context.buildingResearch as Record<string, unknown>).building_style,
        finishes: (context.buildingResearch as Record<string, unknown>).finishes,
        aesthetic: (context.buildingResearch as Record<string, unknown>).design_aesthetic,
      })}`
    : "";

  const aa = context.apartmentAnalysis as Record<string, unknown> | undefined;
  const apartmentCtx = aa
    ? `\nApartment overview: ${aa.overall || ""}${aa.rooms ? `\nPer-room summaries: ${JSON.stringify(aa.rooms)}` : ""}`
    : "";

  // Cross-room context: what's in the OTHER rooms so we ensure apartment-wide coherence
  const otherRoomsCtx = context.otherRooms?.length
    ? `\n\n## OTHER ROOMS IN THE APARTMENT (for cross-room coherence)
${context.otherRooms.map((r) => {
  const parts = [`- **${r.name}** (${r.roomType})`];
  if (r.designDirection) parts.push(`  Direction: ${r.designDirection}`);
  if (r.palette?.length) parts.push(`  Palette: ${r.palette.join(", ")}`);
  if (r.materials?.length) parts.push(`  Materials: ${r.materials.join(", ")}`);
  if (r.keyItems?.length) parts.push(`  Key items: ${r.keyItems.join("; ")}`);
  return parts.join("\n");
}).join("\n")}
Items in THIS room must harmonize with the palette, materials, and style of the other rooms. The apartment should feel like one cohesive home, not a collection of unrelated rooms.`
    : "";

  // Floor plan context for spatial validation
  const floorPlanCtx = context.floorPlan
    ? `\n\n## FLOOR PLAN / ROOM DIMENSIONS
Total sqft: ${context.floorPlan.total_sqft || "unknown"}
Room dimensions: ${JSON.stringify(context.floorPlan.room_dimensions || {})}
Room layout: ${context.floorPlan.room_layout || "unknown"}
Living/dining combined: ${context.floorPlan.living_dining_combined ?? "unknown"}
Spatial features: ${Array.isArray(context.floorPlan.notable_spatial_features) ? context.floorPlan.notable_spatial_features.join(", ") : "unknown"}`
    : "";

  content.push({
    type: "text",
    text: `You are a senior interior designer doing a HARMONY + SPATIAL CHECK on recommended items before they go to product search.

IMPORTANT: Think step-by-step through each item. For each recommended item, evaluate it against EVERY existing item and EVERY other recommendation.

## ROOM
${context.roomName} (${context.roomType})${buildingCtx}${apartmentCtx}${floorPlanCtx}${otherRoomsCtx}${(() => {
  const parts: string[] = [];
  if (context.userContext) {
    // Parse user context into structured constraints for the harmony validator
    const parsed = parseUserContext(context.userContext);
    const structuredBlock = formatParsedContextForPrompt(parsed);
    parts.push(`\n\n## USER NOTES\n"${context.userContext}"\nRespect these notes when validating — e.g. if the user says to ignore something, don't flag it. If they mention lifestyle needs (pets, kids, entertaining), factor those into material/durability checks.`);
    if (structuredBlock) {
      parts.push(`\n\n${structuredBlock}`);
    }
    parts.push(`\n\n⚠️ CRITICAL: If the user says they DON'T NEED something (e.g., "don't need curtains", "have blinds"), any recommendation in that category MUST be flagged with drop=true and harmony_score=0. If the user says to KEEP an item (e.g., "keep the black arc floor lamp"), any recommendation that replaces it MUST be flagged with drop=true and harmony_score=0. When revising items, NEVER revise a search_title or specs to include excluded categories.`);
  }
  return parts.join("");
})()}

## DESIGN DIRECTION
${designDirection}

## SPATIAL LAYOUT PLAN
${spatialLayout || "Not specified — you should infer from the room photos"}

## ITEMS TO KEEP (already in the room — note their CURRENT POSITIONS in the photos)
${whatWorks.length > 0 ? whatWorks.map((item, i) => `${i + 1}. ${item}`).join("\n") : "None specified"}

## ITEMS BEING REMOVED
${whatShouldGo.length > 0 ? whatShouldGo.map((item, i) => `${i + 1}. ${item}`).join("\n") : "None"}

## RECOMMENDED NEW ITEMS (to validate)
${whatItNeeds.map((item, i) => `${i + 1}. [${item.category}] ${item.search_title}
   Specs: ${item.specs}
   Placement: ${item.placement || "not specified"}
   Priority: ${item.priority}
   Why: ${item.description}`).join("\n\n")}

${context.mathScoresText ? `\n${context.mathScoresText}\n` : ""}
## YOUR JOB — STEP BY STEP
Step 1: Look at the room photos carefully. Note: floor material+color, wall color, ceiling height, window positions, door positions, existing furniture and their positions.
Step 2: Estimate the room's dimensions from photos (or use floor plan if provided).
Step 3: For EACH recommended item below, work through the harmony and spatial checks:

Evaluate EACH recommended item on BOTH harmony AND spatial fit:

### HARMONY CHECKS
1. **Harmony with keeps**: Does this item's material, color, and style work with the existing items staying in the room? A walnut coffee table next to existing oak furniture = clash. A brass lamp with existing chrome fixtures = clash.

2. **Harmony with other recommendations**: Do ALL the new items work together as a set? If you're recommending a warm cream rug AND cool gray throw pillows, that's a palette conflict. Check EVERY pair of recommendations against each other.

3. **Apartment-wide coherence**: Does this fit with the OTHER rooms in the apartment? Check against the other rooms' palettes, materials, and key items listed above. The entire apartment must feel like one cohesive home. If the bedroom uses warm walnut and brass, the living room shouldn't introduce cool chrome and ash wood.

4. **Specificity check**: Is the search_title specific enough to find the RIGHT product? Does it include material, color, size, and style?

5. **Root cause identification**: If ANY item scores below 10, you MUST identify the SPECIFIC root cause — is it a color clash (name the two clashing colors)? A material mismatch (name which materials conflict)? A spatial issue (name the exact clearance or dimension problem)? An arrangement issue (name which items are positioned wrong relative to each other)? Then your revised_search_title/specs/placement must fix THAT specific root cause.

### SPATIAL CHECKS — CRITICAL
5. **Placement validity**: Does the recommended placement make physical sense? Is there actually wall space, floor space, or clearance for this item where it's supposed to go? Look at the photos — if a floor lamp is supposed to go "next to the sofa" but there's no space between the sofa and the wall, that's a problem.

6. **Scale/proportion**: Based on room photos (and floor plan dimensions if available), will this item be the right size? An 8x10 rug in a 9x10 room leaves no border. A 60-inch console on a 48-inch wall won't fit.

7. **Traffic flow**: Does the placement of all items together create clear walkways? Can people move through the room naturally? Standard clearances: 36" main paths, 18" between coffee table and sofa, 24" behind dining chairs, 30" next to beds.

8. **Spatial relationships**: Do items that belong together actually end up near each other? The floor lamp should be near the reading chair. Side tables should flank the sofa. The rug should anchor the seating area, not float randomly.

9. **Orientation & sightlines**: Are items oriented to create natural conversation areas? Do they face logical focal points (TV, fireplace, window view)? Is there a clear visual anchor point when you enter the room?

10. **Zone definition**: In multi-function rooms, do the items clearly define distinct zones (living vs dining, work vs relaxation) without blocking flow between them?

### ENVIRONMENTAL CHECKS
11. **Lighting adequacy**: Look at the room photos — which direction do windows face? How much natural light is there? Do the recommended items include sufficient lighting for dark areas? If the room is north-facing with limited light, it needs MORE light sources. Are any glossy/reflective items placed where they'd create glare from windows?

12. **Window & door clearance**: From the photos, identify all windows and doors. Do any recommended items block windows (reducing natural light)? Do any obstruct door swings or crowd doorways? A tall bookshelf in front of a window or a console table blocking a closet door = must revise placement or drop.

13. **Acoustic balance**: Look at the room's surfaces — hardwood floors, concrete walls, large windows. Is there enough soft material in the recommendation set (rug, curtains, upholstered furniture, throw pillows) to create acoustic comfort? An open floor plan with all hard surfaces needs textile elements. If the set lacks soft materials, flag it.

14. **Durability & maintenance**: Consider the client's lifestyle (pets, kids, hosting, daily use). Are the recommended materials practical? White boucle with pets, glass with toddlers, delicate silk in high-traffic areas = flag as impractical.

15. **Outlet access for powered items**: If recommending lamps, media consoles, or other powered items — is there likely an outlet near the intended placement? A floor lamp in the center of the room with no nearby wall = impractical placement.

## SCORING — 6-DIMENSIONAL SUB-SCORES (per item) — AIM FOR 9.5+/10 ON EVERY DIMENSION

For EACH item, score these 6 dimensions separately (ALL USE DECIMALS e.g. 7.3, 8.8, 9.6):

### sub_scores object:
1. **color_fit** (0-10): Color/palette harmony with keeps, other recommendations, and design palette.
   - 9.5+: Colors perfectly complement keeps and other items; palette forms a coherent scheme
   - 7-9: Good color story but minor undertone mismatch or shade that could be more precise
   - 4-6: Noticeable color conflict or palette gap
   - 1-3: Active color clash with keeps or other items

2. **spatial_fit** (0-10): Physical fit, clearances, traffic flow, placement validity.
   - 9.5+: Perfect dimensions for the space, ideal clearances, natural traffic flow
   - 7-9: Fits but slightly tight clearances or could be positioned better
   - 4-6: Tight fit, questionable clearances, blocks some flow
   - 1-3: Doesn't physically fit or creates major traffic/access problems

3. **material_fit** (0-10): Material compatibility, wood species coherence, metal finish coherence, soft-hard balance.
   - 9.5+: Materials tell a cohesive texture story; wood species ≤2, metal finishes compatible
   - 7-9: Mostly compatible but one material slightly off (e.g. 3rd wood species)
   - 4-6: Material conflict (mixed warm/cool metals, too many wood species)
   - 1-3: Fundamentally incompatible materials

4. **style_coherence** (0-10): Alignment with design direction, style family, visual weight balance.
   - 9.5+: Perfect style match; visually harmonious with the room's design language
   - 7-9: Correct style family but slightly different era or formality level
   - 4-6: Adjacent style that doesn't quite fit (transitional in a mid-century room)
   - 1-3: Wrong style family entirely

5. **cross_room_fit** (0-10): Apartment-wide palette/material/style coherence with other rooms.
   - 9.5+: Flows naturally with other rooms' palettes, materials, and style
   - 7-9: Compatible but could echo other rooms' materials/colors more
   - 4-6: Noticeable disconnect from other rooms' aesthetic
   - 1-3: Actively clashes with other rooms' established materials/palette

6. **functional_fit** (0-10): Practical use, durability, lifestyle match, acoustic/lighting coverage.
   - 9.5+: Perfect for the client's lifestyle; durable, practical, serves its function ideally
   - 7-9: Mostly practical but minor durability/maintenance concern
   - 4-6: Questionable for daily use (delicate fabric with pets, no outlet for lamp)
   - 1-3: Fundamentally impractical for the use case

### Also provide per item:
- **harmony_score**: Your best overall assessment (0-10, decimal). Compute as: min(sub_scores) × 0.4 + mean(sub_scores) × 0.6 — one bad dimension tanks the score. The server will also compute one from sub_scores — the lower of the two is used.
- **drop**: true if harmony_score ≤ 3
- For ANY item where ANY sub_score < 9.5, you MUST provide **revised_search_title**, **revised_specs**, AND **revised_placement** that would bring ALL sub_scores to 9.5+.

### COMPOUNDING: Multiple bad dimensions are CATASTROPHIC
If color_fit=9, spatial_fit=9, material_fit=3 → the overall score will be ~5-6, not ~7. One bad dimension tanks the whole item. This means you CANNOT compensate for a material clash by having good color. Fix the root cause.

- **rationale** (REQUIRED for EVERY item): Your chain of reasoning. Walk through ALL 6 dimensions step by step:
  1. COLOR: What does the math color score say? What do you see in photos? Score = [X.X]
  2. SPATIAL: What does the math spatial score say? Will it physically fit? Score = [X.X]
  3. MATERIAL: What does the math material score say? Wood/metal coherence? Score = [X.X]
  4. STYLE: Does the style match the design direction? Score = [X.X]
  5. CROSS-ROOM: How does it fit with other rooms? Score = [X.X]
  6. FUNCTIONAL: Is it practical for daily life? Score = [X.X]
  7. OVERALL: Why is the overall harmony_score [X.X]?

## PAIRWISE COMPATIBILITY CHECK — CRITICAL
After scoring each item individually, check EVERY PAIR of items (both recommendations AND keeps) for compatibility. Report pairs with compatibility < 9.0:
- **A walnut coffee table + oak side table** = wood species clash → compatibility 4.5
- **Chrome floor lamp + brass pendant** = metal finish clash → compatibility 5.0
- **Warm ivory sofa + cool gray pillows** = undertone conflict → compatibility 6.0

Only report pairs with problems. Omitted pairs are assumed 9.5+ (no conflict).

## MATH SCORES — GROUND TRUTH FOUNDATION
The math scores above are DETERMINISTIC pre-computed facts. They anchor your scoring:
- Math color score → directly informs your **color_fit** sub-score
- Math spatial score → directly informs your **spatial_fit** sub-score
- Math material score → directly informs your **material_fit** sub-score
- Math cross-room score → directly informs your **cross_room_fit** sub-score
- If math says a dimension is bad, your sub-score for that dimension MUST reflect it.
- style_coherence and functional_fit are AI-only — use your design judgment.

## OUTPUT FORMAT
Return JSON:
{
  "confidence": 0-10 (use decimals e.g. 8.3),
  "item_scores": [
    {
      "category": "the category slug",
      "harmony_score": number (USE DECIMALS e.g. 8.4, 9.6),
      "sub_scores": {
        "color_fit": number,
        "spatial_fit": number,
        "material_fit": number,
        "style_coherence": number,
        "cross_room_fit": number,
        "functional_fit": number
      },
      "keeps_well_with": ["items it pairs well with"],
      "clashes_with": ["items it conflicts with — include spatial and environmental conflicts"],
      "revised_search_title": "if any sub_score < 9.5, the improved search title",
      "revised_specs": "if any sub_score < 9.5, the improved specs",
      "revised_placement": "if any sub_score < 9.5, the improved placement",
      "drop": true/false,
      "root_cause": "if any sub_score < 9.5, the SPECIFIC root cause with the failing dimension: 'color_fit: warm cream conflicts with cool gray pillows', 'material_fit: oak legs clash with walnut — 3 wood species', 'spatial_fit: 48-inch table too wide for 52-inch wall'",
      "reason": "1-2 sentence explanation",
      "rationale": "REQUIRED 7-step chain-of-thought covering all 6 dimensions + overall"
    }
  ],
  "pairwise_conflicts": [
    {
      "item_a": "category_slug_of_item_a",
      "item_b": "category_slug_of_item_b",
      "compatibility": number (0-10, decimal),
      "conflict_type": "wood_species_clash | metal_finish_clash | color_clash | style_mismatch | scale_conflict | material_texture_clash",
      "reason": "specific explanation of why these two items conflict"
    }
  ],
  "overall_cohesion": 0-10 (use decimals),
  "palette_coherence": "1 sentence: color palette assessment",
  "material_coherence": "1 sentence: material/texture story assessment",
  "spatial_flow": "2-3 sentences: traffic flow, zones, spatial relationships",
  "issues": ["cross-cutting problems"],
  "revisedAnalysis": null or { revised analysis if confidence < 7 }
}

YOUR GOAL IS 9.5+/10 ON EVERY SUB-DIMENSION OF EVERY ITEM. Be extremely precise — one bad dimension tanks the whole item due to compounding. Use the math scores as your foundation for the 4 math-anchored dimensions.`,
  });

  // Scale max_tokens based on item count: each item needs ~2.5K tokens for
  // 6D scoring + rationale + revisions + thinking overhead
  const itemCount = ((analysis.what_it_needs as unknown[]) || []).length;
  const baseMaxTokens = Math.min(16000 + itemCount * 2500, 65000);

  let lastError: string | undefined;
  let attempt = 0;
  let wasTruncated = false;

  try {
    return await withRetry(
      async () => {
        attempt++;

        // On truncation retries: increase token budget + reduce thinking overhead
        const maxTokens = wasTruncated
          ? Math.min(baseMaxTokens + 16000, 65000)
          : baseMaxTokens;
        const thinkingLevel = wasTruncated ? "medium" as const : (attempt === 1 ? "high" as const : "medium" as const);

        const retryContent = attempt > 1 && lastError
          ? [...content, { type: "text" as const, text: wasTruncated
              ? `\n\n**IMPORTANT**: Your previous response was truncated due to length. Be MORE CONCISE: keep rationales to 1-2 sentences max, omit revised fields for items scoring above 9.0. Return ONLY valid JSON matching the exact schema above.`
              : `\n\n**IMPORTANT**: Your previous response was invalid: "${lastError}". Return ONLY valid JSON matching the exact schema above. Ensure confidence and overall_cohesion are numbers 0-10, and item_scores is a non-empty array.` }]
          : content;

        const response = await geminiProvider.chat({
          model,
          system,
          messages: [{ role: "user", content: retryContent }],
          max_tokens: maxTokens,
          temperature: attempt === 1 ? 0.2 : 0.3,
          thinkingConfig: { thinkingLevel },
          responseMimeType: "application/json",
        });

        if (response.truncated) {
          wasTruncated = true;
          throw new Error("Response truncated (MAX_TOKENS)");
        }

        const raw = extractJsonObject(response.content);
        const unwrapped = Array.isArray(raw) ? raw[0] : raw;
        const parsed = HarmonyValidationResponseSchema.parse(unwrapped);
        const result: HarmonyValidationResult = {
          ...parsed,
          revisedAnalysis: parsed.revisedAnalysis ?? undefined,
          pairwise_conflicts: (parsed.pairwise_conflicts || []).map((c) => ({
            ...c,
            conflict_type: c.conflict_type || "",
            reason: c.reason || "",
          })),
          item_scores: parsed.item_scores.map((s) => ({
            ...s,
            sub_scores: s.sub_scores,
            revised_search_title: s.revised_search_title ?? undefined,
            revised_specs: s.revised_specs ?? undefined,
            revised_placement: s.revised_placement ?? undefined,
            root_cause: s.root_cause ?? undefined,
            rationale: s.rationale ?? undefined,
          })),
        };

        log.info("Harmony validation complete", {
          phase: "harmony",
          confidence: result.confidence,
          cohesion: result.overall_cohesion,
          items: result.item_scores.length,
          pairwise_conflicts: result.pairwise_conflicts.length,
          scores: result.item_scores.map((s) => {
            const ss = s.sub_scores;
            return `${s.category}=${s.harmony_score}(c${ss.color_fit}/sp${ss.spatial_fit}/m${ss.material_fit}/st${ss.style_coherence}/cr${ss.cross_room_fit}/f${ss.functional_fit})`;
          }).join(", "),
        });

        return {
          success: true as const,
          data: result,
          tokensUsed: response.usage.input_tokens + response.usage.output_tokens + response.usage.thinking_tokens,
          model: response.model,
        };
      },
      {
        maxAttempts: 3,
        baseDelayMs: 1500,
        maxDelayMs: 15000,
        isRetryable: (error) => {
          if (isRetryableError(error)) return true;
          if (error instanceof SyntaxError) return true;
          if (error instanceof Error && error.name === "ZodError") return true;
          if (error instanceof Error && error.message.includes("truncated")) return true;
          return false;
        },
        onRetry: (retryAttempt, delayMs, error) => {
          lastError = error instanceof Error ? error.message : "Harmony validation failed";
          log.warn(`Harmony validation retry ${retryAttempt}`, { durationMs: delayMs, error: lastError });
        },
      }
    );
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Harmony validation failed after retries";
    log.error("Harmony validation failed", { error: errMsg });
    return { success: false, error: errMsg };
  }
}

export interface FinalAssessmentResult {
  confidence: number;
  overall_cohesion: number;
  palette_coherence: string;
  material_coherence: string;
  spatial_flow: string;
  issues: string[];
  item_scores: Array<{
    category: string;
    final_score: number;
    sub_scores?: HarmonySubScores;
    needs_more_work: boolean;
    revised_search_title?: string;
    revised_specs?: string;
    revised_placement?: string;
    root_cause?: string;
    reason: string;
    /** Chain-of-thought rationale: step-by-step reasoning that led to this score */
    rationale?: string;
  }>;
  pairwise_conflicts: PairwiseConflict[];
  needs_more_rounds: boolean;
  round_budget: number;
}

/**
 * Final comprehensive assessment: one deep AI pass after iterative rounds stabilize.
 * Sees the full revision history, all math scores, room photos, and all context.
 * Produces definitive scores and decides if more iteration is needed.
 */
export async function performFinalAssessment(
  analysis: Record<string, unknown>,
  context: {
    roomType: string;
    roomName: string;
    roomImageUrls: string[];
    buildingResearch?: Record<string, unknown>;
    apartmentAnalysis?: Record<string, unknown>;
    designProfile?: DynamicDesignProfile;
    floorPlan?: Record<string, unknown>;
    userContext?: string;
    otherRooms?: Array<{ name: string; roomType: string; palette?: string[]; materials?: string[]; designDirection?: string; keyItems?: string[] }>;
    mathScoresText?: string;
    revisionHistory?: Record<string, Array<{ round: number; score: number; specs?: string; searchTitle?: string; rootCause?: string }>>;
    stabilizedItems?: string[];
    roundsCompleted: number;
  }
): Promise<AgentResult<FinalAssessmentResult>> {
  const model = selectModel("validation");
  const system = getSystemPrompt(context.designProfile);

  const whatWorks = (analysis.what_works as string[]) || [];
  const whatShouldGo = (analysis.what_should_go as string[]) || [];
  const whatItNeeds = (analysis.what_it_needs as Array<Record<string, unknown>>) || [];
  const designDirection = (analysis.design_direction as string) || "";
  const spatialLayout = (analysis.spatial_layout as string) || "";

  const content: AIContentBlock[] = [];

  // Send room photos
  for (const url of context.roomImageUrls.slice(0, 4)) {
    content.push({ type: "image", source: { type: "url", url } });
  }

  const buildingCtx = context.buildingResearch
    ? `\nBuilding: ${JSON.stringify({
        style: (context.buildingResearch as Record<string, unknown>).building_style,
        finishes: (context.buildingResearch as Record<string, unknown>).finishes,
        aesthetic: (context.buildingResearch as Record<string, unknown>).design_aesthetic,
      })}`
    : "";

  const aa = context.apartmentAnalysis as Record<string, unknown> | undefined;
  const apartmentCtx = aa
    ? `\nApartment overview: ${aa.overall || ""}${aa.rooms ? `\nPer-room summaries: ${JSON.stringify(aa.rooms)}` : ""}`
    : "";

  const otherRoomsCtx = context.otherRooms?.length
    ? `\n\n## OTHER ROOMS IN THE APARTMENT
${context.otherRooms.map((r) => {
  const parts = [`- **${r.name}** (${r.roomType})`];
  if (r.designDirection) parts.push(`  Direction: ${r.designDirection}`);
  if (r.palette?.length) parts.push(`  Palette: ${r.palette.join(", ")}`);
  if (r.materials?.length) parts.push(`  Materials: ${r.materials.join(", ")}`);
  if (r.keyItems?.length) parts.push(`  Key items: ${r.keyItems.join("; ")}`);
  return parts.join("\n");
}).join("\n")}`
    : "";

  const floorPlanCtx = context.floorPlan
    ? `\n\n## FLOOR PLAN / ROOM DIMENSIONS
Total sqft: ${context.floorPlan.total_sqft || "unknown"}
Room dimensions: ${JSON.stringify(context.floorPlan.room_dimensions || {})}
Room layout: ${context.floorPlan.room_layout || "unknown"}
Living/dining combined: ${context.floorPlan.living_dining_combined ?? "unknown"}
Spatial features: ${Array.isArray(context.floorPlan.notable_spatial_features) ? context.floorPlan.notable_spatial_features.join(", ") : "unknown"}`
    : "";

  // Build revision history summary
  let revisionHistoryText = "";
  if (context.revisionHistory && Object.keys(context.revisionHistory).length > 0) {
    revisionHistoryText = `\n\n## REVISION HISTORY (what the iterative rounds tried)
This analysis went through ${context.roundsCompleted} iterative rounds. Here's what changed:\n`;
    for (const [category, history] of Object.entries(context.revisionHistory)) {
      revisionHistoryText += `\n### ${category}\n`;
      for (const entry of history) {
        revisionHistoryText += `- Round ${entry.round}: score=${entry.score}/10`;
        if (entry.rootCause) revisionHistoryText += ` | issue: ${entry.rootCause}`;
        if (entry.searchTitle) revisionHistoryText += ` | title: "${entry.searchTitle}"`;
        if (entry.specs) revisionHistoryText += ` | specs: "${entry.specs}"`;
        revisionHistoryText += "\n";
      }
    }
    if (context.stabilizedItems?.length) {
      revisionHistoryText += `\nItems that stabilized early (locked in): ${context.stabilizedItems.join(", ")}`;
    }
    revisionHistoryText += `\n\n⚠️ IMPORTANT: Some items oscillated (flip-flopped between options across rounds). If you see that pattern in the history above, pick the BEST version from the history — don't propose yet another alternative. The iterative rounds already explored the design space.`;
  }

  content.push({
    type: "text",
    text: `You are a LEAD INTERIOR DESIGNER doing the FINAL QUALITY REVIEW of a room design recommendation.

This recommendation has already been through ${context.roundsCompleted} rounds of iterative harmony checking. Your job is to do ONE comprehensive, definitive assessment — not to nitpick endlessly.

## ROOM
${context.roomName} (${context.roomType})${buildingCtx}${apartmentCtx}${floorPlanCtx}${otherRoomsCtx}${context.userContext ? `\n\n## USER NOTES\n"${context.userContext}"` : ""}

## DESIGN DIRECTION
${designDirection}

## SPATIAL LAYOUT
${spatialLayout || "Not specified"}

## ITEMS TO KEEP
${whatWorks.length > 0 ? whatWorks.map((item, i) => `${i + 1}. ${item}`).join("\n") : "None specified"}

## ITEMS BEING REMOVED
${whatShouldGo.length > 0 ? whatShouldGo.map((item, i) => `${i + 1}. ${item}`).join("\n") : "None"}

## CURRENT RECOMMENDED ITEMS (after ${context.roundsCompleted} rounds of refinement)
${whatItNeeds.map((item, i) => `${i + 1}. [${item.category}] ${item.search_title}
   Specs: ${item.specs}
   Placement: ${item.placement || "not specified"}
   Priority: ${item.priority}
   Why: ${item.description}`).join("\n\n")}

${context.mathScoresText || ""}
${revisionHistoryText}

## YOUR JOB — FINAL COMPREHENSIVE ASSESSMENT

Step 1: Look at the room photos. Understand the actual space, finishes, lighting, dimensions.
Step 2: Evaluate the FULL SET of recommended items as a cohesive whole — palette coherence, material story, spatial flow, zone definition.
Step 3: For each item, give a DEFINITIVE score. This is the final word — be fair and realistic.
Step 4: Decide if the set needs MORE iteration or if it's ready.

### SCORING PHILOSOPHY FOR FINAL ASSESSMENT — 6-DIMENSIONAL + PAIRWISE
Score with DECIMALS (e.g. 7.3, 8.8, 9.6) — not just integers.

For EACH item, provide 6 sub-scores:
1. **color_fit** (0-10): Color harmony — math color score is ground truth
2. **spatial_fit** (0-10): Physical fit — math spatial score is ground truth
3. **material_fit** (0-10): Material coherence — math material score is ground truth
4. **style_coherence** (0-10): Design direction alignment (AI judgment)
5. **cross_room_fit** (0-10): Apartment-wide coherence — math cross-room score helps
6. **functional_fit** (0-10): Practical/lifestyle fit (AI judgment)

Also provide **final_score** as your overall holistic assessment. The server will compute a composite from sub_scores using weighted geometric mean — the LOWER of your final_score and the computed composite is used.

### COMPOUNDING: Bad dimensions are CATASTROPHIC
One dimension at 3/10 with all others at 9/10 → composite ~5-6/10, not ~8/10. Fix root causes.

### PAIRWISE COMPATIBILITY CHECK
After individual scoring, check every pair of items for conflicts. Report pairs with compatibility < 9.0.

### CHAIN OF REASONING — REQUIRED
For EVERY item, provide a **rationale** covering all 6 dimensions + overall.

### WHEN TO REQUEST MORE ROUNDS
Set needs_more_rounds = true if ANY item has any sub_score below 9.5 with a concrete fixable issue.

## OUTPUT FORMAT
Return JSON:
{
  "confidence": 0-10 (use decimals),
  "overall_cohesion": 0-10 (use decimals),
  "palette_coherence": "color story assessment",
  "material_coherence": "material/texture story assessment",
  "spatial_flow": "traffic flow, zones, spatial relationships",
  "issues": ["genuine cross-cutting problems"],
  "item_scores": [
    {
      "category": "category slug",
      "final_score": number (USE DECIMALS),
      "sub_scores": {
        "color_fit": number, "spatial_fit": number, "material_fit": number,
        "style_coherence": number, "cross_room_fit": number, "functional_fit": number
      },
      "needs_more_work": true/false (true if any sub_score < 9.5 AND fixable),
      "revised_search_title": "only if needs_more_work",
      "revised_specs": "only if needs_more_work",
      "revised_placement": "only if needs_more_work",
      "root_cause": "if needs_more_work — specify which dimension(s) failed",
      "reason": "1-2 sentence assessment",
      "rationale": "REQUIRED 7-step chain covering all 6 dims + overall"
    }
  ],
  "pairwise_conflicts": [
    { "item_a": "category_a", "item_b": "category_b", "compatibility": number, "conflict_type": "type", "reason": "why" }
  ],
  "needs_more_rounds": true/false,
  "round_budget": number (0-5)
}`,
  });

  // Scale max_tokens based on item count (same logic as harmony validation)
  const finalItemCount = whatItNeeds.length;
  const finalBaseMaxTokens = Math.min(16000 + finalItemCount * 2500, 65000);

  let lastError: string | undefined;
  let attempt = 0;
  let wasTruncated = false;

  try {
    return await withRetry(
      async () => {
        attempt++;

        // On truncation retries: increase token budget + reduce thinking overhead
        const maxTokens = wasTruncated
          ? Math.min(finalBaseMaxTokens + 16000, 65000)
          : finalBaseMaxTokens;
        const thinkingLevel = wasTruncated ? "medium" as const : "high" as const;

        const retryContent = attempt > 1 && lastError
          ? [...content, { type: "text" as const, text: wasTruncated
              ? `\n\n**IMPORTANT**: Your previous response was truncated due to length. Be MORE CONCISE: keep rationales to 1-2 sentences max, omit revised fields for items scoring above 9.0. Return ONLY valid JSON matching the exact schema above.`
              : `\n\n**IMPORTANT**: Your previous response was invalid: "${lastError}". Return ONLY valid JSON matching the exact schema above.` }]
          : content;

        const response = await geminiProvider.chat({
          model,
          system,
          messages: [{ role: "user", content: retryContent }],
          max_tokens: maxTokens,
          temperature: 0.2,
          thinkingConfig: { thinkingLevel },
          responseMimeType: "application/json",
        });

        if (response.truncated) {
          wasTruncated = true;
          throw new Error("Response truncated (MAX_TOKENS)");
        }

        const raw = extractJsonObject(response.content);
        const unwrapped = Array.isArray(raw) ? raw[0] : raw;
        const parsed = FinalAssessmentResponseSchema.parse(unwrapped);
        const result: FinalAssessmentResult = {
          ...parsed,
          pairwise_conflicts: (parsed.pairwise_conflicts || []).map((c) => ({
            ...c,
            conflict_type: c.conflict_type || "",
            reason: c.reason || "",
          })),
          item_scores: parsed.item_scores.map((s) => ({
            ...s,
            sub_scores: s.sub_scores ?? undefined,
            revised_search_title: s.revised_search_title ?? undefined,
            revised_specs: s.revised_specs ?? undefined,
            revised_placement: s.revised_placement ?? undefined,
            root_cause: s.root_cause ?? undefined,
            rationale: s.rationale ?? undefined,
          })),
        };

        log.info("Final assessment complete", {
          phase: "final-assessment",
          confidence: result.confidence,
          cohesion: result.overall_cohesion,
          items: result.item_scores.length,
          pairwise_conflicts: result.pairwise_conflicts.length,
          scores: result.item_scores.map((s) => {
            const ss = s.sub_scores;
            const dims = ss ? `(c${ss.color_fit}/sp${ss.spatial_fit}/m${ss.material_fit}/st${ss.style_coherence}/cr${ss.cross_room_fit}/f${ss.functional_fit})` : "";
            return `${s.category}=${s.final_score}${dims}`;
          }).join(", "),
          needsMoreRounds: result.needs_more_rounds,
          roundBudget: result.round_budget,
        });

        return {
          success: true as const,
          data: result,
          tokensUsed: response.usage.input_tokens + response.usage.output_tokens + response.usage.thinking_tokens,
          model: response.model,
        };
      },
      {
        maxAttempts: 3,
        baseDelayMs: 1500,
        maxDelayMs: 15000,
        isRetryable: (error) => {
          if (isRetryableError(error)) return true;
          if (error instanceof SyntaxError) return true;
          if (error instanceof Error && error.name === "ZodError") return true;
          if (error instanceof Error && error.message.includes("truncated")) return true;
          return false;
        },
        onRetry: (retryAttempt, delayMs, error) => {
          lastError = error instanceof Error ? error.message : "Final assessment failed";
          log.warn(`Final assessment retry ${retryAttempt}`, { durationMs: delayMs, error: lastError });
        },
      }
    );
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Final assessment failed after retries";
    log.error("Final assessment failed", { error: errMsg });
    return { success: false, error: errMsg };
  }
}

/**
 * Validate a set of product search results holistically.
 * Checks that all items work together across tiers.
 * Now includes product images and visual metadata for visual coherence checks.
 */
export async function validateProductSet(
  products: Array<{
    title: string;
    category: string;
    tier: string;
    materials?: string[];
    colors?: string[];
    price?: number;
    description?: string;
    image_url?: string | null;
    dimensions?: { width?: number; depth?: number; height?: number; diameter?: number; unit?: string };
    visual_style_tags?: string[];
  }>,
  roomContext: {
    roomType: string;
    designDirection: string;
    existingItems: string[];
    roomImageUrls?: string[];
    designProfile?: DynamicDesignProfile;
    placementMap?: Record<string, string>;
    spatialLayout?: string;
    floorPlan?: Record<string, unknown>;
    lightingConditions?: string;
    windowDoorPositions?: string;
    outletPositions?: string;
    priorities?: string[];
    userContext?: string;
    replaceItems?: string[];
    whatShouldGo?: string[];
  }
): Promise<AgentResult<ValidationResult>> {
  const model = selectModel("validation");
  const system = getSystemPrompt(roomContext.designProfile);

  // Build environmental context section
  const envContext = [
    roomContext.spatialLayout && `Spatial layout: ${roomContext.spatialLayout}`,
    roomContext.floorPlan?.room_dimensions && `Room dimensions: ${JSON.stringify(roomContext.floorPlan.room_dimensions)}`,
    roomContext.floorPlan?.total_sqft && `Apartment: ~${roomContext.floorPlan.total_sqft} sqft`,
    roomContext.lightingConditions && `Lighting: ${roomContext.lightingConditions}`,
    roomContext.windowDoorPositions && `Windows/doors: ${roomContext.windowDoorPositions}`,
    roomContext.outletPositions && `Outlets: ${roomContext.outletPositions}`,
    roomContext.priorities?.length && `Client priorities: ${roomContext.priorities.join(", ")}`,
    roomContext.placementMap && Object.keys(roomContext.placementMap).length > 0 &&
      `Intended placements:\n${Object.entries(roomContext.placementMap).map(([cat, pl]) => `  ${cat}: ${pl}`).join("\n")}`,
  ].filter(Boolean).join("\n");

  // Compute deterministic math scores for the product set
  const setMathScores = computeSetMathScores(
    products.map(p => ({
      title: p.title,
      category: p.category,
      tier: p.tier,
      materials: p.materials,
      colors: p.colors,
      price: p.price,
      description: p.description,
      dimensions: p.dimensions,
      visual_style_tags: p.visual_style_tags,
    })),
    {
      roomType: roomContext.roomType,
      designDirection: roomContext.designDirection,
      existingItems: roomContext.existingItems,
      floorPlan: roomContext.floorPlan,
    }
  );
  const setMathSection = formatSetMathForPrompt(setMathScores);

  const promptText = `Validate this set of product search results AS A COLLECTIVE SET. You have room photos and product images — use them to verify visual coherence.

IMPORTANT: Think step-by-step. First examine the room photos. Then examine each product image. Then evaluate each product against the room AND against every other product in the set.

${setMathSection}

## VALIDATION CHECKLIST — Check EVERY item on this list:
1. **Visual cohesion**: Do the product images ACTUALLY look like they belong together? Check real colors, textures, and styles in the images — not just text descriptions.
2. Every item description is detailed enough (specific materials, exact colors with undertones, dimensions)
3. All items within each tier work together aesthetically
4. Items match the room's design direction and existing furniture visible in room photos
5. Budget/Middle/Luxury tiers have appropriate price differentiation
6. No duplicate or near-duplicate products across tiers
7. Scale and proportion: Do these items look like they'd work at the right scale for the room shown?
8. **Harmony with existing items**: Do the products work with the items being KEPT in the room?
9. **Material durability**: Are materials practical for daily use? (White boucle + pets = problem, glass + kids = risk, delicate fabrics in high-traffic areas = impractical)
10. **Acoustic balance**: Does the set include enough soft materials (rugs, curtains, upholstery) for rooms with hard surfaces?
11. **Lighting coverage**: Does the set adequately address the room's lighting needs? Dark corners should have light sources.
12. **Window/door clearance**: Do any items at their intended placements block windows or door swings?
13. **Outlet access**: Do powered items (lamps, media consoles) have outlets near their intended placement?

## ROOM CONTEXT
- Room type: ${roomContext.roomType}
- Design direction: ${roomContext.designDirection}
- Existing items to keep: ${roomContext.existingItems.length > 0 ? roomContext.existingItems.join(", ") : "none specified"}${roomContext.replaceItems?.length ? `\n- Items being replaced/removed: ${roomContext.replaceItems.join(", ")}` : ""}${roomContext.whatShouldGo?.length ? `\n- From diagnosis — items that should go: ${roomContext.whatShouldGo.join("; ")}` : ""}
${envContext ? `\n## SPATIAL & ENVIRONMENTAL CONTEXT\n${envContext}` : ""}${roomContext.userContext ? `\n\n## USER NOTES ABOUT THIS ROOM\n"${roomContext.userContext}"\nIMPORTANT: Factor these notes into validation. If the user mentions constraints or preferences not visible in photos, consider them when checking product fit.` : ""}

## PRODUCTS TO VALIDATE
${JSON.stringify(products.map(({ image_url: _img, ...rest }) => rest), null, 2)}

## PER-PRODUCT SCORING — 6-DIMENSIONAL + PAIRWISE

For EACH product, provide 6 sub-scores (USE DECIMALS e.g. 7.3, 8.8, 9.6):
1. **color_fit** (0-10): Color harmony with other products and existing items
2. **spatial_fit** (0-10): Physical fit, dimensions appropriate for the room
3. **material_fit** (0-10): Material compatibility with other products (wood species, metal finishes, texture)
4. **style_coherence** (0-10): Style family alignment with design direction
5. **cross_room_fit** (0-10): Apartment-wide coherence (if context available)
6. **functional_fit** (0-10): Practical for daily use, durability, lifestyle match

Also provide an overall **harmony_score** — but note: the server computes a composite from sub_scores using weighted geometric mean. One bad dimension tanks the whole score (compounding).

## PAIRWISE COMPATIBILITY CHECK — CRITICAL
After individual scoring, check EVERY PAIR of products for compatibility conflicts. Report pairs with compatibility < 9.0:
- Walnut coffee table + oak side table = wood species clash → 4.5
- Chrome lamp + brass pendant = metal finish clash → 5.0
Only report conflicting pairs. Omitted pairs assumed 9.5+.

Return JSON:
{
  "isValid": true/false,
  "confidence": 0-10 (use decimals),
  "issues": ["specific problems — reference what you SEE in the images"],
  "suggestions": ["specific improvements"],
  "product_flags": [
    {
      "title": "product title",
      "category": "category slug",
      "harmony_score": number (USE DECIMALS),
      "sub_scores": {
        "color_fit": number, "spatial_fit": number, "material_fit": number,
        "style_coherence": number, "cross_room_fit": number, "functional_fit": number
      },
      "clashes_with": ["items it clashes with — existing or other products"],
      "reason": "why it fits or doesn't fit"
    }
  ],
  "pairwise_conflicts": [
    { "item_a": "category_a", "item_b": "category_b", "compatibility": number, "conflict_type": "type", "reason": "why" }
  ]
}`;

  const content: AIContentBlock[] = [];

  // Add room images for context
  if (roomContext.roomImageUrls) {
    for (const url of roomContext.roomImageUrls.slice(0, 2)) {
      content.push({ type: "image", source: { type: "url", url } });
    }
  }

  // Add product images (up to 10 to stay within limits)
  const productsWithImages = products.filter((p) => p.image_url);
  for (const p of productsWithImages.slice(0, 10)) {
    content.push({ type: "image", source: { type: "url", url: p.image_url! } });
  }

  content.push({ type: "text", text: promptText });

  let lastError: string | undefined;
  let attempt = 0;

  try {
    return await withRetry(
      async () => {
        attempt++;
        const retryContent = attempt > 1 && lastError
          ? [...content, { type: "text" as const, text: `\n\n**IMPORTANT**: Your previous response was invalid: "${lastError}". Return ONLY valid JSON matching the exact schema above.` }]
          : content;

        const response = await geminiProvider.chat({
          model,
          system,
          messages: [{ role: "user", content: retryContent }],
          max_tokens: 16000,
          temperature: attempt === 1 ? 0.2 : 0.3,
          thinkingConfig: { thinkingLevel: "high" },
          responseMimeType: "application/json",
        });

        const raw = extractJsonObject(response.content);
        const validated = ProductSetValidationResponseSchema.parse(raw);

        // Apply per-dimension math capping and composite scoring for product flags
        if (validated.product_flags) {
          const pairwiseConflicts = (validated.pairwise_conflicts || []).map((c) => ({
            item_a: c.item_a,
            item_b: c.item_b,
            compatibility: c.compatibility,
            conflict_type: c.conflict_type || "",
            reason: c.reason || "",
          }));

          for (const flag of validated.product_flags) {
            const mathEntry = setMathScores.per_product.find(
              pp => pp.title === flag.title || pp.category === flag.category
            );

            // If sub_scores are provided, compute composite with math caps + pairwise
            if (flag.sub_scores) {
              const mathCaps: MathDimensionCaps = {};
              if (mathEntry) {
                mathCaps.color_fit = mathEntry.math_harmony; // best available proxy
                mathCaps.material_fit = mathEntry.math_harmony;
              }
              const compositeResult = computeFinalHarmonyScore(
                flag.sub_scores as CompositeSubScores,
                mathCaps,
                flag.category,
                pairwiseConflicts
              );
              if (compositeResult.harmony_score < flag.harmony_score) {
                log.info(`Composite capping product set "${flag.title}": AI=${flag.harmony_score} → composite=${compositeResult.harmony_score}`);
                flag.harmony_score = compositeResult.harmony_score;
              }
            } else {
              // Fallback: flat math cap for products without sub_scores
              if (mathEntry && mathEntry.math_harmony < 0.6 && flag.harmony_score > 6) {
                const mathCap = Math.round(mathEntry.math_harmony * 10);
                log.info(`Math capping product set harmony: "${flag.title}" AI=${flag.harmony_score} → ${mathCap}`);
                flag.harmony_score = mathCap;
              }
            }
          }
        }

        log.info("Product set validation complete", {
          phase: "validation",
          confidence: validated.confidence,
          products: validated.product_flags?.length ?? 0,
          pairwise_conflicts: validated.pairwise_conflicts?.length ?? 0,
          mathOverall: setMathScores.overall,
        });

        return {
          success: true as const,
          data: validated,
          tokensUsed: response.usage.input_tokens + response.usage.output_tokens + response.usage.thinking_tokens,
          model: response.model,
        };
      },
      {
        maxAttempts: 3,
        baseDelayMs: 1500,
        maxDelayMs: 10000,
        isRetryable: (error) => {
          if (isRetryableError(error)) return true;
          if (error instanceof SyntaxError) return true;
          if (error instanceof Error && error.name === "ZodError") return true;
          return false;
        },
        onRetry: (retryAttempt, delayMs, error) => {
          lastError = error instanceof Error ? error.message : "Product set validation failed";
          log.warn(`Product set validation retry ${retryAttempt}`, { durationMs: delayMs, error: lastError });
        },
      }
    );
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Product set validation failed after retries";
    log.error("Product set validation failed", { error: errMsg });
    return { success: false, error: errMsg };
  }
}
