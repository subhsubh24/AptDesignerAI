/**
 * Mockup prompt validator — LLM audit of the generated mockup prompt
 * BEFORE it's sent to the image model. Checks:
 *
 *   1. Completeness — does the prompt mention every selected product?
 *   2. Spec fidelity — does the prompt describe each product with its
 *      actual materials, colors, and dimensions (not a generic version)?
 *   3. Placement accuracy — does the prompt place each product at its
 *      intended location per the placement map?
 *   4. Architectural grounding — does the prompt reference the room's
 *      actual walls, floors, windows, lighting (not a generic room)?
 *
 * If issues are found, the agent returns a REVISED prompt that fixes
 * the gaps. The mockup route uses the revised prompt when
 * `promptScore < 7` or critical gaps are present.
 *
 * Runs on Gemini Flash Lite, ~20-40K tokens. Fails open: if the
 * agent errors, the original prompt is used unchanged.
 */

import { getProvider } from "@/lib/ai/provider-factory";
import { selectModel } from "@/lib/ai/models";
import { thinkingFor } from "@/lib/ai/thinking";
import { getSystemPrompt } from "@/lib/prompts/system";
import { zodToGeminiSchema } from "@/lib/ai/schema";
import { extractJsonObject } from "@/lib/ai/extract-json";
import { withRetry, isRetryableError } from "@/lib/ai/retry";
import { DETERMINISTIC_SEED } from "@/lib/ai/determinism";
import { createLogger } from "@/lib/logging/logger";
import { z } from "zod";
import type { AgentResult } from "./types";

const log = createLogger("mockup-prompt-validator");

const MockupPromptValidationSchema = z.object({
  prompt_score: z.coerce.number().min(0).max(10),
  completeness: z.object({
    score: z.coerce.number().min(0).max(10),
    missing_products: z.array(z.string()).default([]),
  }),
  spec_fidelity: z.object({
    score: z.coerce.number().min(0).max(10),
    vague_descriptions: z.array(z.string()).default([]),
  }),
  placement: z.object({
    score: z.coerce.number().min(0).max(10),
    missing_placements: z.array(z.string()).default([]),
  }),
  architectural_grounding: z.object({
    score: z.coerce.number().min(0).max(10),
    notes: z.string().default(""),
  }),
  issues: z.array(z.string()).default([]),
  revised_prompt: z.string().optional(),
});

export type MockupPromptValidationResult = z.infer<typeof MockupPromptValidationSchema>;

const MOCKUP_PROMPT_VALIDATION_GEMINI_SCHEMA = zodToGeminiSchema(MockupPromptValidationSchema);

export interface MockupPromptValidatorInput {
  prompt: string;
  products: Array<{
    category?: string | null;
    title?: string | null;
    materials?: string[] | null;
    colors?: string[] | null;
    dimensions?: string | Record<string, unknown> | null;
    description?: string | null;
  }>;
  placementMap?: Record<string, string>;
  roomType: string;
  designDirection?: string;
}

function formatProduct(p: MockupPromptValidatorInput["products"][number]): string {
  const parts: string[] = [];
  if (p.category) parts.push(`[${p.category}]`);
  if (p.title) parts.push(p.title);
  if (p.materials?.length) parts.push(`materials: ${p.materials.join(", ")}`);
  if (p.colors?.length) parts.push(`colors: ${p.colors.join(", ")}`);
  if (p.dimensions) {
    const d = typeof p.dimensions === "string" ? p.dimensions : JSON.stringify(p.dimensions);
    parts.push(`dims: ${d}`);
  }
  return parts.join(" | ");
}

