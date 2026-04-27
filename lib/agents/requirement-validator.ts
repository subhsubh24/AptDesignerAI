/**
 * Requirement validator — LLM-based audit that checks the final product
 * set against the original design assessment. Answers three questions:
 *
 *   1. Coverage: Does the set include products for every category the
 *      assessment said the room needs?
 *   2. Spec adherence: Do the top picks actually match each category's
 *      `what_it_needs` specs (dimensions, materials, color range)?
 *   3. Diagnosis solving: Does the set resolve the problems flagged in
 *      `what_is_not_working` and `spatial_gaps`?
 *
 * Runs after the tier-fill phase. Zero-cost deterministic checks are
 * brittle ("8x10" vs "8 feet by 10 feet" vs "80 sq ft") — this agent
 * reasons over the full spec text. Fails open: if the call errors,
 * validation just isn't updated. Adds 50-100K input tokens per run.
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
import type { CandidateProduct, DiagnosisData } from "@/lib/types/database";
import type { DynamicDesignProfile } from "@/lib/design-context/user-profile";
import type { AIContentBlock } from "@/lib/ai/provider";

const log = createLogger("requirement-validator");

const RequirementValidationSchema = z.object({
  overall_alignment: z.coerce.number().min(0).max(10),
  coverage: z.object({
    score: z.coerce.number().min(0).max(10),
    missing_categories: z.array(z.string()).default([]),
    uncovered_requirements: z.array(z.string()).default([]),
  }),
  spec_matches: z
    .array(
      z.object({
        category: z.string(),
        matches: z.boolean(),
        match_score: z.coerce.number().min(0).max(10),
        gaps: z.array(z.string()).default([]),
        reasoning: z.string().default(""),
      })
    )
    .default([]),
  diagnosis_solving: z.object({
    score: z.coerce.number().min(0).max(10),
    problems_addressed: z.array(z.string()).default([]),
    problems_unaddressed: z.array(z.string()).default([]),
    explanation: z.string().default(""),
  }),
  issues: z.array(z.string()).default([]),
  suggestions: z.array(z.string()).default([]),
});

export type RequirementValidationResult = z.infer<typeof RequirementValidationSchema>;

const REQUIREMENT_VALIDATION_GEMINI_SCHEMA = zodToGeminiSchema(RequirementValidationSchema);

export interface RequirementValidatorInput {
  roomType: string;
  missingCategories: string[];
  whatItNeeds?: DiagnosisItem[];
  diagnosis?: DiagnosisData;
  /** Top pick per category, filtered to in-tier products */
  topPicksByCategory: Record<string, CandidateProduct>;
  /** Full picks grid so the agent can see alternates if top pick is weak */
  candidatesByCategory?: Record<string, CandidateProduct[]>;
  designDirection?: { style_notes?: string; recommended_palette?: string[]; recommended_materials?: string[] };
  designProfile?: DynamicDesignProfile;
  roomImageUrls?: string[];
  /**
   * When true, enable Google Search grounding so the agent can verify real
   * product availability (e.g., "does an 8x10 wool rug in cognac exist at
   * West Elm for $400?"). Costs more tokens but improves spec-fit judgments.
   * Default false (enable per-call when the caller wants live verification).
   */
  enableGoogleSearch?: boolean;
}

function formatProduct(p: CandidateProduct | undefined): string {
  if (!p) return "NONE";
  const parts: string[] = [p.title || "(no title)"];
  if (p.price) parts.push(`$${p.price}`);
  if (p.materials?.length) parts.push(`materials: ${p.materials.join(", ")}`);
  if (p.colors?.length) parts.push(`colors: ${p.colors.join(", ")}`);
  if (p.dimensions) {
    const d = p.dimensions as { width?: number; depth?: number; height?: number; unit?: string };
    const dim = [d.width, d.depth, d.height].filter(Boolean).join("x");
    if (dim) parts.push(`dims: ${dim}${d.unit || ""}`);
  }
  if (p.description) parts.push(`desc: ${p.description.slice(0, 150)}`);
  return parts.join(" | ");
}

