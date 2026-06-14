/**
 * CategoryPlanner — decides WHAT categories to search for.
 *
 * The diagnosis phase outputs `missing_furniture_categories` as a hardcoded
 * list extracted by the analysis LLM. That list is often incomplete or
 * misses implicit needs:
 *   - Room is dark but diagnosis didn't list "lighting" as missing
 *   - Hard floor with no rug but "area_rug" wasn't explicit
 *   - Dead corner that needs activation but no spatial solution was named
 *   - Design direction calls for "soft textiles" but pillows/throws absent
 *
 * This agent reasons over ALL signals (diagnosis, design direction, what_it_needs,
 * room type, budget, existing items, spatial gaps) and decides the real shopping
 * list. Outputs a category plan with priority and reasoning per category.
 *
 * Priority drives tier allocation and re-search budgets — high-priority
 * categories get more queries and corrections.
 */

import { geminiProvider } from "@/lib/ai/gemini";
import { selectModel } from "@/lib/ai/models";
import { getSystemPrompt } from "@/lib/prompts/system";
import { zodToGeminiSchema } from "@/lib/ai/schema";
import { extractJsonObject } from "@/lib/ai/extract-json";
import { withRetry, isRetryableError } from "@/lib/ai/retry";
import { DETERMINISTIC_SEED } from "@/lib/ai/determinism";
import { createLogger } from "@/lib/logging/logger";
import { z } from "zod";
import type { AgentResult, DiagnosisItem } from "./types";
import type { DiagnosisData, DesignDirection } from "@/lib/types/database";
import type { DynamicDesignProfile } from "@/lib/design-context/user-profile";
import type { GeminiTool } from "@/lib/ai/provider";

const log = createLogger("category-planner");

const CategoryPlanSchema = z.object({
  /** Reasoning — why this specific set of categories matches the room's needs. */
  reasoning: z.string(),
  /** The categories to search, in priority order. */
  categories: z.array(
    z.object({
      category: z.string().describe("snake_case slug, e.g. 'area_rug', 'floor_lamp'"),
      priority: z.enum(["high", "medium", "low"]),
      reason: z.string().describe("Why this category is needed — cite the specific problem it solves"),
      search_title_hint: z.string().optional().describe("A short search-title style description"),
      /** When true, this category was NOT in the original missing list — it's an agent addition. */
      agent_added: z.boolean().default(false),
    })
  ).min(1).max(20),
  /** Categories that were in the original missing list but agent decided to skip. */
  dropped_from_missing: z.array(
    z.object({
      category: z.string(),
      reason: z.string(),
    })
  ).default([]),
});

export type CategoryPlan = z.infer<typeof CategoryPlanSchema>;

const CATEGORY_PLAN_GEMINI_SCHEMA = zodToGeminiSchema(CategoryPlanSchema);

export interface CategoryPlannerInput {
  roomType: string;
  budgetMode: string;
  /** Original categories from diagnosis — the baseline. */
  missingCategories: string[];
  /** What the assessment said the room needs (detailed specs). */
  whatItNeeds?: DiagnosisItem[];
  diagnosis?: DiagnosisData;
  designDirection?: DesignDirection;
  designProfile?: DynamicDesignProfile;
  /** Items user is keeping — exclude replacements for these unless in replaceItems. */
  keepItems: string[];
  replaceItems: string[];
  /** User's priorities (lifestyle/functional flags). */
  priorities: string[];
  /** Free-text user context. */
  userContext?: string;
  /** Room dimensions / floor plan data. */
  floorPlan?: Record<string, unknown>;
  /** Pre-formatted existing furniture block (from product-identifier). */
  identifiedContext?: string;
}

