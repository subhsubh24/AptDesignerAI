import { geminiProvider } from "@/lib/ai/gemini";
import { selectModel } from "@/lib/ai/models";
import { getSystemPromptCore, getSystemPrompt } from "@/lib/prompts/system";
import {
  HarmonyItemScoresResponseSchema,
  HarmonyGlobalResponseSchema,
  ProductSetValidationResponseSchema,
  FinalItemScoresResponseSchema,
  FinalHolisticResponseSchema,
  FinalConvergenceResponseSchema,
} from "@/lib/types/schemas";
import { withRetry, isRetryableError } from "@/lib/ai/retry";
import { DETERMINISTIC_SEED } from "@/lib/ai/determinism";
import { extractJsonObject } from "@/lib/ai/extract-json";
import { zodToGeminiSchema } from "@/lib/ai/schema";
import { createLogger } from "@/lib/logging/logger";
import { parseUserContext, formatParsedContextForPrompt } from "@/lib/utils/parse-user-context";
import { quoteForPrompt } from "@/lib/utils/sanitize-prompt";
import type { AIContentBlock } from "@/lib/ai/provider";
import type { AgentResult } from "./types";
import type { DynamicDesignProfile } from "@/lib/design-context/user-profile";
import type { DiagnosisData, DesignDirection, ExtractedFloorPlan } from "@/lib/types/database";
import { formatExtractedFloorPlanForPrompt } from "@/lib/agents/format-floor-plan";
import { computeSetMathScores, formatSetMathForPrompt } from "@/lib/validation/set-math";
import { computeFinalHarmonyScore, type MathDimensionCaps, type HarmonySubScores as CompositeSubScores } from "@/lib/scoring/harmony-composite";

/**
 * Shared context blocks used by harmony + final-assessment splits.
 * Every sub-call sees the same room/building/apartment/floor-plan/other-rooms
 * grounding so their outputs are rooted in identical evidence.
 */
interface HarmonySharedContextInput {
  context: {
    roomType: string;
    roomName: string;
    buildingResearch?: Record<string, unknown>;
    apartmentAnalysis?: Record<string, unknown>;
    floorPlan?: Record<string, unknown>;
    userContext?: string;
    otherRooms?: Array<{ name: string; roomType: string; palette?: string[]; materials?: string[]; designDirection?: string; keyItems?: string[] }>;
    /** Pre-formatted block describing verified existing furniture (from product-identifier pipeline). Ground-truth for scale/material/style checks. */
    identifiedContext?: string;
    /** Room diagnosis — what's working, what's not, spatial gaps. Keeps validation grounded in the same problem statement other agents saw. */
    diagnosis?: DiagnosisData;
    /** Structured design direction (palette/materials/style). Preferred over the loose string in the analysis block. */
    designDirection?: DesignDirection;
  };
}

function buildHarmonyContextBlocks({ context }: HarmonySharedContextInput): {
  buildingCtx: string;
  apartmentCtx: string;
  otherRoomsCtx: string;
  floorPlanCtx: string;
  userCtx: string;
  identifiedCtx: string;
  diagnosisCtx: string;
  directionCtx: string;
} {
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
    ? `\n\n## OTHER ROOMS IN THE APARTMENT (for cross-room coherence)
${context.otherRooms.map((r) => {
  const parts = [`- **${r.name}** (${r.roomType})`];
  if (r.designDirection) parts.push(`  Direction: ${r.designDirection}`);
  if (r.palette?.length) parts.push(`  Palette: ${r.palette.join(", ")}`);
  if (r.materials?.length) parts.push(`  Materials: ${r.materials.join(", ")}`);
  if (r.keyItems?.length) parts.push(`  Key items: ${r.keyItems.join("; ")}`);
  return parts.join("\n");
}).join("\n")}
Items in THIS room must harmonize with the palette, materials, and style of the other rooms.`
    : "";

  const floorPlanCtx = context.floorPlan
    ? `\n\n## FLOOR PLAN / ROOM DIMENSIONS
Total sqft: ${context.floorPlan.total_sqft || "unknown"}
Room dimensions: ${JSON.stringify(context.floorPlan.room_dimensions || {})}
Room layout: ${context.floorPlan.room_layout || "unknown"}
Living/dining combined: ${context.floorPlan.living_dining_combined ?? "unknown"}
Spatial features: ${Array.isArray(context.floorPlan.notable_spatial_features) ? context.floorPlan.notable_spatial_features.join(", ") : "unknown"}`
    : "";

  let userCtx = "";
  if (context.userContext) {
    const parsed = parseUserContext(context.userContext);
    const structuredBlock = formatParsedContextForPrompt(parsed);
    userCtx += `\n\n## USER NOTES\n"${context.userContext}"\nRespect these notes. If the user says to ignore something, don't flag it. If they mention lifestyle needs (pets, kids, entertaining), factor into material/durability checks.`;
    if (structuredBlock) userCtx += `\n\n${structuredBlock}`;
    userCtx += `\n\n⚠️ CRITICAL: If the user says they DON'T NEED something, any recommendation in that category MUST be flagged with drop=true and harmony_score=0. If they say to KEEP an item, any recommendation that replaces it MUST be flagged with drop=true.`;
  }

  const identifiedCtx = context.identifiedContext
    ? `\n\n${context.identifiedContext}\nIMPORTANT for validation: Treat these as GROUND-TRUTH verified pieces already in the room. New items must harmonize with their materials, colors, scale (within ~20% of canonical dimensions), and style. Flag any recommendation that would REPLACE an identified piece (same category) unless explicitly in the user's replace list.`
    : "";

  const diagnosisCtx = context.diagnosis
    ? (() => {
        const lines: string[] = [];
        if (context.diagnosis!.what_is_working?.length) {
          lines.push(`What's working: ${context.diagnosis!.what_is_working.join("; ")}`);
        }
        if (context.diagnosis!.what_is_not_working?.length) {
          lines.push(`What's NOT working: ${context.diagnosis!.what_is_not_working.join("; ")}`);
        }
        const spatialGaps = (context.diagnosis as DiagnosisData & { spatial_gaps?: string[] }).spatial_gaps;
        if (spatialGaps?.length) {
          lines.push(`Dead zones / empty spaces: ${spatialGaps.join("; ")}`);
        }
        return lines.length
          ? `\n\n## DIAGNOSIS (grounded problem statement from the diagnostician)\n${lines.join("\n")}\nThe product set must solve the "NOT working" problems AND activate any dead zones.`
          : "";
      })()
    : "";

  const directionCtx = context.designDirection
    ? (() => {
        const dd = context.designDirection!;
        const lines: string[] = [];
        if (dd.recommended_palette?.length) lines.push(`Target palette: ${dd.recommended_palette.join(", ")}`);
        if (dd.recommended_materials?.length) lines.push(`Target materials: ${dd.recommended_materials.join(", ")}`);
        if (dd.style_notes) lines.push(`Style direction: ${dd.style_notes}`);
        return lines.length ? `\n\n## DESIGN DIRECTION (structured)\n${lines.join("\n")}` : "";
      })()
    : "";

  return { buildingCtx, apartmentCtx, otherRoomsCtx, floorPlanCtx, userCtx, identifiedCtx, diagnosisCtx, directionCtx };
}

