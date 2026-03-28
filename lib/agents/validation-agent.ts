import { geminiProvider } from "@/lib/ai/gemini";
import { selectModel } from "@/lib/ai/models";
import { getSystemPrompt } from "@/lib/prompts/system";
import type { AIContentBlock } from "@/lib/ai/provider";
import type { AgentResult } from "./types";
import type { DynamicDesignProfile } from "@/lib/design-context/user-profile";

export interface ValidationResult {
  isValid: boolean;
  confidence: number;
  issues: string[];
  suggestions: string[];
  revisedAnalysis?: Record<string, unknown>;
}

/**
 * Validation agent that checks analysis consistency and confidence.
 * Uses Gemini with high thinking level for deep reasoning.
 */
export async function validateAnalysis(
  analysisType: "room_diagnosis" | "product_search" | "bundle",
  analysis: Record<string, unknown>,
  context: {
    buildingResearch?: Record<string, unknown>;
    apartmentAnalysis?: Record<string, unknown>;
    roomImages?: string[];
    userAesthetic?: string;
  }
): Promise<AgentResult<ValidationResult>> {
  const model = selectModel("validation");
  const system = getSystemPrompt();

  const validationPrompt = `You are a validation agent. Your job is to critically review an AI analysis for consistency, accuracy, and holistic sense.

## ANALYSIS TYPE
${analysisType}

## ANALYSIS TO VALIDATE
${JSON.stringify(analysis, null, 2)}

## CONTEXT
${context.buildingResearch ? `Building research: ${JSON.stringify(context.buildingResearch)}` : ""}
${context.apartmentAnalysis ? `Apartment analysis: ${JSON.stringify(context.apartmentAnalysis)}` : ""}
${context.userAesthetic ? `User aesthetic: ${context.userAesthetic}` : ""}

## VALIDATION CHECKLIST
1. Does the analysis make holistic sense? Are there internal contradictions?
2. Are recommendations consistent with the user's aesthetic preferences?
3. Are item descriptions specific enough? (materials, colors, dimensions, finishes)
4. Do the recommended items actually fit together as a cohesive set?
5. Are there any hallucinated or unrealistic recommendations?
6. Is the confidence justified given the available information?
7. Would a professional interior designer agree with this analysis?

## OUTPUT FORMAT
Return JSON:
{
  "isValid": true/false,
  "confidence": 0-10 (how confident you are the analysis is correct),
  "issues": ["list of specific problems found"],
  "suggestions": ["list of specific improvements"],
  "revisedAnalysis": null or { revised version if confidence < 7 }
}`;

  try {
    const response = await geminiProvider.chat({
      model,
      system,
      messages: [{ role: "user", content: validationPrompt }],
      temperature: 0.2,
      thinkingConfig: { thinkingLevel: "high" },
      responseMimeType: "application/json",
    });

    const parsed = JSON.parse(response.content) as ValidationResult;
    return {
      success: true,
      data: parsed,
      tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
      model: response.model,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Validation failed",
    };
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
    visual_style_tags?: string[];
  }>,
  roomContext: {
    roomType: string;
    designDirection: string;
    existingItems: string[];
    roomImageUrls?: string[];
    designProfile?: DynamicDesignProfile;
  }
): Promise<AgentResult<ValidationResult>> {
  const model = selectModel("validation");
  const system = getSystemPrompt(roomContext.designProfile);

  const promptText = `Validate this set of product search results. You have room photos and product images — use them to verify visual coherence.

## VALIDATION CHECKLIST
1. **Visual cohesion**: Do the product images ACTUALLY look like they belong together? Check real colors, textures, and styles in the images — not just text descriptions.
2. Every item description is detailed enough (specific materials, exact colors with undertones, dimensions)
3. All items within each tier work together aesthetically
4. Items match the room's design direction and existing furniture visible in room photos
5. Budget/Middle/Luxury tiers have appropriate price differentiation
6. No duplicate or near-duplicate products across tiers
7. Scale and proportion: Do these items look like they'd work at the right scale for the room shown?

## ROOM CONTEXT
- Room type: ${roomContext.roomType}
- Design direction: ${roomContext.designDirection}
- Existing items: ${roomContext.existingItems.join(", ")}

## PRODUCTS TO VALIDATE
${JSON.stringify(products.map(({ image_url: _img, ...rest }) => rest), null, 2)}

Return JSON:
{
  "isValid": true/false,
  "confidence": 0-10,
  "issues": ["specific problems — reference what you SEE in the images"],
  "suggestions": ["specific improvements"]
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

  try {
    const response = await geminiProvider.chat({
      model,
      system,
      messages: [{ role: "user", content }],
      temperature: 0.2,
      thinkingConfig: { thinkingLevel: "medium" },
      responseMimeType: "application/json",
    });

    const parsed = JSON.parse(response.content) as ValidationResult;
    return {
      success: true,
      data: parsed,
      tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
      model: response.model,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Product set validation failed",
    };
  }
}