export async function planCategories(
  input: CategoryPlannerInput
): Promise<AgentResult<CategoryPlan>> {
  const model = selectModel("validation");
  const system = getSystemPrompt(input.designProfile);

  const diagnosisBlock = input.diagnosis ? [
    input.diagnosis.current_vibe_summary ? `Current vibe: ${input.diagnosis.current_vibe_summary}` : "",
    input.diagnosis.what_is_not_working?.length
      ? `Not working: ${input.diagnosis.what_is_not_working.join("; ")}`
      : "",
    input.diagnosis.biggest_improvement_opportunities?.length
      ? `Opportunities: ${input.diagnosis.biggest_improvement_opportunities.join("; ")}`
      : "",
    input.diagnosis.spatial_gaps?.length
      ? `Dead zones / spatial gaps: ${input.diagnosis.spatial_gaps.join("; ")}`
      : "",
    input.diagnosis.lighting_issues?.length
      ? `Lighting issues: ${input.diagnosis.lighting_issues.join("; ")}`
      : "",
    input.diagnosis.color_issues?.length
      ? `Color issues: ${input.diagnosis.color_issues.join("; ")}`
      : "",
    input.diagnosis.texture_material_issues?.length
      ? `Texture/material issues: ${input.diagnosis.texture_material_issues.join("; ")}`
      : "",
    input.diagnosis.scale_proportion_issues?.length
      ? `Scale/proportion issues: ${input.diagnosis.scale_proportion_issues.join("; ")}`
      : "",
    input.diagnosis.layout_issues?.length
      ? `Layout issues: ${input.diagnosis.layout_issues.join("; ")}`
      : "",
  ].filter(Boolean).join("\n") : "(no diagnosis)";

  const designBlock = input.designDirection ? [
    input.designDirection.style_notes ? `Style: ${input.designDirection.style_notes}` : "",
    input.designDirection.recommended_palette?.length
      ? `Palette: ${input.designDirection.recommended_palette.join(", ")}`
      : "",
    input.designDirection.recommended_materials?.length
      ? `Materials: ${input.designDirection.recommended_materials.join(", ")}`
      : "",
    input.designDirection.recommended_textures?.length
      ? `Textures: ${input.designDirection.recommended_textures.join(", ")}`
      : "",
  ].filter(Boolean).join("\n") : "(no design direction)";

  const whatItNeedsBlock = input.whatItNeeds && input.whatItNeeds.length > 0
    ? input.whatItNeeds.map((n, i) => {
        const bits = [`${i + 1}. [${n.category}]`];
        if (n.priority) bits.push(`priority=${n.priority}`);
        if (n.search_title) bits.push(n.search_title);
        if (n.specs) bits.push(`SPECS: ${n.specs}`);
        return bits.join(" | ");
      }).join("\n")
    : "(no structured what_it_needs)";

  const sqft = input.floorPlan?.total_sqft;
  const dims = input.floorPlan?.room_dimensions;

  const prompt = `You are planning the shopping list for a ${input.roomType}. The design assessment produced a categorized list of needs, but the list may be incomplete — your job is to audit it and produce the REAL list of categories we should search for.

## DIAGNOSIS (what the room lacks)
${diagnosisBlock}

## DESIGN DIRECTION
${designBlock}

## ASSESSMENT'S CATEGORIZED NEEDS
${whatItNeedsBlock}

## BASELINE MISSING CATEGORIES (from diagnosis)
${input.missingCategories.length > 0 ? input.missingCategories.join(", ") : "(none)"}

## ROOM CONSTRAINTS
- Room type: ${input.roomType}
- Budget: ${input.budgetMode}
- Keep items (do NOT recommend replacements): ${input.keepItems.length > 0 ? input.keepItems.join(", ") : "none"}
- Replace items: ${input.replaceItems.length > 0 ? input.replaceItems.join(", ") : "none"}
- Priorities: ${input.priorities.length > 0 ? input.priorities.join(", ") : "none"}
${sqft ? `- Approx sqft: ${sqft}` : ""}${dims ? `\n- Dimensions: ${JSON.stringify(dims)}` : ""}${input.userContext ? `\n- User notes: "${input.userContext}"` : ""}${input.identifiedContext ? `\n\n${input.identifiedContext}` : ""}

## YOUR JOB

Audit the baseline categories and the assessment's what_it_needs. Your output is the FINAL category list we'll search for.

Think step-by-step:
1. For each baseline category, verify it's still needed given the keep/replace rules. If the user is keeping their sofa, don't include "sofa".
2. Scan the diagnosis for UNSOLVED problems that the baseline list doesn't address. Common oversights:
   - "Room is dark" / dead lighting zones → needs floor_lamp, table_lamp, pendant_light, or sconce
   - "No soft textures" / acoustic issues → needs area_rug, throw_pillow, or throw_blanket
   - "Empty walls" / no focal point → needs wall_art, mirror, or gallery_wall
   - "Dead corner" / spatial gap → needs accent_chair, plant, floor_lamp, or bookshelf at that location
   - "Cold/sterile" → needs organic materials: plant, wood_accent, textile
   - "Cluttered surfaces" → needs storage: bookshelf, cabinet, nightstand
3. For every added category, justify it by the specific diagnosis quote it solves.
4. Drop categories that don't make sense given constraints (e.g., don't recommend "dining_table" if keep items include one).
5. Prioritize HIGH for categories directly named in diagnosis or called out in what_it_needs with priority=high. MEDIUM for supporting pieces. LOW for finishing touches.

Keep the final list focused — 6-12 categories is typical. More than 15 dilutes search budget.

Return JSON matching the schema. \`agent_added: true\` for any category NOT in the baseline missing_categories list. Populate \`dropped_from_missing\` for any baseline category you removed, with clear reason.

## EXAMPLES OF AGENTIC ADDITIONS (showing the reasoning style we want)

Example 1 — diagnosis flagged "room feels cold and one-note":
  → Add "area_rug" (priority: high) — Reason: "Diagnosis: 'cold and one-note' indicates missing soft texture; an area rug is the largest soft surface a room can add for warmth and acoustic dampening."
  → Add "throw_pillow" (priority: medium) — Reason: "Reinforces the soft-texture solution at lower investment than a rug; lets palette accents from design direction land in the seating area."

Example 2 — diagnosis flagged "dead corner near the window":
  → Add "floor_lamp" (priority: high) — Reason: "Spatial gap: 'dead corner near the window'. A floor lamp activates the corner without crowding it and adds layered evening light."
  → Add "accent_chair" (priority: medium) — Reason: "Pairs with the floor lamp to convert the dead corner into a reading nook."

Example 3 — baseline included "dining_table" but user keep_items lists "vintage farmhouse table":
  → Drop "dining_table" — Reason: "User explicitly kept their vintage farmhouse table; recommending a replacement would violate the keep constraint."

Example 4 — design direction calls for "warm earth tones, oak, linen" but baseline has only sofa+rug+coffee_table:
  → Add "wall_art" (priority: low) — Reason: "Design direction commits to a specific material/color story; without art the wall plane stays empty and the palette has nowhere to land vertically."

These examples show the pattern: each addition or drop must cite a SPECIFIC source signal (diagnosis quote, design direction commitment, or user constraint).

## TOOLS AVAILABLE
You have Google Search. Use it to verify whether the categories you're proposing are realistically available at the user's budget tier and room type. For example, before adding "wall_sconce" to a high-end living room plan, search "wall sconces high-end" to confirm the category exists at meaningful price points. You have Code Execution for any math (budget allocation, count vs. minimum).`;

  try {
    // Tools: Google Search verifies retailer/category availability at the
    // user's budget tier; Code Execution handles any budget allocation
    // or count math precisely. Compose with structured output (Gemini 3
    // supports the combination); fall back to text parsing if the
    // model snapshot rejects it.
    const tools: GeminiTool[] = [
      { googleSearch: {} as Record<string, never> },
      { codeExecution: {} as Record<string, never> },
    ];

    const response = await withRetry(
      async () => {
        try {
          return await geminiProvider.chat({
            model,
            system,
            messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
            max_tokens: 16000,
            seed: DETERMINISTIC_SEED,
            responseSchema: CATEGORY_PLAN_GEMINI_SCHEMA,
            responseMimeType: "application/json",
            thinkingConfig: { thinkingLevel: "low" },
            tools,
          });
        } catch (err) {
          log.warn("Tools+structured rejected — falling back to tools-only", {
            error: err instanceof Error ? err.message : String(err),
          });
          return await geminiProvider.chat({
            model,
            system,
            messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
            max_tokens: 16000,
            seed: DETERMINISTIC_SEED,
            thinkingConfig: { thinkingLevel: "low" },
            tools,
          });
        }
      },
      { isRetryable: isRetryableError, maxAttempts: 2 }
    );

    const parsed = extractJsonObject(response.content);
    const validated = CategoryPlanSchema.safeParse(parsed);
    if (!validated.success) {
      log.warn("CategoryPlan response failed schema — using baseline categories", {
        issues: validated.error.issues.slice(0, 3),
      });
      return { success: false, error: "Schema validation failed" };
    }

    const tokensUsed =
      (response.usage?.input_tokens ?? 0) +
      (response.usage?.output_tokens ?? 0) +
      (response.usage?.thinking_tokens ?? 0);

    const added = validated.data.categories.filter((c) => c.agent_added).map((c) => c.category);
    const dropped = validated.data.dropped_from_missing.map((d) => d.category);

    log.info("Category plan generated", {
      totalCategories: validated.data.categories.length,
      agentAdded: added,
      dropped,
      tokensUsed,
    });

    return {
      success: true,
      data: validated.data,
      tokensUsed,
      model,
    };
  } catch (err) {
    log.warn("Category planner failed — falling back to baseline missing_categories", {
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      success: false,
      error: err instanceof Error ? err.message : "Category planning failed",
    };
  }
}

export { CategoryPlanSchema };