const log = createLogger("validation-agent");

// Gemini responseSchema objects converted once from our Zod schemas.
// Passing these with each call constrains Gemini's output to the exact
// shape the Zod parser expects, eliminating the occasional "returned a
// bare array" / "wrong wrapper key" shape drift we otherwise paper over
// with retries. Mirrors the pattern already used by room-diagnostician,
// shopping-researcher, and fit-scorer.
const HARMONY_ITEM_SCORES_GEMINI_SCHEMA = zodToGeminiSchema(HarmonyItemScoresResponseSchema);
const HARMONY_GLOBAL_GEMINI_SCHEMA = zodToGeminiSchema(HarmonyGlobalResponseSchema);
const FINAL_ITEM_SCORES_GEMINI_SCHEMA = zodToGeminiSchema(FinalItemScoresResponseSchema);
const FINAL_HOLISTIC_GEMINI_SCHEMA = zodToGeminiSchema(FinalHolisticResponseSchema);
const FINAL_CONVERGENCE_GEMINI_SCHEMA = zodToGeminiSchema(FinalConvergenceResponseSchema);
const PRODUCT_SET_VALIDATION_GEMINI_SCHEMA = zodToGeminiSchema(ProductSetValidationResponseSchema);

export interface ValidationResult {
  isValid: boolean;
  confidence: number;
  issues: string[];
  revisedAnalysis?: Record<string, unknown>;
  /** Per-product harmony scores — returned by validateProductSet */
  product_flags?: Array<{
    title: string;
    category: string;
    harmony_score: number;
    sub_scores?: HarmonySubScores;
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
 * Harmony validation via two focused sequential passes:
 *   A (per-item scoring): 6-dim sub-scores + revisions for each item
 *   B (global + gaps):    overall cohesion, palette/material/spatial narratives,
 *                         pairwise conflicts, issues — consumes A's item scores
 *
 * Splitting prevents the global narrative from crowding out per-item rationale
 * (or vice versa) within a single 65K-token ceiling.
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
    floorPlanImageUrl?: string;
    extractedFloorPlan?: ExtractedFloorPlan;
    userContext?: string;
    otherRooms?: Array<{ name: string; roomType: string; palette?: string[]; materials?: string[]; designDirection?: string; keyItems?: string[] }>;
    mathScoresText?: string;
    identifiedContext?: string;
    diagnosis?: DiagnosisData;
    designDirection?: DesignDirection;
  }
): Promise<AgentResult<HarmonyValidationResult>> {
  const model = selectModel("validation");
  const system = getSystemPromptCore(context.designProfile);

  const whatWorks = (analysis.what_works as string[]) || [];
  const whatShouldGo = (analysis.what_should_go as string[]) || [];
  const whatItNeeds = (analysis.what_it_needs as Array<Record<string, unknown>>) || [];
  const designDirection = (analysis.design_direction as string) || "";
  const spatialLayout = (analysis.spatial_layout as string) || "";

  const { buildingCtx, apartmentCtx, otherRoomsCtx, floorPlanCtx, userCtx, identifiedCtx, diagnosisCtx, directionCtx } =
    buildHarmonyContextBlocks({ context });

  // Shared image content — floor plan first (ground truth), then room photos.
  const roomImages: AIContentBlock[] = [];
  if (context.floorPlanImageUrl) {
    roomImages.push({
      type: "text",
      text: "AUTHORITATIVE FLOOR PLAN — exact dimensions, wall features, and orientation. Use this as spatial ground truth for all spatial_fit scoring.",
    });
    roomImages.push({ type: "image", source: { type: "url", url: context.floorPlanImageUrl } });
  }
  for (const url of context.roomImageUrls.slice(0, 4)) {
    roomImages.push({ type: "image", source: { type: "url", url } });
  }

  // Replace legacy floorPlanCtx with extracted floor plan when available
  const resolvedFloorPlanCtx = context.extractedFloorPlan
    ? `\n\n${formatExtractedFloorPlanForPrompt(context.extractedFloorPlan, context.roomType)}`
    : floorPlanCtx;

  const sharedHeader = `## ROOM
${context.roomName} (${context.roomType})${buildingCtx}${apartmentCtx}${resolvedFloorPlanCtx}${otherRoomsCtx}${userCtx}${identifiedCtx}${diagnosisCtx}${directionCtx}

## DESIGN DIRECTION
${designDirection}

## SPATIAL LAYOUT PLAN
${spatialLayout || "Not specified — infer from the room photos"}

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

${context.mathScoresText ? `\n${context.mathScoresText}\n` : ""}`;

  // ─── Pass A: Per-item scoring (parallel chunks for large sets) ────────────
  const itemCount = whatItNeeds.length;
  const passAMaxTokensBase = Math.min(8000 + itemCount * 2000, 48000);

  // Build Pass A prompt. In chunked mode the full item list stays in sharedHeader for
  // cross-item context; a restriction note tells each parallel scorer to output only its group.
  const buildPassAPromptText = (assignedItems: Array<Record<string, unknown>>, isChunked: boolean): string => {
    const restriction = isChunked
      ? `\n\n## ⚠️ PARALLEL SCORING ASSIGNMENT\nThis is a parallel scoring session. Score ONLY the ${assignedItems.length} items listed below. A separate parallel call scores the remaining items.\nYOUR ASSIGNED ITEMS TO SCORE:\n${assignedItems.map(item => `- [${item.category}] ${item.search_title}`).join("\n")}\n\nThe full item list above (in RECOMMENDED NEW ITEMS) is for cross-item palette/material/spatial conflict detection — reference it freely. But OUTPUT item_scores ONLY for your assigned items above.\n`
      : "";

    return `You are a senior interior designer running PASS 1 of 2 on recommended items. Your ONLY job here: for ${isChunked ? "items in your SCORING ASSIGNMENT" : "EVERY recommended item"}, produce 6-dimensional sub-scores + rationale + revisions if needed. A separate pass handles global cohesion, pairwise conflicts, and narrative — do NOT produce those here.

${sharedHeader}${restriction}
## YOUR JOB — PER-ITEM SCORING (pass 1 of 2)

For EACH ${isChunked ? "ASSIGNED" : "recommended"} item, evaluate against:
- Items to keep (palette/material/style harmony with existing pieces visible in the room photos)
- Other recommendations (palette/material/style coherence as a SET)
- Apartment-wide coherence (other rooms' palettes/materials/style)
- Spatial fit (placement, scale, clearances, traffic flow, window/door/outlet access)
- Functional fit (lifestyle, durability, acoustic, lighting adequacy)

### SUB-SCORES (0-10, DECIMALS) — all 6 per item:
1. **color_fit**: color/palette harmony with keeps + other recs + palette
2. **spatial_fit**: physical fit, clearances, traffic flow, placement validity
3. **material_fit**: material compatibility (≤2 wood species, coherent metal finishes, soft/hard balance)
4. **style_coherence**: design-direction alignment, style family, visual weight
5. **cross_room_fit**: apartment-wide coherence with other rooms
6. **functional_fit**: practicality, durability, lifestyle match, lighting/acoustic adequacy

### COMPOUNDING
harmony_score ≈ min(sub_scores) × 0.4 + mean(sub_scores) × 0.6. ONE bad dim tanks the whole item.

### FOR ANY item where ANY sub_score < 9.5
Provide revised_search_title, revised_specs, revised_placement that would bring ALL sub_scores to 9.5+, AND a root_cause naming the specific failing dimension and issue (e.g. "material_fit: oak legs clash with walnut — 3 wood species").

### ANCHOR REVISIONS TO CONCRETE TARGETS (CRITICAL — avoid vague revisions that oscillate)
Vague revisions ("larger rug", "compact sofa") cause the pipeline to loop without converging. Every revision MUST specify concrete numbers:

**Rugs (area_rug / runner / accent_rug)** — the #1 oscillator. Pick an EXACT standard size from this table based on room dimensions + seating footprint, and include it in BOTH revised_search_title AND revised_specs:
  - Small bedrooms / reading nooks → **5x7** or **5x8**
  - Mid bedrooms / small seating areas → **6x9**
  - Standard living rooms / under a 72"–84" sofa → **8x10**
  - Large living rooms / L-shaped sectional / open floor plans → **9x12**
  - Great rooms / sectional + chairs group → **10x14** or **12x15**
  - Hallways → **2.5x8** or **2.5x10** runner
  - If spatial_fit failed: name the PREVIOUS size and the NEW size (e.g. "upgrade from 5x7 to 8x10 so the front legs of the sofa sit on the rug").

**Sofas / sectionals** — revised_specs MUST include exact width in inches (e.g. "84" sofa", "112" right-facing sectional with 36" chaise depth"). Never say "smaller sofa".

**Dining tables** — revised_specs MUST include length × width + seat count (e.g. "60"×36" rectangular — seats 6").

**Beds** — revised_specs MUST include mattress size (Twin/Full/Queen/King/Cal King) AND frame dimensions if headboard is oversized.

**Lighting (pendant / chandelier)** — revised_specs MUST include diameter + hang-height (e.g. "22" diameter, 32"–36" above table top").

**Coffee tables / side tables** — revised_specs MUST include L×W×H in inches and the clearance target from the adjacent sofa (e.g. "48"×28"×17" — sits 14" off the sofa front").

If you can't determine the concrete target from the photos + spatial layout, say so in root_cause ("need floor plan dimensions to pick rug size") rather than returning a vague revision.

### drop
true if harmony_score ≤ 3 OR the user explicitly excluded the category / asked to keep a conflicting item.

### rationale (REQUIRED, chain-of-thought)
For every item, walk through all 6 dims + overall in 7 steps.

## OUTPUT FORMAT (JSON only, no prose, no markdown fences)
{
  "item_scores": [
    {
      "category": "category slug",
      "harmony_score": number (decimal),
      "sub_scores": {
        "color_fit": number, "spatial_fit": number, "material_fit": number,
        "style_coherence": number, "cross_room_fit": number, "functional_fit": number
      },
      "keeps_well_with": ["items it pairs well with"],
      "clashes_with": ["items it conflicts with — include spatial/environmental"],
      "revised_search_title": "only if any sub_score < 9.5",
      "revised_specs": "only if any sub_score < 9.5",
      "revised_placement": "only if any sub_score < 9.5",
      "drop": true/false,
      "root_cause": "only if any sub_score < 9.5 — name the failing dimension(s) and specific issue",
      "reason": "1-2 sentence explanation",
      "rationale": "REQUIRED 7-step chain covering 6 dims + overall"
    }
  ]
}`;
  };

  // Helper: run one Pass A LLM call with retry for a given prompt + token budget.
  type HarmonyPassAResult = { scores: HarmonyValidationResult["item_scores"]; tokens: number; usedModel: string };
  const runHarmonyPassAChunk = async (promptText: string, maxTokensBase: number): Promise<HarmonyPassAResult> => {
    let lastError: string | undefined;
    let attempt = 0;
    let wasTruncated = false;
    const content: AIContentBlock[] = [
      ...roomImages,
      { type: "text", text: promptText },
    ];
    return withRetry(
      async () => {
        attempt++;
        const maxTokens = wasTruncated
          ? Math.min(maxTokensBase + 16000, 64000)
          : maxTokensBase;
        const retryContent = attempt > 1 && lastError
          ? [...content, { type: "text" as const, text: wasTruncated
              ? `\n\n**IMPORTANT**: Your previous response was truncated. Be MORE CONCISE: keep rationales to 1-2 sentences, omit revised fields for items scoring above 9.0.`
              : `\n\n**IMPORTANT**: Your previous response was invalid: "${lastError}". Return ONLY valid JSON matching the exact schema above.` }]
          : content;

        const response = await geminiProvider.chat({
          model,
          system,
          messages: [{ role: "user", content: retryContent }],
          max_tokens: maxTokens,
          seed: DETERMINISTIC_SEED,
          responseMimeType: "application/json",
          responseSchema: HARMONY_ITEM_SCORES_GEMINI_SCHEMA,
          mediaResolution: "ultra_high",
        });

        if (response.truncated) {
          wasTruncated = true;
          throw new Error("Response truncated (MAX_TOKENS)");
        }

        const raw = extractJsonObject(response.content);
        const unwrapped = Array.isArray(raw) ? raw[0] : raw;
        const parsed = HarmonyItemScoresResponseSchema.parse(unwrapped);
        return {
          scores: parsed.item_scores.map((s) => ({
            ...s,
            sub_scores: s.sub_scores,
            revised_search_title: s.revised_search_title ?? undefined,
            revised_specs: s.revised_specs ?? undefined,
            revised_placement: s.revised_placement ?? undefined,
            root_cause: s.root_cause ?? undefined,
            rationale: s.rationale ?? undefined,
          })) as HarmonyValidationResult["item_scores"],
          tokens: response.usage.input_tokens + response.usage.output_tokens + response.usage.thinking_tokens,
          usedModel: response.model,
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
          lastError = error instanceof Error ? error.message : "Harmony item-scoring failed";
          log.warn(`Harmony item-scoring retry ${retryAttempt}`, { durationMs: delayMs, error: lastError });
        },
      }
    );
  };

  let itemScoresResult: HarmonyValidationResult["item_scores"] | undefined;
  let passATokens = 0;
  let responseModel = model;

  // Use parallel chunks for large item sets (≥ 8): each chunk sees the full list for
  // cross-item context but only outputs scores for its assigned subset.
  const HARMONY_CHUNK_THRESHOLD = 8;
  try {
    if (itemCount < HARMONY_CHUNK_THRESHOLD) {
      // Single-call path (original behaviour for small sets)
      const result = await runHarmonyPassAChunk(buildPassAPromptText(whatItNeeds, false), passAMaxTokensBase);
      itemScoresResult = result.scores;
      passATokens = result.tokens;
      responseModel = result.usedModel;
    } else {
      // Parallel chunked path: two groups scored simultaneously
      const midpoint = Math.ceil(itemCount / 2);
      const group1 = whatItNeeds.slice(0, midpoint);
      const group2 = whatItNeeds.slice(midpoint);
      // Each chunk outputs ~half the items so the token budget is proportionally smaller
      const chunkMaxTokens = Math.min(8000 + Math.ceil(itemCount / 2) * 2000, 28000);

      log.info("Harmony Pass A: splitting into parallel chunks", {
        totalItems: itemCount, group1: group1.length, group2: group2.length, chunkMaxTokens,
      });

      const [r1, r2] = await Promise.all([
        runHarmonyPassAChunk(buildPassAPromptText(group1, true), chunkMaxTokens),
        runHarmonyPassAChunk(buildPassAPromptText(group2, true), chunkMaxTokens),
      ]);

      // Merge in original item order; filter each chunk to its assigned categories only
      // (guards against the model accidentally scoring items outside its group).
      // Key by `${groupIndex}:${category}` to correctly handle duplicate categories
      // (e.g. two "wall_art" items) — a plain category key would overwrite the first.
      const group1Keys = new Set(group1.map((item, i) => `0:${i}:${item.category as string}`));
      const group2Start = group1.length;
      const group2Keys = new Set(group2.map((item, i) => `1:${i}:${item.category as string}`));
      // Build lookup: for each chunk, match returned scores back to original indices by position
      const mergedByIndex = new Map<number, HarmonyValidationResult["item_scores"][number]>();
      for (let i = 0; i < group1.length; i++) {
        const score = r1.scores.find(s => s.category === (group1[i].category as string));
        if (score) mergedByIndex.set(i, score);
      }
      for (let i = 0; i < group2.length; i++) {
        const score = r2.scores.find(s => s.category === (group2[i].category as string));
        if (score) mergedByIndex.set(group2Start + i, score);
      }
      // Suppress unused-variable warnings from the Set variables above
      void group1Keys; void group2Keys;
      itemScoresResult = whatItNeeds
        .map((_, idx) => mergedByIndex.get(idx))
        .filter((s): s is HarmonyValidationResult["item_scores"][number] => s !== undefined);

      passATokens = r1.tokens + r2.tokens;
      responseModel = r1.usedModel;

      log.info("Harmony Pass A: parallel chunks complete", {
        r1Items: r1.scores.length, r2Items: r2.scores.length,
        merged: itemScoresResult.length, totalTokens: passATokens,
      });
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Harmony item-scoring failed after retries";
    log.error("Harmony item-scoring failed", { error: errMsg });
    return { success: false, error: errMsg };
  }

  log.info("Harmony pass A (item scoring) complete", {
    tokens: { total: passATokens },
    items: itemScoresResult.length,
    scores: itemScoresResult.map((s) => {
      const ss = s.sub_scores;
      return `${s.category}=${s.harmony_score}(c${ss.color_fit}/sp${ss.spatial_fit}/m${ss.material_fit}/st${ss.style_coherence}/cr${ss.cross_room_fit}/f${ss.functional_fit})`;
    }).join(", "),
  });

  // ─── Pass B: Global cohesion + pairwise + gaps ──────────────
  const itemScoresJson = JSON.stringify(itemScoresResult, null, 2);
  const passBPrompt = `You are a senior interior designer running PASS 2 of 2 on a room's recommended items. Pass 1 produced per-item 6-dim sub-scores — below. Your job: step back to the whole set and assess global cohesion, pairwise conflicts, narrative coherence, and overall confidence.

Do NOT re-score individual items; that's already done. Trust Pass 1's item_scores and build on them.

${sharedHeader}
## PASS 1 ITEM SCORES (source of truth for per-item quality)
${itemScoresJson}

## YOUR JOB — GLOBAL ASSESSMENT

1. **overall_cohesion** (0-10, decimal): the full set evaluated holistically.
2. **palette_coherence** (1 sentence): does the color story work across all items + keeps + apartment?
3. **material_coherence** (1 sentence): does the material story work (wood species count, metal finishes, soft/hard balance)?
4. **spatial_flow** (2-3 sentences): traffic flow, zone definition, spatial relationships, focal points.
5. **pairwise_conflicts**: check every pair of items (recommendations AND keeps) for compatibility. Report ONLY pairs with compatibility < 9.0. Name the conflict_type (color_clash, material_mismatch, scale_conflict, style_conflict, wood_species_clash, metal_finish_clash, spatial_crowding, etc.) and reason.
6. **issues**: cross-cutting problems not tied to a single item (e.g., "set lacks any soft material in an all-hard-surface room").
7. **confidence** (0-10, decimal): how confident are you in the overall set after Pass 1's scoring + your global check?
8. **revisedAnalysis**: null unless confidence < 7 AND you have a concrete alternative — then propose a revised analysis object.

## OUTPUT FORMAT (JSON only, no prose, no markdown fences)
{
  "confidence": number,
  "overall_cohesion": number,
  "palette_coherence": "1 sentence",
  "material_coherence": "1 sentence",
  "spatial_flow": "2-3 sentences",
  "pairwise_conflicts": [
    { "item_a": "cat_a", "item_b": "cat_b", "compatibility": number, "conflict_type": "type", "reason": "why" }
  ],
  "issues": ["cross-cutting problems"],
  "revisedAnalysis": null
}`;

  let passBResult: ReturnType<typeof HarmonyGlobalResponseSchema.parse> | undefined;
  let passBTokens = 0;

  {
    let lastError: string | undefined;
    try {
      passBResult = await withRetry(
        async () => {
          const textBlock = lastError
            ? `${passBPrompt}\n\n**IMPORTANT**: Previous response was invalid: "${lastError}". Return ONLY valid JSON.`
            : passBPrompt;
          const response = await geminiProvider.chat({
            model,
            system,
            messages: [{ role: "user", content: [...roomImages, { type: "text", text: textBlock }] }],
            max_tokens: 10000,
            seed: DETERMINISTIC_SEED,
            responseMimeType: "application/json",
            responseSchema: HARMONY_GLOBAL_GEMINI_SCHEMA,
            mediaResolution: "ultra_high",
          });
          const raw = extractJsonObject(response.content);
          const unwrapped = Array.isArray(raw) ? raw[0] : raw;
          const parsed = HarmonyGlobalResponseSchema.parse(unwrapped);
          passBTokens = response.usage.input_tokens + response.usage.output_tokens + response.usage.thinking_tokens;
          return parsed;
        },
        {
          maxAttempts: 3,
          baseDelayMs: 1500,
          maxDelayMs: 15000,
          isRetryable: (error) => {
            if (isRetryableError(error)) return true;
            if (error instanceof SyntaxError) return true;
            if (error instanceof Error && error.name === "ZodError") return true;
            return false;
          },
          onRetry: (retryAttempt, delayMs, error) => {
            lastError = error instanceof Error ? error.message : "Harmony global pass failed";
            log.warn(`Harmony global retry ${retryAttempt}`, { durationMs: delayMs, error: lastError });
          },
        }
      );
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Harmony global pass failed after retries";
      log.error("Harmony global pass failed", { error: errMsg });
      return { success: false, error: errMsg };
    }
  }

  // Merge into legacy HarmonyValidationResult shape
  const result: HarmonyValidationResult = {
    confidence: passBResult.confidence,
    item_scores: itemScoresResult,
    pairwise_conflicts: (passBResult.pairwise_conflicts || []).map((c) => ({
      ...c,
      conflict_type: c.conflict_type || "",
      reason: c.reason || "",
    })),
    overall_cohesion: passBResult.overall_cohesion,
    palette_coherence: passBResult.palette_coherence,
    material_coherence: passBResult.material_coherence,
    spatial_flow: passBResult.spatial_flow,
    issues: passBResult.issues,
    revisedAnalysis: passBResult.revisedAnalysis ?? undefined,
  };

  log.info("Harmony validation complete (split pass)", {
    phase: "harmony",
    confidence: result.confidence,
    cohesion: result.overall_cohesion,
    items: result.item_scores.length,
    pairwise_conflicts: result.pairwise_conflicts.length,
    tokens: { total: passATokens + passBTokens },
    passATokens,
    passBTokens,
  });

  return {
    success: true,
    data: result,
    tokensUsed: passATokens + passBTokens,
    model: responseModel,
  };
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
 * Final comprehensive assessment via three focused sequential passes:
 *   A (per-item final scoring): 6-dim sub-scores per item, with revision history context
 *   B (holistic):               overall cohesion + palette/material/spatial narratives + pairwise
 *   C (convergence):            tight call deciding if more rounds are needed + round budget
 *
 * Splitting prevents per-item rationale, holistic narrative, and the convergence
 * decision from trading off against each other within one 65K ceiling.
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
    floorPlanImageUrl?: string;
    extractedFloorPlan?: ExtractedFloorPlan;
    userContext?: string;
    otherRooms?: Array<{ name: string; roomType: string; palette?: string[]; materials?: string[]; designDirection?: string; keyItems?: string[] }>;
    mathScoresText?: string;
    revisionHistory?: Record<string, Array<{ round: number; score: number; specs?: string; searchTitle?: string; rootCause?: string }>>;
    stabilizedItems?: string[];
    roundsCompleted: number;
    identifiedContext?: string;
    diagnosis?: DiagnosisData;
    designDirection?: DesignDirection;
  }
): Promise<AgentResult<FinalAssessmentResult>> {
  const model = selectModel("validation");
  const system = getSystemPromptCore(context.designProfile);

  const whatWorks = (analysis.what_works as string[]) || [];
  const whatShouldGo = (analysis.what_should_go as string[]) || [];
  const whatItNeeds = (analysis.what_it_needs as Array<Record<string, unknown>>) || [];
  const designDirection = (analysis.design_direction as string) || "";
  const spatialLayout = (analysis.spatial_layout as string) || "";

  const { buildingCtx, apartmentCtx, otherRoomsCtx, floorPlanCtx, identifiedCtx, diagnosisCtx, directionCtx } =
    buildHarmonyContextBlocks({ context });
  const userNotesShort = context.userContext ? `\n\n## USER NOTES\n"${context.userContext}"` : "";

  // Revision history summary (only used by Pass A and Pass C)
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
    revisionHistoryText += `\n\n⚠️ IMPORTANT: If any items oscillated across rounds, pick the BEST version from the history — don't propose yet another alternative.`;
  }

  const roomImages: AIContentBlock[] = [];
  if (context.floorPlanImageUrl) {
    roomImages.push({
      type: "text",
      text: "AUTHORITATIVE FLOOR PLAN — exact dimensions, wall features, and orientation. Use this as spatial ground truth for all spatial_fit scoring.",
    });
    roomImages.push({ type: "image", source: { type: "url", url: context.floorPlanImageUrl } });
  }
  for (const url of context.roomImageUrls.slice(0, 4)) {
    roomImages.push({ type: "image", source: { type: "url", url } });
  }

  const resolvedFloorPlanCtxFinal = context.extractedFloorPlan
    ? `\n\n${formatExtractedFloorPlanForPrompt(context.extractedFloorPlan, context.roomType)}`
    : floorPlanCtx;

  const sharedHeader = `## ROOM
${context.roomName} (${context.roomType})${buildingCtx}${apartmentCtx}${resolvedFloorPlanCtxFinal}${otherRoomsCtx}${userNotesShort}${identifiedCtx}${diagnosisCtx}${directionCtx}

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

${context.mathScoresText || ""}`;

  // ─── Pass A: Per-item final scoring with revision history (parallel for large sets) ───
  const finalItemCount = whatItNeeds.length;
  const passAMaxTokensBase = Math.min(8000 + finalItemCount * 2000, 48000);

  // Build Pass A prompt. In chunked mode the full item list stays in sharedHeader for
  // cross-item context; a restriction note tells each parallel scorer to output only its group.
  const buildFinalPassAPromptText = (assignedItems: Array<Record<string, unknown>>, isChunked: boolean): string => {
    const restriction = isChunked
      ? `\n\n## ⚠️ PARALLEL SCORING ASSIGNMENT\nThis is a parallel scoring session. Score ONLY the ${assignedItems.length} items listed below. A separate parallel call scores the remaining items.\nYOUR ASSIGNED ITEMS TO SCORE:\n${assignedItems.map(item => `- [${item.category}] ${item.search_title}`).join("\n")}\n\nThe full item list above (in CURRENT RECOMMENDED ITEMS) is for cross-item conflict detection — reference it freely. But OUTPUT item_scores ONLY for your assigned items above.\n`
      : "";

    return `You are a LEAD INTERIOR DESIGNER doing the FINAL per-item quality review. This is PASS 1 of 3: produce DEFINITIVE 6-dim sub-scores + revisions for ${isChunked ? "items in your SCORING ASSIGNMENT" : "EACH item"}. Do NOT produce global narrative or convergence decisions — those are separate passes.

${sharedHeader}
${revisionHistoryText}${restriction}
## YOUR JOB — PER-ITEM FINAL SCORING

For EACH ${isChunked ? "ASSIGNED" : ""} item, provide 6 sub-scores (USE DECIMALS):
1. **color_fit** — math color score is ground truth where provided
2. **spatial_fit** — math spatial score is ground truth where provided
3. **material_fit** — math material score is ground truth where provided
4. **style_coherence** — AI judgment (design direction alignment)
5. **cross_room_fit** — math cross-room score helps where provided
6. **functional_fit** — AI judgment (practicality, durability)

Also provide **final_score** (holistic assessment, decimal).
Server computes a composite from sub_scores using weighted geometric mean; min(your final_score, composite) is used.

## COMPOUNDING
One dim at 3/10 + all others at 9/10 → composite ~5-6/10. Fix root causes.

## needs_more_work
true if ANY sub_score < 9.5 AND fixable.

## Revisions (REQUIRED when needs_more_work = true)
revised_search_title, revised_specs, revised_placement, root_cause (name failing dim + issue)

### ANCHOR REVISIONS TO CONCRETE TARGETS (CRITICAL — prevents oscillation across rounds)
Vague revisions ("larger rug", "smaller sofa") cause the same item to keep failing in subsequent rounds. Every revision MUST cite concrete numbers:

**Rugs (area_rug / runner)** — #1 oscillator. Pick EXACT standard size and put it in BOTH revised_search_title AND revised_specs:
  - Small bedroom / reading nook → **5x7** or **5x8**
  - Mid bedroom / small seating → **6x9**
  - Standard living room / 72–84" sofa → **8x10**
  - Large living room / L-sectional → **9x12**
  - Great room / sectional + chairs → **10x14** or **12x15**
  - Hallway runner → **2.5x8** or **2.5x10**
  - If spatial_fit previously failed, name BOTH the old and new size: "upgrade 5x7 → 8x10 so front legs of sofa sit on rug".

**Sofas / sectionals** — revised_specs MUST include width in inches (e.g. "84" sofa", "112" RAF sectional with 36" chaise").
**Dining tables** — revised_specs MUST include L×W + seat count (e.g. "60"×36" — seats 6").
**Beds** — revised_specs MUST include mattress size (Twin/Full/Queen/King/Cal King).
**Pendants / chandeliers** — revised_specs MUST include diameter + hang-height (e.g. "22" dia, 32"–36" above table").
**Coffee / side tables** — revised_specs MUST include L×W×H + clearance from adjacent sofa (e.g. "48"×28"×17", 14" off sofa front").

If the concrete target is undeterminable from photos + spatial layout, say so in root_cause ("need floor plan dims to pick rug size") instead of returning a vague revision.

## rationale (REQUIRED for every item)
7 steps: COLOR → SPATIAL → MATERIAL → STYLE → CROSS-ROOM → FUNCTIONAL → OVERALL.

## OUTPUT FORMAT (JSON only, no prose, no markdown fences)
{
  "item_scores": [
    {
      "category": "category slug",
      "final_score": number (decimal),
      "sub_scores": {
        "color_fit": number, "spatial_fit": number, "material_fit": number,
        "style_coherence": number, "cross_room_fit": number, "functional_fit": number
      },
      "needs_more_work": true/false,
      "revised_search_title": "only if needs_more_work",
      "revised_specs": "only if needs_more_work",
      "revised_placement": "only if needs_more_work",
      "root_cause": "if needs_more_work — name failing dimension(s) and issue",
      "reason": "1-2 sentence assessment",
      "rationale": "REQUIRED 7-step chain"
    }
  ]
}`;
  };

  // Helper: run one final Pass A LLM call with retry.
  type FinalPassAResult = { scores: FinalAssessmentResult["item_scores"]; tokens: number; usedModel: string };
  const runFinalPassAChunk = async (promptText: string, maxTokensBase: number): Promise<FinalPassAResult> => {
    let lastError: string | undefined;
    let attempt = 0;
    let wasTruncated = false;
    const content: AIContentBlock[] = [
      ...roomImages,
      { type: "text", text: promptText },
    ];
    return withRetry(
      async () => {
        attempt++;
        const maxTokens = wasTruncated
          ? Math.min(maxTokensBase + 16000, 64000)
          : maxTokensBase;
        const retryContent = attempt > 1 && lastError
          ? [...content, { type: "text" as const, text: wasTruncated
              ? `\n\n**IMPORTANT**: Previous response was truncated. Be MORE CONCISE.`
              : `\n\n**IMPORTANT**: Previous response was invalid: "${lastError}". Return ONLY valid JSON.` }]
          : content;

        const response = await geminiProvider.chat({
          model,
          system,
          messages: [{ role: "user", content: retryContent }],
          max_tokens: maxTokens,
          seed: DETERMINISTIC_SEED,
          responseMimeType: "application/json",
          responseSchema: FINAL_ITEM_SCORES_GEMINI_SCHEMA,
          mediaResolution: "ultra_high",
        });

        if (response.truncated) {
          wasTruncated = true;
          throw new Error("Response truncated (MAX_TOKENS)");
        }

        const raw = extractJsonObject(response.content);
        const unwrapped = Array.isArray(raw) ? raw[0] : raw;
        const parsed = FinalItemScoresResponseSchema.parse(unwrapped);
        return {
          scores: parsed.item_scores.map((s) => ({
            ...s,
            sub_scores: s.sub_scores ?? undefined,
            revised_search_title: s.revised_search_title ?? undefined,
            revised_specs: s.revised_specs ?? undefined,
            revised_placement: s.revised_placement ?? undefined,
            root_cause: s.root_cause ?? undefined,
            rationale: s.rationale ?? undefined,
          })) as FinalAssessmentResult["item_scores"],
          tokens: response.usage.input_tokens + response.usage.output_tokens + response.usage.thinking_tokens,
          usedModel: response.model,
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
          lastError = error instanceof Error ? error.message : "Final item scoring failed";
          log.warn(`Final item-scoring retry ${retryAttempt}`, { durationMs: delayMs, error: lastError });
        },
      }
    );
  };

  let itemScores: FinalAssessmentResult["item_scores"] | undefined;
  let passATokens = 0;
  let responseModel = model;

  // Use parallel chunks for large item sets (≥ 8): each chunk sees the full list for
  // cross-item context but only outputs scores for its assigned subset.
  const FINAL_CHUNK_THRESHOLD = 8;
  try {
    if (finalItemCount < FINAL_CHUNK_THRESHOLD) {
      // Single-call path (original behaviour)
      const result = await runFinalPassAChunk(buildFinalPassAPromptText(whatItNeeds, false), passAMaxTokensBase);
      itemScores = result.scores;
      passATokens = result.tokens;
      responseModel = result.usedModel;
    } else {
      // Parallel chunked path: two groups scored simultaneously
      const midpoint = Math.ceil(finalItemCount / 2);
      const group1 = whatItNeeds.slice(0, midpoint);
      const group2 = whatItNeeds.slice(midpoint);
      const chunkMaxTokens = Math.min(8000 + Math.ceil(finalItemCount / 2) * 2000, 28000);

      log.info("Final assessment Pass A: splitting into parallel chunks", {
        totalItems: finalItemCount, group1: group1.length, group2: group2.length, chunkMaxTokens,
      });

      const [r1, r2] = await Promise.all([
        runFinalPassAChunk(buildFinalPassAPromptText(group1, true), chunkMaxTokens),
        runFinalPassAChunk(buildFinalPassAPromptText(group2, true), chunkMaxTokens),
      ]);

      // Merge by positional index within each chunk so duplicate
      // categories (e.g. two throw_pillows) don't overwrite each other.
      const mergedByIndex = new Map<number, FinalAssessmentResult["item_scores"][number]>();
      const group2Start = group1.length;
      for (let i = 0; i < r1.scores.length && i < group1.length; i++) {
        mergedByIndex.set(i, r1.scores[i]);
      }
      for (let i = 0; i < r2.scores.length && i < group2.length; i++) {
        mergedByIndex.set(group2Start + i, r2.scores[i]);
      }
      itemScores = whatItNeeds
        .map((_, idx) => mergedByIndex.get(idx))
        .filter((s): s is FinalAssessmentResult["item_scores"][number] => s !== undefined);

      passATokens = r1.tokens + r2.tokens;
      responseModel = r1.usedModel;

      log.info("Final assessment Pass A: parallel chunks complete", {
        r1Items: r1.scores.length, r2Items: r2.scores.length,
        merged: itemScores.length, totalTokens: passATokens,
      });
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Final item-scoring failed after retries";
    log.error("Final item-scoring failed", { error: errMsg });
    return { success: false, error: errMsg };
  }

  log.info("Final assessment pass A (item scoring) complete", {
    tokens: { total: passATokens },
    items: itemScores.length,
  });

  // ─── Pass B: Holistic assessment ────────────────────────────
  const itemScoresJson = JSON.stringify(itemScores, null, 2);
  const passBPrompt = `You are a LEAD INTERIOR DESIGNER doing the holistic final review. Pass 1 produced per-item sub-scores — below. Your job: assess the set as a WHOLE. Do NOT re-score items; trust Pass 1's scores. Do NOT decide whether more rounds are needed — that's Pass 3.

${sharedHeader}

## PASS 1 ITEM SCORES
${itemScoresJson}

## YOUR JOB — HOLISTIC ASSESSMENT

1. **overall_cohesion** (0-10, decimal): the full set holistically.
2. **palette_coherence**: color story assessment (1 sentence).
3. **material_coherence**: material/texture story (1 sentence).
4. **spatial_flow**: traffic flow, zones, spatial relationships (2-3 sentences).
5. **pairwise_conflicts**: check every pair. Report ONLY pairs with compatibility < 9.0.
6. **issues**: genuine cross-cutting problems not tied to a single item.
7. **confidence** (0-10, decimal): overall confidence in this final design after all rounds + Pass 1.

## OUTPUT FORMAT (JSON only, no prose, no markdown fences)
{
  "confidence": number,
  "overall_cohesion": number,
  "palette_coherence": "color story",
  "material_coherence": "material/texture story",
  "spatial_flow": "traffic flow, zones, relationships",
  "pairwise_conflicts": [
    { "item_a": "cat_a", "item_b": "cat_b", "compatibility": number, "conflict_type": "type", "reason": "why" }
  ],
  "issues": ["cross-cutting problems"]
}`;

  let holistic: ReturnType<typeof FinalHolisticResponseSchema.parse> | undefined;
  let passBTokens = 0;

  {
    let lastError: string | undefined;
    try {
      holistic = await withRetry(
        async () => {
          const textBlock = lastError
            ? `${passBPrompt}\n\n**IMPORTANT**: Previous response was invalid: "${lastError}". Return ONLY valid JSON.`
            : passBPrompt;
          const response = await geminiProvider.chat({
            model,
            system,
            messages: [{ role: "user", content: [...roomImages, { type: "text", text: textBlock }] }],
            max_tokens: 10000,
            seed: DETERMINISTIC_SEED,
            responseMimeType: "application/json",
            responseSchema: FINAL_HOLISTIC_GEMINI_SCHEMA,
            mediaResolution: "ultra_high",
          });
          const raw = extractJsonObject(response.content);
          const unwrapped = Array.isArray(raw) ? raw[0] : raw;
          const parsed = FinalHolisticResponseSchema.parse(unwrapped);
          passBTokens = response.usage.input_tokens + response.usage.output_tokens + response.usage.thinking_tokens;
          return parsed;
        },
        {
          maxAttempts: 3,
          baseDelayMs: 1500,
          maxDelayMs: 15000,
          isRetryable: (error) => {
            if (isRetryableError(error)) return true;
            if (error instanceof SyntaxError) return true;
            if (error instanceof Error && error.name === "ZodError") return true;
            return false;
          },
          onRetry: (retryAttempt, delayMs, error) => {
            lastError = error instanceof Error ? error.message : "Final holistic pass failed";
            log.warn(`Final holistic retry ${retryAttempt}`, { durationMs: delayMs, error: lastError });
          },
        }
      );
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Final holistic pass failed after retries";
      log.error("Final holistic pass failed", { error: errMsg });
      return { success: false, error: errMsg };
    }
  }

  // ─── Pass C: Convergence decision ───────────────────────────
  const convergenceCtx = JSON.stringify({
    rounds_completed: context.roundsCompleted,
    overall_cohesion: holistic.overall_cohesion,
    confidence: holistic.confidence,
    issues: holistic.issues,
    items_needing_work: itemScores.filter((s) => s.needs_more_work).map((s) => ({
      category: s.category,
      final_score: s.final_score,
      root_cause: s.root_cause,
    })),
    pairwise_conflict_count: holistic.pairwise_conflicts.length,
  }, null, 2);

  const passCPrompt = `You are making a convergence decision for an iterative room-design pipeline. Pass 1 scored items, Pass 2 assessed the whole. Now decide: keep iterating, or stop?

## INPUT
${convergenceCtx}

## DECISION RULES
- needs_more_rounds = true if ANY item has a fixable root_cause AND rounds_completed < 8
- round_budget 0-5: how many more rounds are warranted?
  * 0 = ship it as-is
  * 1-2 = minor issues, quick to fix
  * 3-5 = substantial issues, would benefit from more iteration
- Factor in diminishing returns: if rounds_completed is high and items are oscillating (check revision history patterns in your knowledge of how Pass 1 flagged items), lower the budget.

## OUTPUT FORMAT (JSON only, no prose, no markdown fences)
{
  "needs_more_rounds": true/false,
  "round_budget": 0-5
}`;

  let convergence: ReturnType<typeof FinalConvergenceResponseSchema.parse> | undefined;
  let passCTokens = 0;

  {
    let lastError: string | undefined;
    try {
      convergence = await withRetry(
        async () => {
          const textBlock = lastError
            ? `${passCPrompt}\n\n**IMPORTANT**: Previous response was invalid: "${lastError}". Return ONLY valid JSON.`
            : passCPrompt;
          const response = await geminiProvider.chat({
            model,
            system,
            messages: [{ role: "user", content: [{ type: "text", text: textBlock }] }],
            max_tokens: 1500,
            seed: DETERMINISTIC_SEED,
            responseMimeType: "application/json",
            responseSchema: FINAL_CONVERGENCE_GEMINI_SCHEMA,
          });
          const raw = extractJsonObject(response.content);
          const unwrapped = Array.isArray(raw) ? raw[0] : raw;
          const parsed = FinalConvergenceResponseSchema.parse(unwrapped);
          passCTokens = response.usage.input_tokens + response.usage.output_tokens + response.usage.thinking_tokens;
          return parsed;
        },
        {
          maxAttempts: 2,
          baseDelayMs: 1000,
          isRetryable: (error) => {
            if (isRetryableError(error)) return true;
            if (error instanceof SyntaxError) return true;
            if (error instanceof Error && error.name === "ZodError") return true;
            return false;
          },
          onRetry: (retryAttempt, delayMs, error) => {
            lastError = error instanceof Error ? error.message : "Convergence pass failed";
            log.warn(`Convergence retry ${retryAttempt}`, { durationMs: delayMs, error: lastError });
          },
        }
      );
    } catch (error) {
      // Convergence is cheap and the default is safe — don't fail the whole assessment.
      log.warn("Convergence pass failed, defaulting to no-more-rounds", {
        error: error instanceof Error ? error.message : String(error),
      });
      convergence = { needs_more_rounds: false, round_budget: 0 };
    }
  }

  const result: FinalAssessmentResult = {
    confidence: holistic.confidence,
    overall_cohesion: holistic.overall_cohesion,
    palette_coherence: holistic.palette_coherence,
    material_coherence: holistic.material_coherence,
    spatial_flow: holistic.spatial_flow,
    issues: holistic.issues,
    item_scores: itemScores,
    pairwise_conflicts: (holistic.pairwise_conflicts || []).map((c) => ({
      ...c,
      conflict_type: c.conflict_type || "",
      reason: c.reason || "",
    })),
    needs_more_rounds: convergence.needs_more_rounds,
    round_budget: convergence.round_budget,
  };

  log.info("Final assessment complete (split pass)", {
    phase: "final-assessment",
    confidence: result.confidence,
    cohesion: result.overall_cohesion,
    items: result.item_scores.length,
    pairwise_conflicts: result.pairwise_conflicts.length,
    needsMoreRounds: result.needs_more_rounds,
    roundBudget: result.round_budget,
    tokens: { total: passATokens + passBTokens + passCTokens },
    passATokens,
    passBTokens,
    passCTokens,
  });

  return {
    success: true,
    data: result,
    tokensUsed: passATokens + passBTokens + passCTokens,
    model: responseModel,
  };
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
    identifiedContext?: string;
    diagnosis?: DiagnosisData;
    whatItNeeds?: Array<{ category: string; search_title?: string; specs?: string; placement?: string; priority?: string }>;
  }
): Promise<AgentResult<ValidationResult>> {
  const model = selectModel("validation");
  // Use the agentic system prompt here — validateProductSet makes holistic,
  // multi-dimensional judgments where step-by-step reasoning matters
  // (e.g., weighing harmony vs. spec fit vs. pairwise conflicts).
  const system = getSystemPrompt(roomContext.designProfile);

  // Build environmental context section
  const envContext = [
    roomContext.spatialLayout && `Spatial layout: ${roomContext.spatialLayout}`,
    roomContext.floorPlan?.room_dimensions && `Room dimensions: ${JSON.stringify(roomContext.floorPlan.room_dimensions)}`,
    roomContext.floorPlan?.total_sqft && `Apartment: ~${roomContext.floorPlan.total_sqft} sqft`,
    roomContext.lightingConditions && `Lighting: ${roomContext.lightingConditions}`,
    roomContext.windowDoorPositions && `Windows/doors: ${roomContext.windowDoorPositions}`,
    roomContext.outletPositions && `Outlets: ${roomContext.outletPositions}`,
    roomContext.priorities?.length && `Client priorities: ${roomContext.priorities.map(quoteForPrompt).join(", ")}`,
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
${envContext ? `\n## SPATIAL & ENVIRONMENTAL CONTEXT\n${envContext}` : ""}${roomContext.userContext ? `\n\n## USER NOTES ABOUT THIS ROOM\n"${roomContext.userContext}"\nIMPORTANT: Factor these notes into validation. If the user mentions constraints or preferences not visible in photos, consider them when checking product fit.` : ""}${roomContext.identifiedContext ? `\n\n${roomContext.identifiedContext}\nIMPORTANT: These are GROUND-TRUTH verified pieces already in the room. Products in the validation set must:\n- Harmonize with their materials, colors, and style\n- Respect their canonical dimensions for scale math (within ~20%)\n- NOT propose a replacement for any identified piece (same category) unless that piece is in replaceItems\nFlag any violation in product_flags with specific callouts in clashes_with.` : ""}${roomContext.diagnosis ? (() => {
  const d = roomContext.diagnosis!;
  const lines: string[] = [];
  if (d.what_is_working?.length) lines.push(`Working: ${d.what_is_working.join("; ")}`);
  if (d.what_is_not_working?.length) lines.push(`Not working: ${d.what_is_not_working.join("; ")}`);
  const gaps = (d as DiagnosisData & { spatial_gaps?: string[] }).spatial_gaps;
  if (gaps?.length) lines.push(`Dead zones: ${gaps.join("; ")}`);
  return lines.length ? `\n\n## DIAGNOSIS (problem statement this set must solve)\n${lines.join("\n")}\nThe set must actually solve the "Not working" items and activate dead zones. Penalize sets that leave these unaddressed.` : "";
})() : ""}${roomContext.whatItNeeds?.length ? `\n\n## ORIGINAL REQUIREMENTS (from design assessment)
Each product should match its category's required specs. Flag mismatches in issues.
${roomContext.whatItNeeds.map((n) => `- **${n.category}**: ${n.search_title || ""}${n.specs ? ` | Specs: ${n.specs}` : ""}${n.placement ? ` | Placement: ${n.placement}` : ""}`).join("\n")}
IMPORTANT: Check that products match their category's SPECS (dimensions, materials, color range). A product that's in the right category but wrong size/material should get a lower functional_fit score.` : ""}

## PRODUCTS TO VALIDATE
${/* eslint-disable-next-line @typescript-eslint/no-unused-vars */
JSON.stringify(products.map(({ image_url: _img, ...rest }) => rest), null, 2)}

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
  "product_flags": [
    {
      "title": "product title",
      "category": "category slug",
      "harmony_score": number (USE DECIMALS),
      "sub_scores": {
        "color_fit": number, "spatial_fit": number, "material_fit": number,
        "style_coherence": number, "cross_room_fit": number, "functional_fit": number
      },
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
          seed: DETERMINISTIC_SEED,
          responseMimeType: "application/json",
          responseSchema: PRODUCT_SET_VALIDATION_GEMINI_SCHEMA,
          mediaResolution: "ultra_high",
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
                // Apply dimension-specific caps (not the combined math_harmony,
                // which would double-penalize — same low average capping both
                // color_fit AND material_fit independently).
                mathCaps.color_fit = mathEntry.color_score;
                mathCaps.material_fit = mathEntry.material_score;
              }
              const compositeResult = computeFinalHarmonyScore(
                flag.sub_scores as CompositeSubScores,
                mathCaps,
                flag.category,
                pairwiseConflicts,
                flag.title,
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