export async function validateRequirements(
  input: RequirementValidatorInput
): Promise<AgentResult<RequirementValidationResult>> {
  const model = selectModel("validation");
  // Agentic prompt — this agent reasons about coverage, spec adherence, and
  // diagnosis-solving across multiple categories. Step-by-step reasoning helps.
  const system = getSystemPrompt(input.designProfile);

  const whatItNeeds = input.whatItNeeds || [];
  const diagnosis = input.diagnosis;
  const coveredCategories = Object.keys(input.topPicksByCategory);

  const requirementsBlock = whatItNeeds.length > 0
    ? whatItNeeds.map((n, i) => {
        const lines = [`${i + 1}. [${n.category}]${n.priority ? ` priority=${n.priority}` : ""}`];
        if (n.search_title) lines.push(`   title: ${n.search_title}`);
        if (n.specs) lines.push(`   specs: ${n.specs}`);
        if (n.placement) lines.push(`   placement: ${n.placement}`);
        if (n.description) lines.push(`   why: ${n.description}`);
        return lines.join("\n");
      }).join("\n\n")
    : "(no structured requirements — use missing_furniture_categories)";

  const picksBlock = input.missingCategories
    .map((cat) => {
      const pick = input.topPicksByCategory[cat];
      return `[${cat}] → ${formatProduct(pick)}`;
    })
    .join("\n");

  const diagnosisBlock = diagnosis ? [
    diagnosis.what_is_not_working?.length ? `Not working: ${diagnosis.what_is_not_working.join("; ")}` : "",
    diagnosis.spatial_gaps?.length ? `Dead zones / spatial gaps: ${diagnosis.spatial_gaps.join("; ")}` : "",
    diagnosis.lighting_issues?.length ? `Lighting issues: ${diagnosis.lighting_issues.join("; ")}` : "",
    diagnosis.color_issues?.length ? `Color issues: ${diagnosis.color_issues.join("; ")}` : "",
    diagnosis.texture_material_issues?.length ? `Texture/material issues: ${diagnosis.texture_material_issues.join("; ")}` : "",
    diagnosis.scale_proportion_issues?.length ? `Scale/proportion issues: ${diagnosis.scale_proportion_issues.join("; ")}` : "",
  ].filter(Boolean).join("\n") : "(no diagnosis provided)";

  const designBlock = input.designDirection ? [
    input.designDirection.style_notes ? `Style: ${input.designDirection.style_notes}` : "",
    input.designDirection.recommended_palette?.length ? `Palette: ${input.designDirection.recommended_palette.join(", ")}` : "",
    input.designDirection.recommended_materials?.length ? `Materials: ${input.designDirection.recommended_materials.join(", ")}` : "",
  ].filter(Boolean).join("\n") : "(no design direction)";

  const uncoveredHint = input.missingCategories
    .filter((c) => !coveredCategories.includes(c) || !input.topPicksByCategory[c])
    .join(", ");

  const prompt = `You are the final gate between a product search run and the user. Audit whether the chosen products actually satisfy what the design assessment said this ${input.roomType} needs.

## REQUIRED CATEGORIES (from assessment)
${input.missingCategories.length > 0 ? input.missingCategories.map((c) => `- ${c}`).join("\n") : "(none)"}${uncoveredHint ? `\n\nHEADS UP — these categories have no product in the final set: ${uncoveredHint}` : ""}

## WHAT THE ASSESSMENT SAID THE ROOM NEEDS (detailed specs)
${requirementsBlock}

## FINAL TOP PICK PER CATEGORY
${picksBlock || "(no picks)"}

## ROOM DIAGNOSIS — the problems this set must solve
${diagnosisBlock}

## DESIGN DIRECTION
${designBlock}

## YOUR JOB

Three checks — grade each 0-10 (decimals allowed).

### 1. COVERAGE (score 0-10)
Every required category should have a product. Score 10 if all categories covered; subtract for each missing. List missing categories and any uncovered requirements (e.g., "seating for 4" when only 3 chairs present).

### 2. SPEC MATCH (per-category score 0-10)
For EACH category with a pick, compare the pick's actual attributes to the assessment's \`specs\`:
- Does the size match? (If spec says "8x10 rug", a 6x9 rug scores low)
- Does the material match? (If spec says "oak wood", particle board scores low)
- Does the color match? (If spec says "warm earth tones", stark white scores low)
- Does the style match? (If spec says "mid-century modern lounge chair", a farmhouse chair scores low)
Reason out loud in the \`reasoning\` field. List concrete \`gaps\` (e.g., "dimensions are 60x36, spec calls for 84x42").

### 3. DIAGNOSIS SOLVING (score 0-10)
Does the product set solve the problems in "Not working" and "dead zones"?
- Dark room → set should include lighting
- Cold/sterile → set should include soft materials (rug, pillows, textiles)
- Dead corner → set should include a product placed there
- Scale too small → new products should add proper scale
Be specific — list which problems are addressed vs unaddressed.

## OUTPUT
Return JSON matching the schema exactly. Keep reasoning tight (1-2 sentences per field). Issues are user-facing — write them as concrete, actionable statements (e.g., "The rug is 6x9 but should be 8x10 per the assessment" not "size mismatch"). Suggestions should be specific fixes (e.g., "Search for a larger rug in the 8x10 range for the balanced tier").

Overall alignment score: how well does this set deliver on the assessment? Target ≥ 8.0. Below 7.0 means significant rework needed.${input.enableGoogleSearch ? `

## GROUNDING — YOU HAVE GOOGLE SEARCH
Use Google Search to verify your spec-match judgments. Before penalizing a product for "wrong size" or "wrong material", search the retailer's site for what the product actually offers. Before flagging a category as "unachievable in budget", search for alternatives at the target tier. Cite what you found in the reasoning field.

Examples of when to search:
- A spec says "8x10 wool rug ~$500" but top pick is smaller: search "8x10 wool rug under $500" to check if the stated requirement is even realistic at that tier.
- A product's materials field is empty: search the product URL or title to verify the material.
- A category appears missing: search "${input.roomType} ${Object.keys(input.topPicksByCategory).join(", ")}" retailers to verify alternatives exist.

Only search when the judgment is uncertain. Don't search for every product — use it as a verification tool for close calls.` : ""}`;

  const content: AIContentBlock[] = [];
  if (input.roomImageUrls?.length) {
    for (const url of input.roomImageUrls.slice(0, 2)) {
      content.push({ type: "image", source: { type: "url", url } });
    }
  }
  content.push({ type: "text", text: prompt });

  try {
    const response = await withRetry(
      async () => {
        // When Google Search is enabled, Gemini 3 models support combining
        // it with responseSchema. Fall back to text parsing if the combined
        // call is rejected (happens on some older model snapshots).
        try {
          return await geminiProvider.chat({
            model,
            system,
            messages: [{ role: "user", content }],
            max_tokens: 64000,
            seed: DETERMINISTIC_SEED,
            responseSchema: REQUIREMENT_VALIDATION_GEMINI_SCHEMA,
            responseMimeType: "application/json",
            // Tools: when grounding enabled, give the agent Google Search
            // (verify retailer availability) + Code Execution (compute
            // dimension math, area coverage, budget allocations precisely
            // instead of estimating).
            ...(input.enableGoogleSearch ? {
              tools: [
                { googleSearch: {} as Record<string, never> },
                { codeExecution: {} as Record<string, never> },
              ],
            } : {}),
          });
        } catch (err) {
          if (!input.enableGoogleSearch) throw err;
          log.warn("Grounded+structured call rejected — falling back to grounded-only", {
            error: err instanceof Error ? err.message : String(err),
          });
          return await geminiProvider.chat({
            model,
            system,
            messages: [{ role: "user", content }],
            max_tokens: 64000,
            seed: DETERMINISTIC_SEED,
            tools: [{ googleSearch: {} as Record<string, never> }],
          });
        }
      },
      { isRetryable: isRetryableError, maxAttempts: 2 }
    );

    const parsed = extractJsonObject(response.content);
    const validated = RequirementValidationSchema.safeParse(parsed);
    if (!validated.success) {
      log.warn("RequirementValidation response failed schema — skipping", {
        issues: validated.error.issues.slice(0, 3),
      });
      return { success: false, error: "Schema validation failed" };
    }

    const tokensUsed =
      (response.usage?.input_tokens ?? 0) +
      (response.usage?.output_tokens ?? 0) +
      (response.usage?.thinking_tokens ?? 0);

    log.info("Requirement validation complete", {
      alignment: validated.data.overall_alignment,
      coverage: validated.data.coverage.score,
      diagnosisSolving: validated.data.diagnosis_solving.score,
      issueCount: validated.data.issues.length,
      tokensUsed,
    });

    return {
      success: true,
      data: validated.data,
      tokensUsed,
      model,
    };
  } catch (err) {
    log.warn("Requirement validation failed — failing open", {
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      success: false,
      error: err instanceof Error ? err.message : "Requirement validation failed",
    };
  }
}

export { RequirementValidationSchema };