export async function validateMockupPrompt(
  input: MockupPromptValidatorInput
): Promise<AgentResult<MockupPromptValidationResult>> {
  const model = selectModel("mockup_prompt");
  const system = getSystemPrompt();

  const productList = input.products.map((p, i) => `${i + 1}. ${formatProduct(p)}`).join("\n");
  const placementBlock = input.placementMap && Object.keys(input.placementMap).length > 0
    ? Object.entries(input.placementMap).map(([cat, loc]) => `  ${cat}: ${loc}`).join("\n")
    : "(no explicit placement map)";

  const prompt = `You are auditing a mockup prompt BEFORE it's sent to an image generator. Your goal: verify the prompt will produce an image that matches the selected products and room.

## ROOM TYPE
${input.roomType}

## DESIGN DIRECTION
${input.designDirection || "(none provided)"}

## SELECTED PRODUCTS (must all appear in the mockup)
${productList || "(none)"}

## INTENDED PLACEMENTS
${placementBlock}

## PROMPT UNDER REVIEW
---
${input.prompt}
---

## AUDIT CHECKLIST

### 1. COMPLETENESS (score 0-10)
Does the prompt explicitly mention every selected product? List any missing ones by title or category. Score 10 only if all products are referenced.

### 2. SPEC FIDELITY (score 0-10)
Is each product described with its ACTUAL materials, colors, and key dimensions — or is it generic? A prompt saying "a sofa" when the product is a "cognac leather mid-century sofa" scores low. List vague descriptions.

### 3. PLACEMENT (score 0-10)
Does the prompt place each product at its intended location from the placement map? If the map says "rug under sofa, centered between coffee table and TV" and the prompt just says "place rug on floor", that's a miss.

### 4. ARCHITECTURAL GROUNDING (score 0-10)
Does the prompt reference the actual room (walls, floor, windows, lighting) — or does it describe a generic space? The image model needs to know what to preserve.

## OUTPUT

Return JSON. Keep scoring tight. \`prompt_score\` is the overall quality (0-10).

If \`prompt_score < 8\` OR any sub-score < 7, return a \`revised_prompt\` that fixes the gaps:
- Add missing products with their specs
- Replace generic descriptions with material/color/dimension specifics
- Add placement instructions from the map
- Preserve the architectural-grounding language

Otherwise, omit \`revised_prompt\`. The revised prompt MUST preserve the tone, rules, and architectural instructions of the original — you are improving specificity, not rewriting philosophy.

Issues: brief, user-facing descriptions of gaps. Max 5.`;

  try {
    const response = await withRetry(
      () =>
        getProvider("mockup_prompt").chat({
          model,
          system,
          messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
          max_tokens: 64000,
          seed: DETERMINISTIC_SEED,
          responseSchema: MOCKUP_PROMPT_VALIDATION_GEMINI_SCHEMA,
          responseMimeType: "application/json",
          thinkingConfig: thinkingFor("mockup_prompt"),
        }),
      { isRetryable: isRetryableError, maxAttempts: 2 }
    );

    const parsed = extractJsonObject(response.content);
    const validated = MockupPromptValidationSchema.safeParse(parsed);
    if (!validated.success) {
      log.warn("MockupPromptValidation response failed schema", {
        issues: validated.error.issues.slice(0, 3),
      });
      return { success: false, error: "Schema validation failed" };
    }

    const tokensUsed =
      (response.usage?.input_tokens ?? 0) +
      (response.usage?.output_tokens ?? 0) +
      (response.usage?.thinking_tokens ?? 0);

    log.info("Mockup prompt audit complete", {
      promptScore: validated.data.prompt_score,
      completeness: validated.data.completeness.score,
      specFidelity: validated.data.spec_fidelity.score,
      placement: validated.data.placement.score,
      architectural: validated.data.architectural_grounding.score,
      hasRevision: !!validated.data.revised_prompt,
      tokensUsed,
    });

    return {
      success: true,
      data: validated.data,
      tokensUsed,
      model,
    };
  } catch (err) {
    log.warn("Mockup prompt validation failed — failing open", {
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      success: false,
      error: err instanceof Error ? err.message : "Mockup prompt validation failed",
    };
  }
}

export { MockupPromptValidationSchema };
